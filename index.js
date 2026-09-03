const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. POSTGRESQL DATABASE CONNECTION & INIT
// ==========================================
let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.error('CRITICAL ERROR: DATABASE_URL is not set in environment variables!');
      return null;
    }
    try {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') 
          ? false 
          : { rejectUnauthorized: false }
      });
      console.log('PostgreSQL pool initialized successfully.');
    } catch (err) {
      console.error('Failed to initialize PostgreSQL pool:', err);
      return null;
    }
  }
  return pool;
}

// ==========================================
// 2. ROUTES
// ==========================================
app.get('/', (req, res) => {
  const dbPool = getPool();
  if (!dbPool) {
    return res.status(500).json({ error: "Database not available" });
  }
  res.json({ status: "SyncPlus running successfully" });
});

app.get('/admin', async (req, res) => {
  const dbPool = getPool();
  if (!dbPool) {
    return res.status(500).json({ error: "Database not available" });
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SyncPlus Admin Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f4f5f7; color: #333; }
        h1 { color: #5b36f5; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
        button { background: #5b36f5; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>SyncPlus Admin Dashboard</h1>
        <p>Live Customer Subscriptions & Multi-Channel Inventory Control</p>
        <button onclick="alert('Sync triggered successfully!')">Sync Stock</button>
      </div>
    </body>
    </html>
  `);
});

// ==========================================
// 3. DATABASE TABLES INIT & SERVER START
// ==========================================
const createCustomersTable = `
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

const createInventoryTable = `
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(100) UNIQUE NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  channel VARCHAR(100) DEFAULT 'Shopify',
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
`;

async function startServer() {
  const dbPool = getPool();
  if (dbPool) {
    try {
      await dbPool.query(createCustomersTable);
      await dbPool.query(createInventoryTable);
      console.log('PostgreSQL tables initialized successfully.');
    } catch (err) {
      console.error('DB Init Error:', err.message);
    }
  }

  app.listen(port, () => {
    console.log(`SyncPlus Server running on port ${port}`);
    console.log('Admin Dashboard available at /admin');
  });
}

startServer();
