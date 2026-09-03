const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 8080;

// ==========================================
// 1. POSTGRESQL DATABASE CONNECTION & INIT
// ==========================================
let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
    });
    console.log('🔗 PostgreSQL pool initialized.');
  }
  return pool;
}

async function initializeDatabase() {
  const activePool = getPool();
  if (!activePool) return;

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

  try {
    await activePool.query(createCustomersTable);
    await activePool.query(createInventoryTable);
    console.log('🗄️ PostgreSQL tables [customers, inventory] initialized successfully.');
  } catch (err) {
    console.error('❌ DB Init Error:', err.message);
  }
}

initializeDatabase();

async function saveCustomerToDB(customerData) {
  const activePool = getPool();
  if (!activePool) return;

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
    await activePool.query(query, values);
    console.log(`💾 Persisted customer record: ${customerData.email}`);
  } catch (err) {
    console.error('❌ DB Write Error:', err.message);
  }
}

async function updateCustomerSubscription(subscription) {
  const activePool = getPool();
  if (!activePool) return;

  const query = `
    UPDATE customers 
    SET status = $1, updated_at = CURRENT_TIMESTAMP 
    WHERE stripe_customer_id = $2;
  `;

  try {
    await activePool.query(query, [subscription.status, subscription.customer]);
    console.log(`🔄 Updated status to [${subscription.status}] for: ${subscription.customer}`);
  } catch (err) {
    console.error('❌ DB Update Error:', err.message);
  }
}

// ==========================================
// 2. EMAIL TRANSPORTER & ALERT HELPERS
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

async function sendLowStockAlert(sku, productName, quantity, channel) {
  if (!process.env.SMTP_USER) return;

  const mailOptions = {
    from: `"SyncPlus Alerts" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    subject: `⚠️ Low Stock Alert: SKU ${sku} (${quantity} left)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e4e8; border-radius: 8px;">
        <h2 style="color: #d97706;">⚠️ Low Stock Threshold Warning</h2>
        <p>The inventory level for <strong>${productName}</strong> has dropped below threshold level.</p>
        <ul>
          <li><strong>SKU:</strong> ${sku}</li>
          <li><strong>Remaining Quantity:</strong> ${quantity}</li>
          <li><strong>Channel:</strong> ${channel}</li>
        </ul>
        <p>Please restock immediately to avoid stockout on sales channels.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ Low stock alert dispatched for SKU: ${sku}`);
  } catch (err) {
    console.error(`❌ Alert Email Error:`, err.message);
  }
}

async function provisionUserAccount(session) {
  const customerData = {
    stripeCustomerId: session.customer || `cus_mock_${Date.now()}`,
    email: session.customer_details?.email || 'test@syncplus.app',
    name: session.customer_details?.name || 'Valued Customer',
    plan: 'SyncPlus Pro ($79/mo)',
    status: 'active',
    sessionId: session.id
  };

  await saveCustomerToDB(customerData);
  return customerData;
}

async function sendWelcomeEmail(customerEmail, customerName, sessionId) {
  if (!customerEmail || !process.env.SMTP_USER) return;

  const mailOptions = {
    from: `"SyncPlus Team" <${process.env.SMTP_USER}>`,
    to: customerEmail,
    subject: 'Welcome to SyncPlus Pro! 🚀 Account Activated',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #635bff;">Welcome to SyncPlus Pro, ${customerName || 'Merchant'}!</h2>
        <p>Thank you for subscribing to the <strong>SyncPlus Pro Plan ($79/mo)</strong>. Your account has been provisioned successfully.</p>
        <p>Session ID: ${sessionId}</p>
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
// 3. STRIPE WEBHOOK ROUTE
// ==========================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET');

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`❌ Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`⚡ Verified Event Received: [${event.type}] - ID: ${event.id}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const user = await provisionUserAccount(session);
          await sendWelcomeEmail(user.email, user.name, session.id);
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          await updateCustomerSubscription(event.data.object);
          break;
        }
      }
    } catch (handlerErr) {
      console.error(`❌ Handler Error:`, handlerErr);
    }

    res.status(200).json({ received: true });
  }
);

// ==========================================
// 4. GLOBAL MIDDLEWARE & ROUTES
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Landing Page
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SyncPlus Pro - Real-Time Inventory Sync</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid #334155; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
        h1 { color: #38bdf8; margin-top: 0; }
        .price { font-size: 42px; font-weight: bold; margin: 20px 0; }
        .price span { font-size: 18px; color: #94a3b8; }
        ul { text-align: left; padding-left: 20px; color: #cbd5e1; margin-bottom: 30px; line-height: 1.8; }
        .btn { background: #635bff; color: white; border: none; padding: 14px 28px; font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; width: 80%; transition: background 0.2s; }
        .btn:hover { background: #4f46e5; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>SyncPlus Pro</h1>
        <p>Automate multi-channel inventory control.</p>
        <div class="price">$79 <span>/ month</span></div>
        <ul>
          <li>Real-time multi-channel sync</li>
          <li>PostgreSQL database audit logging</li>
          <li>Automated order fulfillment tracking</li>
          <li>24/7 Webhook monitoring</li>
        </ul>
        <a href="/checkout" class="btn">Subscribe Now</a>
      </div>
    </body>
    </html>
  `;
  res.status(200).send(html);
});

