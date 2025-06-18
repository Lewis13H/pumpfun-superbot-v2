import { Pool, PoolClient } from 'pg';
import { config } from './config';

// Lazy initialization of pool to ensure config is loaded
let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: config.database.url,
      max: config.database.poolSize
    });
  }
  return poolInstance;
}

// Export pool getter for compatibility
export const pool = {
  query: (...args: any[]) => getPool().query(...args),
  end: () => getPool().end()
};

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
    // Validate bonding curve
    if (!token.bondingCurve || token.bondingCurve === 'unknown' || token.bondingCurve.length < 32) {
      console.error(`❌ Rejected token ${token.address} - invalid bonding curve: ${token.bondingCurve}`);
      console.error(`   Creator: ${creator}`);
      console.error(`   Signature: ${signature}`);
      
      // Don't throw error - just skip this token
      return;
    }

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
    // First check if token exists
    const tokenExists = await pool.query(
      'SELECT 1 FROM tokens WHERE address = $1',
      [update.token]
    );

    if (tokenExists.rows.length === 0) {
      console.warn(`⚠️ Skipping price update for unknown token: ${update.token}`);
      return;
    }

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
      update.progress ?? null
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
  },

  // ADD THIS FUNCTION
  async checkTokenExists(address: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM tokens WHERE address = $1 AND bonding_curve != $2',
      [address, 'unknown']
    );
    return result.rows.length > 0;
  },

  // ADD THIS FUNCTION FOR DIRECT QUERY ACCESS
  async query(text: string, params?: any[]): Promise<any> {
    return pool.query(text, params);
  }
};