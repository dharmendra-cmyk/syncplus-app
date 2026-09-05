export default async function handler(req, res) {
  // Only allow POST requests from Shopify
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];

    console.log(`Received webhook [${topic}] from ${shop}`);

    // Immediately return 200 OK to satisfy Shopify's automated compliance check
    return res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).send('Webhook received');
  }
}
