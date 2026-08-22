const express = require('express');
const path = require('path');
const app = express();

// Serve static files (like index.html, CSS, and client-side JS) from the current folder
app.use(express.static(__dirname));

// Fallback route to serve index.html for any standard browser visit
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`SyncPlus app is running on port ${PORT}`);
});
