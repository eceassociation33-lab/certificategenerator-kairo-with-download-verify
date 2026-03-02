// index.js
const express = require('express');
const drive = require('./services/googleDrive'); // Import the file you just created
const app = express();

app.get('/list-files', async (req, res) => {
  try {
    const response = await drive.files.list({ pageSize: 5 });
    res.json(response.data.files);
  } catch (error) {
    res.status(500).send(error.message);
  }
});
