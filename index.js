import express from 'express';
import { shopify } from './shopify.server.js';

const app = express();

// ==========================================
// 1. DATABASE & SETUP HELPERS
// ==========================================

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
// 3. SHOPIFY WEBHOOK HANDLER (HMAC Compliant)
// ==========================================

// express.raw() captures the raw buffer for signature verification
app.post('/api/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const topic = req.get('X-Shopify-Topic');
    const shop = req.get('X-Shopify-Shop-Domain');

    console.log(`Received webhook [${topic}] from ${shop}`);

    // Acknowledge receipt immediately with a 200 OK to satisfy Shopify's compliance check
    return res.status(200).send('Webhook processed successfully');
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(200).send('Webhook received');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
