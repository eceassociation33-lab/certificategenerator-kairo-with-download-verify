import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import { google } from "googleapis";
import session from "express-session";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // MongoDB Connection
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("Connected to MongoDB successfully");
    } catch (e) {
      console.error("Failed to connect to MongoDB:", e);
    }
  } else {
    console.warn("WARNING: MONGODB_URI not found in .env. Falling back to in-memory mode (data will be lost on restart).");
  }

  // Mongoose Schemas
  interface IParticipant {
    kairoId: string;
    name?: string;
    college?: string;
    email?: string;
    certNumber?: string;
    driveUrl?: string;
    emailStatus?: string;
  }
  const ParticipantSchema = new mongoose.Schema<IParticipant>({
    kairoId: { type: String, required: true, unique: true },
    name: String,
    college: String,
    email: String,
    certNumber: String,
    driveUrl: String,
    emailStatus: String
  });
  const Participant = mongoose.models.Participant || mongoose.model<IParticipant>('Participant', ParticipantSchema);

  interface IConfig {
    key: string;
    value: any;
  }
  const ConfigSchema = new mongoose.Schema<IConfig>({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
  });
  const ConfigModel = mongoose.models.Config || mongoose.model<IConfig>('Config', ConfigSchema);

  // Session for OAuth
  app.set('trust proxy', 1); // allow secure cookies on Render behind a proxy
  app.use(session({
    secret: "kairo-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true
    }
  }));

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl}/auth/google/callback`
  );

  // Load participants from file if exists
  let participantsStore: any[] = [];
  try {
    if (fs.existsSync(path.join(process.cwd(), "participants_data.json"))) {
      participantsStore = JSON.parse(fs.readFileSync(path.join(process.cwd(), "participants_data.json"), "utf-8"));
    }
  } catch (e) { }

  const saveToMem = (obj: any) => {
    const existingIndex = participantsStore.findIndex(p => p.kairoId === obj.kairoId);
    if (existingIndex > -1) { participantsStore[existingIndex] = obj; } else { participantsStore.push(obj); }
  }

  // Google Drive Auth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"],
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);
      if (process.env.MONGODB_URI) {
        await ConfigModel.findOneAndUpdate({ key: 'googleAuth' }, { value: tokens }, { upsert: true });
      } else {
        (req.session as any).tokens = tokens;
      }
      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send("Auth failed");
    }
  });

  app.get("/api/drive/status", async (req, res) => {
    let connected = false;
    if (process.env.MONGODB_URI) {
      const config = await ConfigModel.findOne({ key: 'googleAuth' });
      connected = !!config?.value;
    } else {
      connected = !!(req.session as any).tokens;
    }
    res.json({ connected });
  });

  app.post("/api/drive/upload", async (req, res) => {
    let tokens = (req.session as any).tokens;
    if (process.env.MONGODB_URI) {
      const config = await ConfigModel.findOne({ key: 'googleAuth' });
      if (config) tokens = config.value;
    }

    if (!tokens) return res.status(401).json({ error: "Not connected to Drive" });

    const { name, content, kairoId, participantData, folderLink } = req.body;

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    try {
      let folderId = (req.session as any).folderId;

      // Extract Custom Folder ID if provided
      if (folderLink && folderLink.includes('drive.google.com/drive/folders/')) {
        const parts = folderLink.split('/folders/');
        if (parts.length > 1) {
          folderId = parts[1].split('?')[0];
        }
      }

      if (!folderId) {
        const folderResponse = await drive.files.create({
          requestBody: {
            name: "Kairo Certificates",
            mimeType: "application/vnd.google-apps.folder",
          },
          fields: "id",
        });
        folderId = folderResponse.data.id;
        (req.session as any).folderId = folderId;
      }

      const buffer = Buffer.from(content.split(",")[1], "base64");
      const fileMetadata = {
        name: `${kairoId}_Certificate.png`,
        parents: [folderId],
      };
      const media = {
        mimeType: "image/png",
        body: Readable.from(buffer),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink, webContentLink",
      });

      // Make file readable by anyone with link (for the download feature)
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      // Store participant for verification with Drive Link
      if (participantData) {
        const fullData = { ...participantData, driveUrl: file.data.webViewLink };
        if (process.env.MONGODB_URI) {
          await Participant.findOneAndUpdate({ kairoId }, fullData, { upsert: true, new: true });
        } else {
          saveToMem(fullData);
          // ensure data is written to disk for local dev!
          try { fs.writeFileSync(path.join(process.cwd(), "participants_data.json"), JSON.stringify(participantsStore, null, 2)); } catch (e) { }
        }
      }

      res.json({ success: true, fileId: file.data.id, viewLink: file.data.webViewLink });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Public download route
  app.get("/download/:kairoId", async (req, res) => {
    const { kairoId } = req.params;

    let tokens = (req.session as any).tokens;
    if (process.env.MONGODB_URI) {
      const config = await ConfigModel.findOne({ key: 'googleAuth' });
      if (config) tokens = config.value;
    }
    if (!tokens) return res.status(500).send("Drive not configured by admin");

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    try {
      const response = await drive.files.list({
        q: `name = '${kairoId}_Certificate.png' and trashed = false`,
        fields: "files(id, webContentLink)",
      });

      if (response.data.files && response.data.files.length > 0) {
        res.redirect(response.data.files[0].webContentLink!);
      } else {
        res.status(404).send("Certificate not found for this ID");
      }
    } catch (error) {
      res.status(500).send("Error searching for certificate");
    }
  });

  // Public search for download
  app.get("/api/download-search", async (req, res) => {
    const { kairoId } = req.query;

    let tokens = (req.session as any).tokens;
    if (process.env.MONGODB_URI) {
      const config = await ConfigModel.findOne({ key: 'googleAuth' });
      if (config) tokens = config.value;
    }
    if (!tokens) return res.status(500).json({ error: "Drive not configured by admin" });

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    try {
      const response = await drive.files.list({
        q: `name = '${kairoId}_Certificate.png' and trashed = false`,
        fields: "files(id, webViewLink, webContentLink)",
      });

      if (response.data.files && response.data.files.length > 0) {
        res.json({ viewLink: response.data.files[0].webViewLink });
      } else {
        res.status(404).json({ error: "Certificate not found for this ID. Make sure the admin has uploaded it." });
      }
    } catch (error) {
      res.status(500).json({ error: "Error searching for certificate" });
    }
  });

  // Public verification
  app.get("/api/verify-cert", async (req, res) => {
    const { certNumber } = req.query;
    let participant = null;

    if (process.env.MONGODB_URI) {
      participant = await Participant.findOne({ certNumber });
    } else {
      participant = participantsStore.find(p => p.certNumber === certNumber);
    }

    if (participant) {
      res.json(participant);
    } else {
      res.status(404).json({ error: "Invalid certificate number" });
    }
  });

  // API routes
  app.post("/api/send-email", async (req, res) => {
    const {
      to,
      subject,
      body,
      attachment,
      senderEmail,
      senderPassword,
      senderHost,
      senderPort,
      senderSecure
    } = req.body;

    if (!to || !attachment || !senderEmail || !senderPassword) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Create transporter
      const transporter = nodemailer.createTransport({
        host: senderHost || "smtp.gmail.com",
        port: senderPort || 465,
        secure: senderSecure !== undefined ? senderSecure : true,
        auth: {
          user: senderEmail,
          pass: senderPassword,
        },
      });

      // Send mail
      const info = await transporter.sendMail({
        from: `"Kairo E-Certificate Studio" <${senderEmail}>`,
        to,
        subject: subject || "Your E-Certificate",
        text: body || "Please find your e-certificate attached.",
        attachments: [
          {
            filename: 'certificate.png',
            content: attachment.split("base64,")[1],
            encoding: 'base64'
          }
        ]
      });

      res.json({ success: true, messageId: info.messageId });
    } catch (error: any) {
      console.error("Email sending error:", error);
      let errorMessage = error.message || "Failed to send email";

      if (errorMessage.includes("535") || errorMessage.includes("Invalid login")) {
        errorMessage = "Authentication failed. If using Gmail, you MUST use an 'App Password', not your regular password. Ensure 2-Step Verification is enabled.";
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("index.html", { root: "dist" });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
