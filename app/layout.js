export const metadata = {
  title: 'SyncPlus',
  description: 'Multi-location inventory synchronization app for Shopify',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
