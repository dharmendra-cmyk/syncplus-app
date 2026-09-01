const express = require('express');
const path = require('path');
const Pool = require('pg').Pool;

// Initialize Stripe securely using environment variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Explicit route for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Create checkout session endpoint with 7-day free trial and payment collection
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 7,
      },
      payment_method_collection: 'always',
      success_url: `${req.protocol}://${req.get('host')}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel.html`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error("Stripe Checkout Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
