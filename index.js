const express = require('express');
const { Pool } = require('pg');
const stripe = require('stripe')('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');

const app = express();
const port = process.env.PORT || 8080;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize Database Table
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        session_id TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Database table verified/created successfully.");
  } catch (err) {
    console.error("Error creating table:", err);
  }
}

initDb();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend UI homepage
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Managed Audit & Sync',
          },
          unit_amount: 9900, // $99.00
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success.html`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("STRIPE ERROR:", error.message);
    res.status(500).json({ error: "Error starting checkout session." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
