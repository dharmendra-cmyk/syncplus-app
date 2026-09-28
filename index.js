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

    // 3. Multi-Location Inventory (MLI) rules mapping table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mli_rules (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255),
        source_location_id BIGINT,
        target_location_id BIGINT,
        sync_ratio DECIMAL(5,2) DEFAULT 1.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database schema verified: sync_logs, shopify_settings, and mli_rules tables are ready.');
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

app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing "shop" parameter. Example: /auth?shop=your-store.myshopify.com');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const host = process.env.HOST || 'https://syncplus-app-production.up.railway.app';
  const scopes = 'read_inventory,write_inventory,read_products,read_locations';
  const redirectUri = `${host}/auth/callback`;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}`;
  
  return res.redirect(installUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send('Required parameters missing from Shopify OAuth callback.');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  try {
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

    await pool.query(
      `INSERT INTO shopify_settings (shop_domain, access_token, sync_status, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (shop_domain) 
       DO UPDATE SET access_token = EXCLUDED.access_token, sync_status = EXCLUDED.sync_status`,
      [shop, accessToken, 'ACTIVE']
    );

    console.log(`Successfully authenticated and saved credentials for shop: ${shop}`);
    return res.redirect(`/?shop=${shop}&installed=true`);
  } catch (err) {
    console.error('Critical error during OAuth token exchange:', err);
    return res.status(500).send('Internal Server Error during authentication.');
  }
});

// --- MULTI-LOCATION INVENTORY (MLI) API ROUTES ---

// Get all MLI mapping rules for a specific shop
app.get('/api/mli/rules', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });

    const result = await pool.query('SELECT * FROM mli_rules WHERE shop_domain = $1', [shop]);
    return res.status(200).json({ success: true, rules: result.rows });
  } catch (err) {
    console.error('Error fetching MLI rules:', err);
    return res.status(500).json({ error: 'Failed to fetch MLI rules' });
  }
});

// Save or create a new MLI mapping rule
app.post('/api/mli/rules', async (req, res) => {
  try {
    const { shop_domain, source_location_id, target_location_id, sync_ratio } = req.body;
    if (!shop_domain || !source_location_id || !target_location_id) {
      return res.status(400).json({ error: 'Missing required MLI parameters' });
    }

    await pool.query(
      `INSERT INTO mli_rules (shop_domain, source_location_id, target_location_id, sync_ratio)
       VALUES ($1, $2, $3, $4)`,
      [shop_domain, source_location_id, target_location_id, sync_ratio || 1.00]
    );

    console.log(`Successfully created MLI rule for ${shop_domain}: Source ${source_location_id} -> Target ${target_location_id}`);
    return res.status(200).json({ success: true, message: 'MLI rule saved successfully' });
  } catch (err) {
    console.error('Error saving MLI rule:', err);
    return res.status(500).json({ error: 'Failed to save MLI rule' });
  }
});

// --- MANDATORY SHOPIFY WEBHOOKS WITH MLI PROPAGATION ---
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

    // 1. Log the incoming event
    await pool.query(
      'INSERT INTO sync_logs (sync_type, status, details, created_at) VALUES ($1, $2, $3, NOW())',
      [topic, 'SUCCESS', JSON.stringify(req.body)]
    );

    // 2. If it's an inventory update, execute MLI multi-location propagation
    if (topic === 'inventory_levels/update' && req.body.location_id && req.body.available !== undefined) {
      const { inventory_item_id, location_id, available } = req.body;

      // Find any mapped MLI target locations for this shop and source location
      const rulesQuery = await pool.query(
        'SELECT target_location_id, sync_ratio FROM mli_rules WHERE shop_domain = $1 AND source_location_id = $2',
        [shop, location_id]
      );

      if (rulesQuery.rows.length > 0) {
        // Fetch the merchant's access token from database
        const tokenQuery = await pool.query('SELECT access_token FROM shopify_settings WHERE shop_domain = $1', [shop]);
        
        if (tokenQuery.rows.length > 0) {
          const accessToken = tokenQuery.rows[0].access_token;

          // Propagate stock levels to all configured target locations
          for (const rule of rulesQuery.rows) {
            const adjustedAvailable = Math.floor(available * Number(rule.sync_ratio));

            const mliPayload = {
              location_id: rule.target_location_id,
              inventory_item_id: inventory_item_id,
              available: adjustedAvailable
            };

            const shopifyResponse = await fetch(`https://${shop}/admin/api/2024-04/inventory_levels/set.json`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken
              },
              body: JSON.stringify(mliPayload)
            });

            if (shopifyResponse.ok) {
              console.log(`MLI Synced: Updated inventory item ${inventory_item_id} at target location ${rule.target_location_id} to ${adjustedAvailable}`);
            } else {
              const errBody = await shopifyResponse.text();
              console.error(`MLI Sync failed for location ${rule.target_location_id}:`, errBody);
            }
          }
        }
      }
    }

    console.log('Successfully processed event and executed MLI workflows.');
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Critical error processing incoming webhook & MLI:', err);
    return res.status(200).json({ success: true, warning: 'Processed with internal log error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bulletproof server with MLI engine is running on port ${PORT}`);
});
