export default function HomePage({ searchParams }) {
  const shop = searchParams?.shop || 'Not specified';
  const host = searchParams?.host || '';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>SyncPlus</h1>
      <p>Multi-location inventory synchronization app for Shopify.</p>
      <p>
        <strong>Shop:</strong> {shop}
      </p>
      {host ? <p><strong>Host:</strong> Ready for Shopify Admin</p> : null}
    </main>
  );
}
