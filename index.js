const express = require('express');
const Pool = require('pg').Pool;

// Initialize Stripe securely using Railway's environment variable
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// IMPORTANT: Webhook route requires the raw body buffer for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify the event using your Stripe Webhook Secret from Railway environment variables
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Checkout session completed for:', session.id);
      // TODO:fulfill your order or update database here
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
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
