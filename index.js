import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to allow Shopify iframe embedding (CSP Header)
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com;");
  next();
});

app.use(express.static(path.join(__dirname)));

// Root route for Shopify embedded app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all route to prevent 404 errors during Shopify app review
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SyncPlus app is running on port ${PORT}`);
});
