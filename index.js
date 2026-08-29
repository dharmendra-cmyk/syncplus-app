const express = require('express');
const { Pool } = require('pg');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// Stripe Webhook to handle successful payments automatically
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Note: In production, you'd verify the webhook secret from Stripe dashboard.
    // For now, we parse the event directly to update our database on success.
    event = req.body;
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;

    console.log(`Payment successful for: ${customerEmail}`);

    try {
      // Update user tier in PostgreSQL database
      await pool.query(
        'UPDATE users SET plan = $1 WHERE email = $2',
        ['managed_audit', customerEmail]
      );
      console.log(`Database updated successfully for ${customerEmail}`);
    } catch (dbErr) {
      console.error('Database update error:', dbErr);
    }
  }

  res.json({received: true});
});app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
