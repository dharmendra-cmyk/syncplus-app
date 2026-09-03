const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. STRIPE WEBHOOK ROUTE (CRITICAL FIX)
// Must come BEFORE express.json() to capture
// the raw unparsed Request Buffer for signature verification.
// ==========================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      // Constructs and verifies the event using the raw request body
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Signature Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle incoming Stripe events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`✅ Payment received for session: ${session.id}`);
        // Add your user provisioning / DB updates here
        break;
      }
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        console.log(`✅ Subscription created: ${subscription.id}`);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log(`✅ Invoice paid: ${invoice.id}`);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Return a 200 OK response to Stripe to acknowledge receipt
    res.json({ received: true });
  }
);

// ==========================================
// 2. GLOBAL MIDDLEWARE
// Parsers placed AFTER /webhook so they do not 
// mutate the raw buffer expected by Stripe.
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 3. APPLICATION ROUTES
// ==========================================
app.get('/', (req, res) => {
  res.send('SyncPlus API is running successfully.');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Example API endpoint receiving JSON data
app.post('/api/sync', (req, res) => {
  const payload = req.body;
  console.log('Received sync payload:', payload);
  res.json({ status: 'success', message: 'Sync processed successfully' });
});

// ==========================================
// 4. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 Webhook endpoint ready at http://localhost:${port}/webhook`);
});
