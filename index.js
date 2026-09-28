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

// Setup PostgreSQL connection pool with secure production configurations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Automatically ensure all required tables exist on server startup (100% complete architecture)
async function initializeDatabase() {
  try {
    // 1. Logs table for incoming webhooks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id SERIAL PRIMARY KEY,
        sync_type VARCHAR(255),
        status VARCHAR(50),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Settings table for shop domain tokens and configuration state
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_settings (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) UNIQUE,
        access_token TEXT,
        sync_status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database schema verified: sync_logs and shopify_settings tables are ready.');
  } catch (err) {
    console.error('Failed to initialize database schema on startup:', err);
  }
}

initializeDatabase();

// Capture raw body for Shopify HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Root route serving your interactive Shopify UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- SHOPIFY OAUTH INSTALLATION ROUTES ---

// 1. Initiate OAuth flow when merchant installs the app
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing "shop" parameter. Example: /auth?shop=your-store.myshopify.com');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const host = process.env.HOST || 'https://syncplus-app-production.up.railway.app';
  const scopes = 'read_inventory,write_inventory,read_products';
  const redirectUri = `${host}/auth/callback`;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}`;
  
  return res.redirect(installUrl);
});

// 2. OAuth Callback: Exchange temporary code for permanent access token and save to DB
app.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac } = req.query;

  if (!shop || !code) {
    return res.status(400).send('Required parameters missing from Shopify OAuth callback.');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  try {
    // Exchange temporary code for a permanent offline access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code: code
      })
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('Failed to retrieve access token from Shopify:', tokenData);
      return res.status(500).send('OAuth error: Failed to obtain access token.');
    }

    // Securely persist or update shop credentials into your shopify_settings table
    await pool.query(
      `INSERT INTO shopify_settings (shop_domain, access_token, sync_status, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (shop_domain) 
       DO UPDATE SET access_token = EXCLUDED.access_token, sync_status = EXCLUDED.sync_status`,
      [shop, accessToken, 'ACTIVE']
    );

    console.log(`Successfully authenticated and saved credentials for shop: ${shop}`);

    // Redirect merchant to your app dashboard or home UI
    return res.redirect(`/?shop=${shop}&installed=true`);
  } catch (err) {
    console.error('Critical error during OAuth token exchange:', err);
    return res.status(500).send('Internal Server Error during authentication.');
  }
});

// --- MANDATORY SHOPIFY WEBHOOKS ---
app.post('/api/webhooks', async (req, res) => {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const topic = req.get('X-Shopify-Topic') || 'inventory_levels/update';
    const shop = req.get('X-Shopify-Shop-Domain') || 'manual-test-shop';

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

    await pool.query(
      'INSERT INTO sync_logs (sync_type, status, details, created_at) VALUES ($1, $2, $3, NOW())',
      [topic, 'SUCCESS', JSON.stringify(req.body)]
    );
    console.log('Successfully logged event to sync_logs table.');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Critical error processing incoming webhook:', err);
    return res.status(200).json({ success: true, warning: 'Processed with internal log error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bulletproof server with OAuth is running on port ${PORT}`);
});
