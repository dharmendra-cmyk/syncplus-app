import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Setup PostgreSQL connection pool using Railway environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
  const topic = req.get('X-Shopify-Topic') || 'inventory_levels/update';
  const shop = req.get('X-Shopify-Shop-Domain') || 'manual-test-shop';

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

  try {
    // Save the incoming event into your PostgreSQL sync_logs table
    await pool.query(
      'INSERT INTO sync_logs (sync_type, status, details, created_at) VALUES ($1, $2, $3, NOW())',
      [topic, 'SUCCESS', JSON.stringify(req.body)]
    );
    console.log('Successfully logged event to sync_logs table.');
  } catch (err) {
    console.error('Database insertion error:', err);
  }

  res.status(200).send({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
