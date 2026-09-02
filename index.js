const express = require('express');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

app.set('trust proxy', 1);

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

// Automatically create all required tables on startup if they don't exist
async function initializeDatabase() {
  try {
    // Subscriptions Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        subscription_id VARCHAR(255) UNIQUE,
        customer_id VARCHAR(255),
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Inventory Items Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        sku VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        quantity INT DEFAULT 0,
        safety_threshold INT DEFAULT 10,
        unit_cost DECIMAL(10,2) DEFAULT 0,
        location VARCHAR(100) DEFAULT 'Main Warehouse',
        supplier VARCHAR(255),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Invoices Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_id VARCHAR(255) UNIQUE NOT NULL,
        customer_id VARCHAR(255),
        customer_email VARCHAR(255),
        amount_due DECIMAL(10,2),
        amount_paid DECIMAL(10,2),
        currency VARCHAR(10) DEFAULT 'usd',
        status VARCHAR(50),
        hosted_invoice_url TEXT,
        pdf_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Shopify Integration Settings Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_settings (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        sync_status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sync Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id SERIAL PRIMARY KEY,
        sync_type VARCHAR(100),
        status VARCHAR(50),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic Routes
app.get('/', (req, res) => {
  res.send('SyncPlus App is running successfully!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// Stripe Webhook Endpoint
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle specific Stripe events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`Checkout Session Completed: ${session.id}`);
      try {
        await pool.query(
          'INSERT INTO subscriptions (subscription_id, customer_id, status) VALUES ($1, $2, $3) ON CONFLICT (subscription_id) DO UPDATE SET status = $3',
          [session.subscription, session.customer, 'active']
        );
      } catch (dbErr) {
        console.error('Error saving subscription to database:', dbErr);
      }
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      console.log(`Subscription status updated: ${subscription.id} -> ${subscription.status}`);
      try {
        await pool.query(
          'UPDATE subscriptions SET status = $1 WHERE subscription_id = $2',
          [subscription.status, subscription.id]
        );
      } catch (dbErr) {
        console.error('Error updating subscription status:', dbErr);
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Start Server and Initialize DB
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initializeDatabase();
});
