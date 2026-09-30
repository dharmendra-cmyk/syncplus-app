# SyncPlus - Project Memory & State Log

## 1. Project Overview
* **App Name:** SyncPlus
* **Functionality:** Multi-Location Inventory (MLI) Management & Automated Sync for Shopify.
* **Hosting / Deployment:** Railway (`syncplus-app-production.up.railway.app`) connected via GitHub main branch.
* **Database:** PostgreSQL on Railway (`sync_logs`, `shopify_settings`, `mli_rules`).

## 2. Recent Review Fixes & Milestones
* **Issue Addressed:** Shopify App Store review rejection under Section 2.1.3 ("Upon installation, the app redirects to a 'Cannot GET' error page").
* **Solution Implemented:**
  * Updated `index.js` root route (`/`) to gracefully serve `index.html` and handle shop parameter contexts.
  * Rebuilt `index.html` with Tailwind CSS and official Shopify App Bridge integration (`https://cdn.shopify.com/shopifycloud/app-bridge.js`) to ensure seamless rendering inside the Shopify Admin iframe without 404/routing errors.
* **Verification:** Successfully tested inside Shopify test store (`syncplus-test-store.myshopify.com`) showing fully operational metrics and live configuration tables.

## 3. Active Configuration & Credentials
* **Framework:** Node.js, Express, PostgreSQL, Tailwind CSS, Shopify App Bridge.
* **Key Routes:**
  * `GET /`: Serves the embedded Shopify UI dashboard (`index.html`).
  * `GET /auth`: Initiates Shopify OAuth flow.
  * `GET /auth/callback`: Handles token exchange and stores access tokens securely in `shopify_settings`.
  * `GET / POST /api/mli/rules`: Manages multi-location inventory mapping rules.
  * `POST /api/webhooks`: Validates HMAC and handles inventory propagation logs.

## 4. Pending Actions
* Awaiting review queue processing by Shopify App Review team for the latest deployment.
