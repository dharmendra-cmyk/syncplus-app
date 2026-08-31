const express = require('express');
const { Pool } = require('pg');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// IMPORTANT: Webhook route requires the raw body buffer for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify the event using your Stripe Webhook Secret from Railway environment variables
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the specific subscription events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`✅ Checkout Session Completed for customer:`, session.customer);
      // TODO: Update your PostgreSQL database to provision Pro access here!
      break;

    case 'customer.subscription.updated':
      const subscription = event.data.object;
      console.log(`🔄 Subscription updated to status:`, subscription.status);
      break;

    case 'customer.subscription.deleted':
      const canceledSubscription = event.data.object;
      console.log(`❌ Subscription canceled/ended:`, canceledSubscription.id);
      // TODO: Revoke Pro access in your database here!
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Acknowledge receipt of the event to Stripe
  res.json({ received: true });
});

// Standard middleware for JSON parsing on all other routes
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
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${req.headers.origin}/?success=true`,
      cancel_url: `${req.headers.origin}/?canceled=true`,
    });
    res.json({ url: stripeSession.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`SyncPulse app running on port ${port}`);
});
