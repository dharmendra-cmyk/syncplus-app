const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL Connection Pool using Railway's environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware to parse form data and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Database Table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    stock_quantity INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(err => console.error('Error creating table:', err));

// Serve Frontend Dashboard
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Route to Add Inventory Item from Dashboard
app.post('/add-product', async (req, res) => {
  const { productName, stockQuantity } = req.body;
  try {
    const query = 'INSERT INTO inventory (product_name, stock_quantity) VALUES ($1, $2) RETURNING *';
    await pool.query(query, [productName, stockQuantity]);
    
    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #0b0f19; color: #f3f4f6; height: 100vh; padding-top: 50px;">
        <h2 style="color: #10b981;">Successfully added "${productName}" with ${stockQuantity} units to your PostgreSQL database!</h2>
        <a href="/" style="color: #635bff; text-decoration: none; font-weight: bold; background: #111827; padding: 10px 20px; border-radius: 6px; border: 1px solid #374151;">Go Back</a>
      </div>
    `);
  } catch (err) {
    console.error('Database insertion error:', err);
    res.status(500).send('Error saving product to database.');
  }
});

// Stripe Webhook Endpoint for Payment Automation
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = req.body;

  // Handle successful payment events from Stripe
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    const paymentObject = event.data.object;
    console.log('Payment successful received from Stripe:', paymentObject.id);
    // Add custom post-payment logic here (e.g., updating user subscription status or license generation)
  }

  res.json({ received: true });
});

// Start Server
app.listen(port, () => {
  console.log(`SyncPlus Enterprise Core running on port ${port}`);
});
