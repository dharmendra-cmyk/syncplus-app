const express = require('express');
const Pool = require('pg').Pool;

// Initialize Stripe securely with split lines
const stripe = require('stripe')(
  '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'
);

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static(__dirname + '/HTML'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Stripe Checkout Session Endpoint for Stocky Migration / Pro Upgrade
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${req.protocol}://${req.get('host')}/index.html?success=true`,
      cancel_url: `${req.protocol}://${req.get('host')}/index.html?canceled=true`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Stripe Checkout Error Details:', error.raw || error);
    res.status(500).json({ error: error.message, type: error.type });
  }
});

app.listen(port, () => {
  console.log(`SyncPulse server running on port ${port}`);
});
