// Add these routes to your main server entry point (e.g., index.js)
import express from 'express';

const app = express();

// Ensure raw body parsing or standard json parsing is active depending on your Shopify verification setup
app.use(express.json());

// Mandatory Shopify GDPR Compliance Webhooks
app.post('/api/webhooks', async (req, res) => {
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');
  
  console.log(`Received Shopify webhook topic: ${topic} for shop: ${shop}`);

  switch (topic) {
    case 'customers/data_request':
      // Handle customer data request logic here
      break;
    case 'customers/redact':
      // Handle customer data erasure logic here
      break;
    case 'shop/redact':
      // Handle store data cleanup from PostgreSQL tables here
      break;
    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  // Always respond with 200 OK quickly so Shopify logs a successful delivery
  res.status(200).send({ success: true });
});
