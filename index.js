const express = require('express');
const path = require('path');
const app = express();

// Middleware to parse form data and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files (like index.html, CSS) from the current folder
app.use(express.static(__dirname));

// Handle POST request from the form
app.post('/add', (req, res) => {
  const { productName, stockQuantity } = req.body;
  console.log(`Received new product: ${productName}, Stock: ${stockQuantity}`);
  
  // For now, send back a success confirmation or redirect back to the home page
  res.send(`Successfully added ${productName} with ${stockQuantity} units to the database! <a href="/">Go Back</a>`);
});

// Fallback route to serve index.html for any standard browser visit
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`SyncPlus app is running on port ${PORT}`);
});
