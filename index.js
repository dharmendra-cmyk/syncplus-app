const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. STRIPE WEBHOOK ROUTE (RAW BODY ONLY)
// Declared BEFORE express.json() so Express passes
// the unparsed Buffer stream for signature validation.
// ==========================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      console.error('❌ Missing STRIPE_WEBHOOK_SECRET in environment variables.');
      return res.status(500).send('Server environment misconfiguration');
    }

    let event;

    try {
      // Constructs and verifies the event using the raw request body
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Signature Verification Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`⚡ Verified Event Received: [${event.type}] - ID: ${event.id}`);

    // Business Logic Handlers
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`✅ Successful Checkout Session: ${session.id}`);
        console.log(`Customer Email: ${session.customer_details?.email}`);
        // Provision new user account / trigger sync workflow
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log(`✅ Invoice Payment Succeeded: ${invoice.id}`);
        console.log(`Customer ID: ${invoice.customer}`);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        console.log(`✅ Subscription Created: ${subscription.id}`);
        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    // Return 200 OK to acknowledge receipt
    res.status(200).json({ received: true });
  }
);

// ==========================================
// 2. GLOBAL PARSERS & MIDDLEWARE
// Placed strictly AFTER the raw /webhook route.
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ==========================================
// 3. APPLICATION ROUTES
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('SyncPlus API is running successfully.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/sync', (req, res) => {
  const payload = req.body;
  console.log('Received API sync payload:', payload);
  res.status(200).json({ status: 'success', data: payload });
});

// ==========================================
// 4. GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ==========================================
// 5. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 SyncPlus Server running on port ${port}`);
  console.log(`📡 Stripe Webhook Endpoint active at /webhook`);
});
