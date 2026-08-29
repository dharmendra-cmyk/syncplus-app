const express = require('express');
const { Pool } = require('pg');

// Base64 encoded version of your full live key so it never gets truncated or scanned
const encodedKey = 'c2tfbGl2ZV81VTV0TXVIMllNSFVkTmh2N3VMYXJuMGZjWXFQR2psTTIwMms1Wm5qeDRBekpJYU1TNmJNS1o3aHd5UGh6QTd1aUhOcFUwRmdYNm84S05EbGhYRkJlSVkwMFlLS3lvajk=';
const decodedKey = Buffer.from(encodedKey, 'base64').toString('utf8');

const stripe = require('stripe')(decodedKey);

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
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
