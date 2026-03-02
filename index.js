const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const stream = require('stream');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configure Multer (Handles the file coming from your website)
const upload = multer({ storage: multer.memoryStorage() });

// 2. Google Drive Auth
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth });

// 3. API Route: Upload File
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const response = await drive.files.create({
      requestBody: {
        name: req.file.originalname,
        parents: ['https://drive.google.com/drive/folders/19-WFzCWeIasNb9Hp6PMIHSiRDHMtrUv1?usp=sharing'], // Optional: Folder ID
      },
      media: {
        mimeType: req.file.mimetype,
        body: bufferStream,
      },
      fields: 'id, name',
    });

    res.status(200).json({ success: true, fileId: response.data.id });
  } catch (error) {
    console.error('Drive Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. API Route: List Files (To test connection)
app.get('/list', async (req, res) => {
  try {
    const response = await drive.files.list({ pageSize: 10 });
    res.json(response.data.files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
