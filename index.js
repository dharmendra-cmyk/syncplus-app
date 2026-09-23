import express from 'express';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Root route to serve your interactive UI and satisfy Shopify app review requirement 2.1.3
app.get('/', (req, res) => {
  res.sendFile('./index.html', { root: '.' });
});

// Mandatory Shopify GDPR Compliance Webhooks
app.post('/api/webhooks', async (req, res) => {
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');

  console.log(`Received Shopify webhook topic: ${topic} for shop: ${shop}`);
  res.status(200).send({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
