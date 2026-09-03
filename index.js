const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. EMAIL TRANSPORTER CONFIGURATION
// ==========================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify email SMTP connection on server startup
transporter.verify((error) => {
  if (error) {
    console.warn('⚠️ SMTP Configuration Warning:', error.message);
  } else {
    console.log('📧 SMTP Transporter initialized successfully');
  }
});

// ==========================================
// 2. AUTOMATED WELCOME EMAIL TRIGGER
// ==========================================
async function sendWelcomeEmail(customerEmail, customerName, sessionId) {
  if (!customerEmail) {
    console.warn('⚠️ No customer email provided for welcome message');
    return;
  }

  const mailOptions = {
    from: `"SyncPlus Team" <${process.env.SMTP_USER || 'support@syncplus.app'}>`,
    to: customerEmail,
    subject: 'Welcome to SyncPlus Pro! 🚀 Account Activated',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h2 style="color: #635bff;">Welcome to SyncPlus Pro, ${customerName || 'Merchant'}!</h2>
        <p>Thank you for subscribing to the <strong>SyncPlus Pro Plan ($79/mo)</strong>. Your payment has been processed successfully.</p>
        
        <div style="background-color: #f7f9fc; border-left: 4px solid #635bff; padding: 15px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Order Confirmation ID:</strong> ${sessionId}</p>
          <p style="margin: 5px 0 0 0;"><strong>Status:</strong> Active Pro Membership</p>
        </div>

        <h3>Next Steps to Get Started:</h3>
        <ol>
          <li>Log in to your SyncPlus dashboard using this email address.</li>
          <li>Connect your Shopify or ERP inventory endpoints.</li>
          <li>Set up automated sync frequencies for your catalog.</li>
        </ol>

        <p>If you have any questions or need assistance with initial catalog mapping, reply directly to this email or reach out via Instagram DM.</p>
        
        <br>
        <p>Best regards,<br><strong>The SyncPlus Team</strong></p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Welcome email dispatched to ${customerEmail} (Message ID: ${info.messageId})`);
  } catch (err) {
    console.error(`❌ Error dispatching welcome email to ${customerEmail}:`, err.message);
  }
}

// ==========================================
// 3. STRIPE WEBHOOK ROUTE (RAW BODY ONLY)
// Declared BEFORE express.json() to maintain unparsed
// Buffer for cryptographic signature validation.
// ==========================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      console.error('❌ Missing STRIPE_WEBHOOK_SECRET in environment variables.');
      return res.status(500).send('Server environment misconfiguration');
    }

    let event;

    try {
      // Construct and cryptographically verify event using raw buffer
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Signature Verification Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`⚡ Verified Event Received: [${event.type}] - ID: ${event.id}`);

    // Business Logic Handlers
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const customerEmail = session.customer_details?.email;
          const customerName = session.customer_details?.name;

          console.log(`✅ Successful Checkout Session: ${session.id}`);
          console.log(`Customer Email: ${customerEmail}`);

          // Trigger automated onboarding welcome email
          await sendWelcomeEmail(customerEmail, customerName, session.id);
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
    } catch (handlerErr) {
      console.error(`❌ Handler Execution Error for event [${event.type}]:`, handlerErr);
    }

    // Always acknowledge receipt back to Stripe with 200 OK
    res.status(200).json({ received: true });
  }
);

// ==========================================
// 4. GLOBAL PARSERS & MIDDLEWARE
// Applied strictly AFTER the raw /webhook route.
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
// 5. APPLICATION ROUTES
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
// 6. GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ==========================================
// 7. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 SyncPlus Server running on port ${port}`);
  console.log(`📡 Stripe Webhook Endpoint active at /webhook`);
});
