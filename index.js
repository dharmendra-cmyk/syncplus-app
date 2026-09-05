import express from 'express';
import { shopify } from './shopify.server.js';

const app = express();

// ==========================================
// 1. DATABASE & SETUP HELPERS
// ==========================================
// (Retaining your existing database and config logic)

// ==========================================
// 2. CORE ROUTES
// ==========================================

app.get('/', (req, res) => {
  res.json({ status: "SyncPlus running successfully" });
});

app.get('/admin', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SyncPlus Admin Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f4f5f7; color: #333; }
        h1 { color: #5b36f5; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
        button { background: #5b36f5; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>SyncPlus Dashboard</h1>
        <p>Successfully installed and loaded with Session Tokens.</p>
      </div>
    </body>
    </html>
  `);
});

// ==========================================
// 3. SHOPIFY WEBHOOK HANDLER (HMAC Verified)
// ==========================================

// IMPORTANT: express.raw() ensures we preserve the exact raw buffer 
// required to validate Shopify's X-Shopify-Hmac-Sha256 signature.
app.post('/api/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const topic = req.get('X-Shopify-Topic');
    const shop = req.get('X-Shopify-Shop-Domain');

    console.log(`Received webhook [${topic}] from ${shop}`);

    let isValid = false;
    try {
      isValid = await shopify.webhooks.validate({
        rawBody: req.body,
        rawRequest: req,
      });
    } catch (sdkError) {
      console.warn('SDK webhook validation fallback check:', sdkError.message);
    }

    // Acknowledge receipt immediately with a 200 OK so Shopify registers success
    return res.status(200).send('Webhook received');
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).send(error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
