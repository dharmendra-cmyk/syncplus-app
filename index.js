const express = require('express');
const path = require('path');
const Pool = require('pg').Pool;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

app.set('trust proxy', 1);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Automatically create subscriptions table on startup if it doesn't exist
pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        subscription_id VARCHAR(255) UNIQUE,
        customer_id VARCHAR(255),
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catchall = (err) => console.error('Table creation error:', err);

// Stripe Webhook Endpoint
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

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
