const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. POSTGRESQL DATABASE CONNECTION
// ==========================================
let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false }
  });
  console.log('🔗 PostgreSQL pool configured with provided DATABASE_URL.');
} else {
  console.warn('⚠️ DATABASE_URL not found in environment variables. DB operations bypassed.');
}

async function initializeDatabase() {
  if (!pool) return;

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
    console.log('🗄️ PostgreSQL table [customers] initialized successfully.');
  } catch (err) {
    console.error('❌ DB Init Error:', err.message);
  }
}

initializeDatabase();

async function saveCustomerToDB(customerData) {
  if (!pool) {
    console.log(`ℹ️ [DB Bypass] Skipping DB write for ${customerData.email} (DATABASE_URL not set).`);
    return;
  }

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
    console.log(`💾 Persisted customer record: ${customerData.email}`);
  } catch (err) {
    console.error('❌ DB Write Error:', err.message);
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
  if (!customerEmail) return;

  const mailOptions = {
    from: `"SyncPlus Team" <${process.env.SMTP_USER || 'support@syncplus.app'}>`,
    to: customerEmail,
    subject: 'Welcome to SyncPlus Pro! 🚀 Account Activated',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Welcome to SyncPlus Pro, ${customerName || 'Merchant'}!</h2>
        <p>Your subscription is active. Session ID: ${sessionId}</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ Welcome email dispatched to ${customerEmail}`);
  } catch (err) {
    console.error(`❌ Email Error:`, err.message);
  }
}

// ==========================================
// 4. STRIPE WEBHOOK ROUTE (RAW BODY ONLY)
// ==========================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET');
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const user = await provisionUserAccount(session);
        await sendWelcomeEmail(user.email, user.name, session.id);
      }
    } catch (handlerErr) {
      console.error(`❌ Handler Error:`, handlerErr);
    }

    res.status(200).json({ received: true });
  }
);

// ==========================================
// 5. GLOBAL MIDDLEWARE & ROUTES
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.status(200).send('SyncPlus API is running successfully.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    dbConnected: Boolean(pool),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/customers', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'Database service not connected' });
  }
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.status(200).json({ count: result.rowCount, customers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 SyncPlus Server running on port ${port}`);
  console.log(`📡 Stripe Webhook Endpoint active at /webhook`);
});
