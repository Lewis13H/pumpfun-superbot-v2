import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolSize
});

export interface Token {
  address: string;
  bondingCurve: string;
  vanityId?: string;
  symbol?: string;
  name?: string;
  imageUri?: string;
}

export interface PriceUpdate {
  token: string;
  priceSol: number;
  priceUsd: number;
  liquiditySol: number;
  liquidityUsd: number;
  marketCapUsd: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  bondingComplete: boolean;
  progress?: number;
}

export const db = {
  async upsertToken(token: Token, createdAt: Date, creator: string, signature: string) {
    await pool.query(`
      INSERT INTO tokens (
        address, bonding_curve, vanity_id, symbol, name, image_uri,
        created_at, creator, creation_signature
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (address) DO UPDATE SET
        vanity_id = COALESCE(tokens.vanity_id, $3),
        symbol = COALESCE(tokens.symbol, $4),
        name = COALESCE(tokens.name, $5),
        image_uri = COALESCE(tokens.image_uri, $6),
        metadata_fetched_at = CASE 
          WHEN $3 IS NOT NULL THEN NOW() 
          ELSE tokens.metadata_fetched_at 
        END
    `, [
      token.address, token.bondingCurve, token.vanityId,
      token.symbol, token.name, token.imageUri,
      createdAt, creator, signature
    ]);
  },

  async insertPriceUpdate(update: PriceUpdate): Promise<void> {
    const query = `
      INSERT INTO price_updates (
        time, token, price_sol, price_usd, 
        liquidity_sol, liquidity_usd, market_cap_usd,
        bonding_complete, progress
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7, $8
      )
    `;
    
    const values = [
      update.token,
      update.priceSol,
      update.priceUsd,
      update.liquiditySol,
      update.liquidityUsd,
      update.marketCapUsd,
      update.bondingComplete,
      update.progress ?? null // Use null if progress is undefined
    ];
    
    await pool.query(query, values);

    // Update last active timestamp
    await pool.query(
      'UPDATE tokens SET last_active_at = NOW() WHERE address = $1',
      [update.token]
    );

    // Mark as graduated if bonding complete
    if (update.bondingComplete) {
      await pool.query(`
        UPDATE tokens 
        SET graduated = true, graduated_at = NOW() 
        WHERE address = $1 AND NOT graduated
      `, [update.token]);
    }
  },

  async getActiveTokens(): Promise<any[]> {
    const result = await pool.query(
      'SELECT * FROM active_tokens ORDER BY current_mcap DESC NULLS LAST'
    );
    return result.rows;
  }
};