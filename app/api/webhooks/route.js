import crypto from 'crypto';
import { NextResponse } from 'next/server';

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const digestBuf = Buffer.from(digest, 'utf8');
  const headerBuf = Buffer.from(hmacHeader, 'utf8');

  if (digestBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, headerBuf);
}

export async function POST(req) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
    const topic = req.headers.get('x-shopify-topic') || 'unknown';
    const shop = req.headers.get('x-shopify-shop-domain') || 'unknown';
    const secret = process.env.SHOPIFY_API_SECRET;

    if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    return NextResponse.json({ ok: true, topic, shop }, { status: 200 });
  } catch (err) {
    return new NextResponse('Bad Request', { status: 400 });
  }
}

export async function GET() {
  return new NextResponse('OK', { status: 200 });
}