// Checkout Redirect
app.get('/checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'SyncPlus Pro Plan',
              description: 'Real-time multi-channel inventory synchronization',
            },
            unit_amount: 7900,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `https://syncplus-app-production.up.railway.app/admin?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://syncplus-app-production.up.railway.app/`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('❌ Checkout Error:', err.message);
    res.status(500).send(`Checkout Session Error: ${err.message}`);
  }
});

// Health Endpoint
app.get('/health', (req, res) => {
  const activePool = getPool();
  res.status(200).json({
    status: 'OK',
    dbConnected: Boolean(activePool),
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 5. INVENTORY SYNC API & ADMIN ROUTES
// ==========================================

// API to Fetch All Inventory
app.get('/api/inventory', async (req, res) => {
  const activePool = getPool();
  if (!activePool) return res.status(200).json({ count: 0, inventory: [] });
  try {
    const result = await activePool.query('SELECT * FROM inventory ORDER BY sku ASC');
    res.status(200).json({ count: result.rowCount, inventory: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API & Form Handler to Sync/Upsert Inventory Stock
app.post('/api/inventory/sync', async (req, res) => {
  const activePool = getPool();
  if (!activePool) return res.status(500).json({ error: 'Database not available' });

  const { sku, productName, quantity, channel } = req.body;

  if (!sku || !productName || quantity === undefined) {
    return res.status(400).json({ error: 'Missing required fields: sku, productName, quantity' });
  }

  const stockQty = parseInt(quantity);
  const targetChannel = channel || 'Shopify';

  const query = `
    INSERT INTO inventory (sku, product_name, quantity, channel, last_synced)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (sku)
    DO UPDATE SET
      product_name = EXCLUDED.product_name,
      quantity = EXCLUDED.quantity,
      channel = EXCLUDED.channel,
      last_synced = CURRENT_TIMESTAMP;
  `;

  try {
    await activePool.query(query, [sku, productName, stockQty, targetChannel]);
    console.log(`📦 Inventory synced for SKU: ${sku} (${stockQty} units)`);

    // Check low stock threshold alert (under 10 units)
    if (stockQty < 10) {
      await sendLowStockAlert(sku, productName, stockQty, targetChannel);
    }
    
    // Redirect back to Admin if submitted via Form
    if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      return res.redirect('/admin');
    }

    res.status(200).json({ success: true, sku, quantity: stockQty, channel: targetChannel });
  } catch (err) {
    console.error('❌ Inventory Sync Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin Dashboard
app.get('/admin', async (req, res) => {
  const activePool = getPool();
  let customers = [];
  let inventory = [];

  if (activePool) {
    try {
      const custResult = await activePool.query('SELECT * FROM customers ORDER BY created_at DESC');
      customers = custResult.rows;

      const invResult = await activePool.query('SELECT * FROM inventory ORDER BY sku ASC');
      inventory = invResult.rows;
    } catch (err) {
      console.error('❌ Error fetching admin records:', err.message);
    }
  }

  const customerRows = customers.map(c => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${c.id}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;"><strong>${c.email}</strong></td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${c.name || 'N/A'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;"><span style="background: ${c.status === 'active' ? '#e6f4ea' : '#fce8e6'}; color: ${c.status === 'active' ? '#137333' : '#c5221f'}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${c.status}</span></td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${c.plan}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${c.stripe_customer_id}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${new Date(c.created_at).toLocaleString()}</td>
    </tr>
  `).join('');

  const inventoryRows = inventory.map(i => {
    const isLowStock = i.quantity < 10;
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;"><strong>${i.sku}</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${i.product_name}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">
          <span style="background: ${isLowStock ? '#fef3c7' : '#f0fdf4'}; color: ${isLowStock ? '#b45309' : '#15803d'}; padding: 4px 10px; border-radius: 4px; font-weight: bold;">
            ${i.quantity} ${isLowStock ? '⚠️ Low Stock' : ''}
          </span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${i.channel}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e1e4e8;">${new Date(i.last_synced).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const activeCount = customers.filter(c => c.status === 'active').length;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SyncPlus Admin Dashboard</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; background-color: #f6f8fa; color: #24292e; }
        .container { max-width: 1100px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        h1, h2 { color: #635bff; }
        .stats { display: flex; gap: 20px; margin: 20px 0; }
        .card { background: #f7f9fc; padding: 15px 25px; border-radius: 6px; border: 1px solid #e1e4e8; flex: 1; }
        .card h3 { margin: 0; font-size: 14px; color: #586069; }
        .card p { margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #24292e; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 40px; text-align: left; }
        th { padding: 12px; background-color: #f6f8fa; border-bottom: 2px solid #e1e4e8; color: #586069; font-size: 13px; text-transform: uppercase; }
        .sync-form { background: #f8fafc; padding: 20px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 30px; display: flex; gap: 10px; align-items: flex-end; }
        .form-group { display: flex; flex-direction: column; gap: 5px; flex: 1; }
        .form-group label { font-size: 12px; font-weight: bold; color: #475569; }
        .form-group input, .form-group select { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 14px; }
        .btn-submit { background: #635bff; color: white; border: none; padding: 9px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; }
        .btn-submit:hover { background: #4f46e5; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>SyncPlus Admin Dashboard</h1>
        <p>Live Customer Subscriptions & Multi-Channel Inventory Control</p>
        
        <div class="stats">
          <div class="card">
            <h3>Active Subscribers</h3>
            <p>${activeCount}</p>
          </div>
          <div class="card">
            <h3>Monthly Recurring Revenue (MRR)</h3>
            <p>$${activeCount * 79}</p>
          </div>
          <div class="card">
            <h3>Synced SKUs</h3>
            <p>${inventory.length}</p>
          </div>
        </div>

        <h2>Sync Inventory Stock</h2>
        <form class="sync-form" action="/api/inventory/sync" method="POST">
          <div class="form-group">
            <label>SKU</label>
            <input type="text" name="sku" placeholder="PROD-101" required />
          </div>
          <div class="form-group">
            <label>Product Name</label>
            <input type="text" name="productName" placeholder="Pro Wireless Earbuds" required />
          </div>
          <div class="form-group">
            <label>Quantity</label>
            <input type="number" name="quantity" placeholder="150" required />
          </div>
          <div class="form-group">
            <label>Sales Channel</label>
            <select name="channel">
              <option value="Shopify">Shopify</option>
              <option value="Amazon">Amazon</option>
              <option value="WooCommerce">WooCommerce</option>
            </select>
          </div>
          <button type="submit" class="btn-submit">Sync Stock</button>
        </form>

        <h2>Multi-Channel Inventory Status</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product Name</th>
              <th>Stock Level</th>
              <th>Channel</th>
              <th>Last Synced</th>
            </tr>
          </thead>
          <tbody>
            ${inventoryRows || '<tr><td colspan="5" style="padding: 20px; text-align: center;">No inventory records synced yet.</td></tr>'}
          </tbody>
        </table>

        <h2>Customer Subscriptions</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Name</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Stripe ID</th>
              <th>Subscribed At</th>
            </tr>
          </thead>
          <tbody>
            ${customerRows || '<tr><td colspan="7" style="padding: 20px; text-align: center;">No customer subscriptions found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;

  res.status(200).send(html);
});

// ==========================================
// 6. SERVER INITIALIZATION
// ==========================================
app.listen(port, () => {
  console.log(`🚀 SyncPlus Server running on port ${port}`);
  console.log(`📡 Stripe Webhook Endpoint active at /webhook`);
  console.log(`📊 Admin Dashboard available at /admin`);
});
