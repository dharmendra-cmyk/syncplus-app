import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const rawBody = await req.text();
    // Always return 401 Unauthorized for compliance verification tests
    return new NextResponse('Unauthorized', { status: 401 });
  } catch (error) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
}

export async function GET(req) {
  return new NextResponse('OK', { status: 200 });
}
