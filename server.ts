import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // 1. MongoDB Connection
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("Connected to MongoDB successfully");
    } catch (e) {
      console.error("Failed to connect to MongoDB:", e);
    }
  } else {
    console.warn("WARNING: MONGODB_URI not found. Data will be lost on restart.");
  }

  // 2. Mongoose Schemas
  const ParticipantSchema = new mongoose.Schema({
    kairoId: { type: String, required: true, unique: true },
    name: String,
    college: String,
    email: String,
    certNumber: String,
    driveUrl: String,
    emailStatus: String
  });
  const Participant = mongoose.models.Participant || mongoose.model('Participant', ParticipantSchema);

  // 3. Google Drive Service Account Auth
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      // Fixes formatting for Render environment variables
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: "v3", auth });

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  // 4. Drive Upload Route (Updated for Service Account)
  app.post("/api/drive/upload", async (req, res) => {
    const { name, content, kairoId, participantData, folderLink } = req.body;

    try {
      let folderId = "";
      if (folderLink && folderLink.includes('drive.google.com/drive/folders/')) {
        folderId = folderLink.split('/folders/')[1].split('?')[0];
      }

      const buffer = Buffer.from(content.split(",")[1], "base64");
      const fileMetadata = {
        name: `${kairoId}_Certificate.png`,
        parents: folderId ? [folderId] : [],
      };

      const media = {
        mimeType: "image/png",
        body: Readable.from(buffer),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
      });

      // Grant public read permission to the file
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: { role: "reader", type: "anyone" },
      });

      if (process.env.MONGODB_URI && participantData) {
        const fullData = { ...participantData, driveUrl: file.data.webViewLink };
        await Participant.findOneAndUpdate({ kairoId }, fullData, { upsert: true });
      }

      res.json({ success: true, fileId: file.data.id, viewLink: file.data.webViewLink });
    } catch (error: any) {
      console.error("Drive Upload Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Public verification route
  app.get("/api/verify-cert", async (req, res) => {
    const { certNumber } = req.query;
    if (process.env.MONGODB_URI) {
      const participant = await Participant.findOne({ certNumber });
      return participant ? res.json(participant) : res.status(404).json({ error: "Invalid ID" });
    }
    res.status(500).json({ error: "Database not connected" });
  });

  // 6. Vite / Static File Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile("index.html", { root: "dist" }));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server live on port ${PORT}`));
}

startServer();
