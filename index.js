const express = require('express');
const { Pool } = require('pg');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static(__dirname + '/HTML'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Managed Audit & Sync Resolution',
                    },
                    unit_amount: 9900,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}?success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}?canceled=true`,
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log(`Payment successful for session ID: ${session.id}`);
        
        try {
            await pool.query(
                'INSERT INTO resolved_audits (session_id, customer_email, status, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
                [session.id, session.customer_details?.email || 'unknown', 'paid']
            );
        } catch (dbError) {
            console.error('Database insertion error on webhook:', dbError);
        }
    }

    res.json({ received: true });
});

app.listen(port, () => {
    console.log(`SyncPlus app listening on port ${port}`);
});
