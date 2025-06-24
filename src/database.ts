import { Pool } from 'pg';
import { config } from './config';

// Create connection pool
export const pool = new Pool({
  connectionString: config.database.connectionString,
  max: config.database.poolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Type definitions
export interface Token {
  address: string;
  bondingCurve: string;
  symbol?: string;
  name?: string;
  imageUri?: string;
  vanityId?: string;
}

export interface PriceUpdate {
  token: string;
  price_sol: number;
  price_usd: number;
  liquidity_sol: number;
  liquidity_usd: number;
  market_cap_usd: number;
  bonding_complete: boolean;
  progress?: number;
}

// Database functions
async function upsertToken(
  token: Token,
  createdAt: Date,
  creator: string,
  _signature: string
): Promise<void> {
  const query = `
    INSERT INTO tokens (
      address, bonding_curve, vanity_id, symbol, name, 
      image_uri, created_at, creator
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (address) DO UPDATE SET
      bonding_curve = EXCLUDED.bonding_curve,
      vanity_id = COALESCE(tokens.vanity_id, EXCLUDED.vanity_id),
      symbol = COALESCE(tokens.symbol, EXCLUDED.symbol),
      name = COALESCE(tokens.name, EXCLUDED.name),
      image_uri = COALESCE(tokens.image_uri, EXCLUDED.image_uri)
  `;
  
  await pool.query(query, [
    token.address,
    token.bondingCurve,
    token.vanityId || null,
    token.symbol || null,
    token.name || null,
    token.imageUri || null,
    createdAt,
    creator
  ]);
}

async function insertPriceUpdate(update: PriceUpdate): Promise<void> {
  const query = `
    INSERT INTO price_updates (
      time, token, price_sol, price_usd, 
      liquidity_sol, liquidity_usd, market_cap_usd, bonding_complete
    ) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)
  `;
  
  await pool.query(query, [
    update.token,
    update.price_sol,
    update.price_usd,
    update.liquidity_sol,
    update.liquidity_usd,
    update.market_cap_usd,
    update.bonding_complete
  ]);
}

async function bulkInsertPriceUpdates(updates: PriceUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramCount = 1;
  
  updates.forEach(update => {
    placeholders.push(
      `(NOW(), $${paramCount++}, $${paramCount++}, $${paramCount++}, $${paramCount++}, $${paramCount++}, $${paramCount++}, $${paramCount++})`
    );
    values.push(
      update.token,
      update.price_sol,
      update.price_usd,
      update.liquidity_sol,
      update.liquidity_usd,
      update.market_cap_usd,
      update.bonding_complete
    );
  });
  
  const query = `
    INSERT INTO price_updates (
      time, token, price_sol, price_usd, 
      liquidity_sol, liquidity_usd, market_cap_usd, bonding_complete
    ) VALUES ${placeholders.join(', ')}
  `;
  
  await pool.query(query, values);
}

async function updateTokenMetadata(
  address: string,
  metadata: {
    symbol?: string;
    name?: string;
    imageUri?: string;
    vanityId?: string;
  }
): Promise<void> {
  const query = `
    UPDATE tokens 
    SET 
      symbol = COALESCE($2, symbol),
      name = COALESCE($3, name),
      image_uri = COALESCE($4, image_uri),
      vanity_id = COALESCE($5, vanity_id),
      last_updated = NOW()
    WHERE address = $1
  `;

  await pool.query(query, [
    address,
    metadata.symbol,
    metadata.name,
    metadata.imageUri,
    metadata.vanityId
  ]);
}

async function getActiveTokens(): Promise<any[]> {
  const query = `
    SELECT * FROM active_tokens 
    ORDER BY current_mcap DESC NULLS LAST
  `;
  
  const result = await pool.query(query);
  return result.rows;
}

async function checkTokenExists(address: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT 1 FROM tokens WHERE address = $1 LIMIT 1',
      [address]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking token existence:', error);
    return false;
  }
}

// Export database interface
export const db = {
  upsertToken,
  updateTokenMetadata,
  insertPriceUpdate,
  bulkInsertPriceUpdates,
  getActiveTokens,
  checkTokenExists,
  query: (text: string, params?: any[]) => pool.query(text, params)
};
