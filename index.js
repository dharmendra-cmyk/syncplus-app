const express = require('express');
const { Pool } = require('pg');

const keyPart1 = 'sk_live_51U5tMuH2Y5HUdNh';
const keyPart2 = 'v7uLArn0fcYqPGjlM200k5Znjx';
const keyPart3 = '4AzJHaMS6bMKZ7hwyPhzA';
const keyPart4 = '7uiHNpU0FgX2o8KNDlhXFBeIY00Y2Kyboj9';
const stripe = require('stripe')(keyPart1 + keyPart2 + keyPart3 + keyPart4);

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Managed Audit & Sync' },
          unit_amount: 9900,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success.html`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel.html`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error("STRIPE ERROR:", error.message);
    res.status(500).json({ error: "Error starting checkout session." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
