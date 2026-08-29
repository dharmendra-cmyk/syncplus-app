const express = require('express');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// Handle Form Submission to Database
app.post('/commit', async (req, res) => {
    const { productName, stockQuantity } = req.body;
    try {
        await pool.query(
            'INSERT INTO inventory (product_name, stock_quantity) VALUES ($1, $2)',
            [productName, stockQuantity]
        );
        res.redirect('/?success=db');
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Error saving to database');
    }
});

// Dynamic Stripe Checkout Session Endpoint with Detailed Logging
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'SyncPlus Managed Audit & Sync',
              description: 'Full automated inventory setup & 30-day post-stocky audit',
            },
            unit_amount: 9900, // $99.00 USD
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://syncplus-app-production.up.railway.app/?success=true',
      cancel_url: 'https://syncplus-app-production.up.railway.app/?canceled=true',
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('STRIPE ERROR:', e.message); // This will print the exact reason in your Railway logs!
    res.status(500).json({ error: e.message });
  }
});

// Start Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
