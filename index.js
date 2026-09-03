const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. POSTGRESQL DATABASE CONNECTION
// Uses DATABASE_URL provided automatically by Railway
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') 
    ? false 
    : { rejectUnauthorized: false }
});

// Auto-create customers table on startup
async function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      plan VARCHAR(100) DEFAULT 'SyncPlus Pro ($79/mo)',
      status VARCHAR(50) DEFAULT 'active',
      session_id VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log('🗄️ PostgreSQL database table [customers] initialized successfully.');
  } catch (err) {
    console.error('❌ Database Initialization Error:', err.message);
  }
}

initializeDatabase();

// Save or Update Customer in PostgreSQL
async function saveCustomerToDB(customerData) {
  const query = `
    INSERT INTO customers (stripe_customer_id, email, name, plan, status, session_id, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (stripe_customer_id) 
    DO UPDATE SET 
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      session_id = EXCLUDED.session_id,
      updated_at = CURRENT_TIMESTAMP;
  `;
  const values = [
    customerData.stripeCustomerId,
    customerData.email,
    customerData.name,
    customerData.plan,
    customerData.status,
    customerData.sessionId
  ];

  try {
    await pool.query(query, values);
    console.log(`💾 Persisted customer record to Postgres: ${customerData.email}`);
  } catch (err) {
    console.error('❌ PostgreSQL Write Error:', err.message);
  }
}

// ==========================================
// 2. EMAIL TRANSPORTER CONFIGURATION
// ==========================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    console.warn('⚠️ SMTP Configuration Warning:', error.message);
  } else {
    console.log('📧 SMTP Transporter initialized successfully.');
  }
});

// ==========================================
// 3. WORKFLOW HELPERS
// ==========================================
async function provisionUserAccount(session) {
  const customerData = {
    stripeCustomerId: session.customer,
    email: session.customer_details?.email,
    name: session.customer_details?.name,
    plan: 'SyncPlus Pro ($79/mo)',
    status: 'active',
    sessionId: session.id
  };

  await saveCustomerToDB(customerData);
  return customerData;
}

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
        <p>Thank you for subscribing to the <strong>SyncPlus Pro Plan ($79/mo)</strong>. Your account has been provisioned successfully.</p>
        
        <div style="background-color: #f7f9fc; border-left: 4px solid #635bff; padding: 15px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Session ID:</strong> ${sessionId}</p>
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
    console.log(`✉️ Welcome email dispatched to ${customerEmail} (ID: ${info.messageId})`);
  } catch (err) {
    console.error(`❌ Error dispatching welcome email to ${customerEmail}:`, err.message);
  }
}

// ==========================================
// 4. STRIPE WEBHOOK ROUTE (RAW BODY ONLY)
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
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Signature Verification Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`⚡ Verified Event Received: [${event.type}] - ID: ${event.id}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          console.log(`✅ Successful Checkout Session: ${session.id}`);

          const user = await provisionUserAccount(session);
          await sendWelcomeEmail(user.email, user.name, session.id);
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object;
          console.log(`✅ Invoice Payment Succeeded: ${invoice.id}`);
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
      console.error(`❌ Error executing handler for event [${event.type}]:`, handlerErr);
    }

    res.status(200).json({ received: true });
  }
);

// ==========================================
// 5. GLOBAL PARSERS & MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ==========================================
// 6. APPLICATION ROUTES
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

app.get('/api/customers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.status(200).json({ count: result.rowCount, customers: result.rows });
  } catch (err) {
    console.error('❌ Error fetching customers:', err.message);
    res.status(500).json({ error: 'Failed to fetch customer records' });
  }
});

// ==========================================
// 7. GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ==========================================
// 8. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 SyncPlus Server running on port ${port}`);
  console.log(`📡 Stripe Webhook Endpoint active at /webhook`);
});
