const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    stock_quantity INTEGER NOT NULL
  )
`).catch(err => console.error("Error creating table:", err));

// NEW: Real-time webhook endpoint for Shopify & Stripe
app.post('/api/webhooks', (req, res) => {
  const event = req.body;
  console.log('Received incoming Webhook event:', JSON.stringify(event));

  // Respond back immediately with 200 OK so Shopify/Stripe know it was received
  res.status(200).json({ received: true });
});

app.post('/add', async (req, res) => {
  const { productName, stockQuantity } = req.body;
  try {
    await pool.query(
      'INSERT INTO inventory (product_name, stock_quantity) VALUES ($1, $2)',
      [productName, stockQuantity]
    );
    res.send(`Successfully added "${productName}" with ${stockQuantity} units to your PostgreSQL database! <a href="/">Go Back</a>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error: " + err.message);
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventory ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`SyncPlus app with PostgreSQL running on port ${PORT}`);
});
