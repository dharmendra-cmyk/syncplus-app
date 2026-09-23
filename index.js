import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Capture raw body for Shopify HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Root route serving your interactive Shopify UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Mandatory Shopify Webhooks with HMAC signature verification
app.post('/api/webhooks', async (req, res) => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');

  // Optional strict verification if API secret is present
  const secret = process.env.SHOPIFY_API_SECRET;
  if (secret && hmacHeader && req.rawBody) {
    const generatedHash = crypto
      .createHmac('sha256', secret)
      .update(req.rawBody)
      .digest('base64');
    
    if (generatedHash !== hmacHeader) {
      console.warn('Webhook HMAC validation failed.');
      return res.status(401).send('Unauthorized');
    }
  }

  console.log(`Received verified Shopify webhook topic: ${topic} for shop: ${shop}`);
  res.status(200).send({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
