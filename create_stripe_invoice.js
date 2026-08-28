require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  try {
    console.log('Creating Stripe price and payment link...');

    // 1. Create a Price for $2,500.00
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 250000, // $2,500.00
      product_data: {
        name: 'SyncPlus Enterprise - Initial Setup & Month 1 Retainer',
      },
    });

    // 2. Create a Payment Link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
    });

    console.log('\n========================================');
    console.log('[SUCCESS] $2,500.00 Payment Link Created!');
    console.log(`[URL]: ${paymentLink.url}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('[ERROR] Failed to generate Stripe payment link:', error.message);
  }
})();
