import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(Buffer.from(data));
    });
    req.on('error', err => {
      reject(err);
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const rawBody = await getRawBody(req);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    if (!hmacHeader) {
      return res.status(401).send('Missing HMAC header');
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      console.error('Missing SHOPIFY_API_SECRET environment variable');
      return res.status(500).send('Server configuration error');
    }

    const calculatedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const verified = crypto.timingSafeEqual(
      Buffer.from(calculatedHmac),
      Buffer.from(hmacHeader)
    );

    if (!verified) {
      return res.status(401).send('Invalid HMAC signature');
    }

    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];
    console.log(`Verified webhook [${topic}] from ${shop}`);

    return res.status(200).send('Webhook verified successfully');
  } catch (error) {
    console.error('Webhook verification error:', error);
    return res.status(500).send('Internal Server Error');
  }
}
