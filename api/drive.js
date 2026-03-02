const { google } = require('googleapis');

// 1. Authentication Setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    // Fixes the Render/Vercel newline issue in private keys
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

// 2. The Actual API Function
export default async function handler(req, res) {
  try {
    // This example lists the files your "bot" can see
    const response = await drive.files.list({
      pageSize: 10,
      fields: 'files(id, name)',
    });

    res.status(200).json({ success: true, files: response.data.files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}