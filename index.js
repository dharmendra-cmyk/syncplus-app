await pool.query(`
  CREATE TABLE IF NOT EXISTS mli_rules (
    id SERIAL PRIMARY KEY,
    shop_domain VARCHAR(255),
    source_location_id BIGINT,
    target_location_id BIGINT,
    sync_ratio DECIMAL(5,2) DEFAULT 1.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
