const express = require('express');
const path = require('path');
const Pool = require('pg').Pool;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

app.set('trust proxy', 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
                unit_cost DECIMAL(10,2) DEFAULT 0.00,
                location VARCHAR(100) DEFAULT 'Main Warehouse',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Suppliers Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS suppliers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                contact_email VARCHAR(255),
                lead_time_days INT DEFAULT 7,
                min_order_qty INT DEFAULT 1
            )
        `);

        // Purchase Orders Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id SERIAL PRIMARY KEY,
                supplier_id INT REFERENCES suppliers(id),
                status VARCHAR(50) DEFAULT 'Pending',
                expected_delivery DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Database tables verified and initialized successfully.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initializeDatabase();

// Stripe Webhook Endpoint (Must be defined BEFORE express.json())
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'invoice.payment_succeeded') {
        const invoice = event.data.object;
        try {
            await pool.query(
                'INSERT INTO subscriptions (subscription_id, customer_id, status) VALUES ($1, $2, $3) ON CONFLICT (subscription_id) DO UPDATE SET status = $3',
                [invoice.subscription, invoice.customer, 'active']
            );
            console.log(`Successfully saved subscription: ${invoice.subscription}`);
        } catch (dbErr) {
            console.error('Database save error:', dbErr);
        }
    }

    res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Stripe Checkout Session Endpoint
app.post('/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: process.env.STRIPE_PRO_PRICE_ID,
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${req.protocol}://${req.get('host')}/?success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/?canceled=true`,
        });
        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- INVENTORY API ENDPOINTS ---

// Get all inventory items & low stock alerts
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory_items ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add or update an inventory item
app.post('/api/inventory', async (req, res) => {
    const { sku, name, quantity, safety_threshold, unit_cost, location } = req.body;
    try {
        const query = `
            INSERT INTO inventory_items (sku, name, quantity, safety_threshold, unit_cost, location, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (sku) 
            DO UPDATE SET name = $2, quantity = $3, safety_threshold = $4, unit_cost = $5, location = $6, updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const values = [sku, name, quantity || 0, safety_threshold || 10, unit_cost || 0.00, location || 'Main Warehouse'];
        const result = await pool.query(query, values);
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Suppliers Directory
app.get('/api/suppliers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
