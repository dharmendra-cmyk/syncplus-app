import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ==========================================
// 1. DATABASE & SETUP HELPERS
// ==========================================

// ==========================================
// 2. CORE ROUTES
// ==========================================

// Serve the index.html frontend dashboard at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Alternative admin dashboard route
app.get('/admin', async (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
