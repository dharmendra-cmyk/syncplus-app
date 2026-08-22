const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Essential for handling incoming JSON webhooks from Shopify

// Initialize SQLite Database
const db = new sqlite3.Database('./syncplus.db', (err) => {
    if (err) console.error('Database opening error: ' + err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stock INTEGER NOT NULL,
    status TEXT DEFAULT 'Synced'
)`);

// Home Dashboard & Analytics Route
app.get('/', (req, res) => {
    const searchQuery = req.query.search || '';
    const query = searchQuery ? 
        `SELECT * FROM products WHERE name LIKE ?` : 
        `SELECT * FROM products`;
    const params = searchQuery ? [`%${searchQuery}%`] : [];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).send('Database error');
        
        db.get(`SELECT COUNT(*) as totalItems, SUM(stock) as totalStock FROM products`, (err, stats) => {
            if (err) return res.status(500).send('Stats error');

            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SyncPlus Enterprise Core</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; color: #333; margin: 0; padding: 40px; }
                        .container { max-width: 750px; margin: 0 auto; background: #fff; padding: 35px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
                        h1 { margin-top: 0; color: #111; font-size: 26px; }
                        .badge { background: #e6f4ea; color: #137333; padding: 4px 8px; font-size: 11px; font-weight: bold; border-radius: 4px; text-transform: uppercase; }
                        .stats-row { display: flex; gap: 15px; margin: 20px 0; }
                        .stat-card { flex: 1; background: #f8f9fa; border: 1px solid #eaeaea; padding: 15px; border-radius: 8px; text-align: center; }
                        .stat-card h4 { margin: 0 0 5px 0; font-size: 12px; color: #666; text-transform: uppercase; }
                        .stat-card p { margin: 0; font-size: 20px; font-weight: bold; color: #111; }
                        .item-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border: 1px solid #eaeaea; border-radius: 8px; margin-bottom: 12px; background: #fafafa; }
                        form { display: flex; flex-direction: column; gap: 14px; margin-top: 25px; }
                        input { padding: 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; }
                        button { padding: 14px; background: #000; color: #fff; border: none; font-size: 15px; font-weight: bold; cursor: pointer; border-radius: 6px; }
                        button:hover { background: #222; }
                        .delete-btn { background: #ff4d4f; padding: 6px 14px; font-size: 12px; border-radius: 6px; color: #fff; text-decoration: none; font-weight: bold; }
                        .search-container { display: flex; gap: 10px; margin: 20px 0; }
                        .search-container input { flex: 1; }
                        .search-container button { padding: 0 24px; background: #333; }
                        .reset-btn { padding: 0 20px; background: #e0e0e0; color: #333; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: flex; align-items: center; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h1>⚡ SyncPlus Enterprise Core</h1>
                            <span class="badge">Shopify Connected</span>
                        </div>
                        <p style="color: #666;">Autonomous Multi-Channel Inventory Engine</p>
                        
                        <div class="stats-row">
                            <div class="stat-card">
                                <h4>Total Catalog Items</h4>
                                <p>${stats.totalItems || 0}</p>
                            </div>
                            <div class="stat-card">
                                <h4>Total Stock Units</h4>
                                <p>${stats.totalStock || 0}</p>
                            </div>
                        </div>

                        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 25px 0;">
                        
                        <form action="/" method="GET" class="search-container" style="margin: 0 0 25px 0; flex-direction: row;">
                            <input type="text" name="search" placeholder="Search inventory by product name..." value="${searchQuery}">
                            <button type="submit">Search</button>
                            ${searchQuery ? `<a href="/" class="reset-btn">Reset</a>` : ''}
                        </form>

                        <h3>Live Inventory Catalog</h3>
            `;
            
            if (rows.length === 0) {
                html += `<p style="color: #888;">No matching items found in database.</p>`;
            } else {
                rows.forEach(p => {
                    html += `
                        <div class="item-card">
                            <div>
                                <strong style="font-size: 16px;">${p.name}</strong><br>
                                <span style="font-size: 13px; color: #666;">Stock Count: <b>${p.stock} units</b> | Status: <span style="color: #137333; font-weight: bold;">${p.status}</span></span>
                            </div>
                            <a href="/delete/${p.id}" class="delete-btn">Delete</a>
                        </div>
                    `;
                });
            }
            
            html += `
                        <h3 style="margin-top: 35px;">Add New Inventory Item</h3>
                        <form action="/add" method="POST">
                            <input type="text" name="name" placeholder="Product Name (e.g. Ergonomic Keyboard)" required>
                            <input type="number" name="stock" placeholder="Initial Stock Quantity (e.g. 250)" required>
                            <button type="submit">Commit Product to Database</button>
                        </form>
                    </div>
                </body>
                </html>
            `;
            res.send(html);
        });
    });
});

// Add Product Route
app.post('/add', (req, res) => {
    const { name, stock } = req.body;
    db.run(`INSERT INTO products (name, stock, status) VALUES (?, ?, ?)`, [name, parseInt(stock), 'Synced'], (err) => {
        if (err) return res.status(500).send('Error writing to database');
        res.redirect('/');
    });
});

// Delete Product Route
app.get('/delete/:id', (req, res) => {
    const productId = req.params.id;
    db.run(`DELETE FROM products WHERE id = ?`, [productId], (err) => {
        if (err) return res.status(500).send('Error deleting from database');
        res.redirect('/');
    });
});

// Shopify Webhook Listener Endpoint
app.post('/webhook/shopify/inventory', (req, res) => {
    const productData = req.body;
    const itemName = productData.title || 'Shopify Imported Item';
    const itemStock = productData.inventory_quantity || 100;

    db.run(`INSERT INTO products (name, stock, status) VALUES (?, ?, ?)`, [itemName, parseInt(itemStock), 'Webhook Synced'], (err) => {
        if (err) {
            console.error('Webhook database error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        console.log(`Successfully synced item from Shopify: ${itemName}`);
        res.status(200).json({ success: true, message: 'Inventory synchronized successfully' });
    });
});

app.listen(PORT, () => {
    console.log(`SyncPlus Enterprise core running at http://localhost:${PORT}`);
});
