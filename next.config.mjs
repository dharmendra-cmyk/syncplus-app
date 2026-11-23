/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              'frame-ancestors https://*.myshopify.com https://admin.shopify.com;',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
