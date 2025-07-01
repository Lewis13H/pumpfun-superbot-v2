/**
 * Token Repository
 * Handles token data persistence
 */

import { Pool } from 'pg';
import { BaseRepository } from './base-repository';
import { EventBus, EVENTS } from '../core/event-bus';

export interface Token {
  mintAddress: string;
  symbol?: string;
  name?: string;
  description?: string;
  image?: string;
  uri?: string;
  decimals?: number;
  supply?: string;
  creator?: string; // Pump.fun creator address
  totalSupply?: string; // Token total supply
  bondingCurveKey?: string; // Bonding curve address
  firstPriceSol?: number;
  firstPriceUsd?: number;
  firstMarketCapUsd?: number;
  currentPriceSol?: number;
  currentPriceUsd?: number;
  currentMarketCapUsd?: number;
  thresholdCrossedAt?: Date;
  graduatedToAmm: boolean;
  graduationAt?: Date;
  graduationSlot?: bigint;
  priceSource?: string;
  metadataSource?: string;
  firstProgram?: 'bonding_curve' | 'amm_pool';
  firstSeenSlot?: number;
  lastPriceUpdate?: Date;
  lastMetadataUpdate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TokenFilter {
  graduatedToAmm?: boolean;
  marketCapUsdGte?: number;
  priceSource?: string;
  needsMetadata?: boolean;
  needsPriceUpdate?: boolean;
  limit?: number;
  offset?: number;
}

export class TokenRepository extends BaseRepository<Token> {
  private eventBus?: EventBus;

  constructor(pool: Pool, eventBus?: EventBus) {
    super(pool, 'tokens_unified', 'TokenRepository');
    this.eventBus = eventBus;
  }

  /**
   * Find token by mint address
   */
  async findByMintAddress(mintAddress: string): Promise<Token | null> {
    return this.queryOne<Token>(
      'SELECT * FROM tokens_unified WHERE mint_address = $1',
      [mintAddress]
    );
  }

  /**
   * Find multiple tokens by mint addresses
   */
  async findByMintAddresses(mintAddresses: string[]): Promise<Token[]> {
    if (mintAddresses.length === 0) return [];
    
    const placeholders = mintAddresses.map((_, i) => `$${i + 1}`).join(', ');
    return this.query<Token>(
      `SELECT * FROM tokens_unified WHERE mint_address IN (${placeholders})`,
      mintAddresses
    );
  }

  /**
   * Save or update token
   */
  async save(token: Token): Promise<Token> {
    // Map currentPrice* fields to latest_price* in database
    const fieldMapping: { [key: string]: string } = {
      currentPriceSol: 'latest_price_sol',
      currentPriceUsd: 'latest_price_usd',
      currentMarketCapUsd: 'latest_market_cap_usd'
    };
    
    const columns = Object.keys(token).map(key => {
      // Use mapping if exists, otherwise convert camelCase to snake_case
      if (fieldMapping[key]) {
        return fieldMapping[key];
      }
      return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    });
    
    const values = Object.values(token);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const updateSet = columns
      .filter(col => col !== 'mint_address' && col !== 'created_at')
      .map(col => `${col} = EXCLUDED.${col}`)
      .join(', ');

    const query = `
      INSERT INTO tokens_unified (${columns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (mint_address) DO UPDATE SET
        ${updateSet},
        updated_at = NOW()
      RETURNING *
    `;

    const result = await this.queryOne<Token>(query, values);
    
    if (result && this.eventBus) {
      this.eventBus.emit(EVENTS.TOKEN_DISCOVERED, result);
    }
    
    return result!;
  }

  /**
   * Batch save tokens
   */
  async batchSave(tokens: Token[]): Promise<Token[]> {
    if (tokens.length === 0) return [];

    return this.transaction(async (_client) => {
      const saved: Token[] = [];
      
      for (const token of tokens) {
        const result = await this.save(token);
        saved.push(result);
      }
      
      return saved;
    });
  }

  /**
   * Update token price
   */
  async updatePrice(
    mintAddress: string,
    priceData: {
      priceSol: number;
      priceUsd: number;
      marketCapUsd: number;
      priceSource: string;
    }
  ): Promise<boolean> {
    const query = `
      UPDATE tokens_unified SET
        current_price_sol = $2,
        current_price_usd = $3,
        first_market_cap_usd = $4,
        price_source = $5,
        last_price_update = NOW(),
        updated_at = NOW()
      WHERE mint_address = $1
    `;

    const result = await this.pool.query(query, [
      mintAddress,
      priceData.priceSol,
      priceData.priceUsd,
      priceData.marketCapUsd,
      priceData.priceSource
    ]);

    if (result.rowCount && result.rowCount > 0 && this.eventBus) {
      this.eventBus.emit(EVENTS.PRICE_UPDATED, {
        mintAddress,
        ...priceData
      });
    }

    return (result.rowCount || 0) > 0;
  }

  /**
   * Mark token as graduated
   */
  async markGraduated(
    mintAddress: string,
    graduationData: {
      graduationAt: Date;
      graduationSlot: bigint;
    }
  ): Promise<boolean> {
    const query = `
      UPDATE tokens_unified SET
        graduated_to_amm = true,
        graduation_at = $2,
        graduation_slot = $3,
        updated_at = NOW()
      WHERE mint_address = $1 AND graduated_to_amm = false
    `;

    const result = await this.pool.query(query, [
      mintAddress,
      graduationData.graduationAt,
      graduationData.graduationSlot.toString()
    ]);

    if (result.rowCount && result.rowCount > 0 && this.eventBus) {
      this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        mintAddress,
        ...graduationData
      });
    }

    return (result.rowCount || 0) > 0;
  }

  /**
   * Update token with arbitrary fields
   */
  async update(mintAddress: string, updates: Partial<Token>): Promise<boolean> {
    if (Object.keys(updates).length === 0) return false;
    
    // Map currentPrice* fields to latest_price* in database
    const fieldMapping: { [key: string]: string } = {
      currentPriceSol: 'latest_price_sol',
      currentPriceUsd: 'latest_price_usd',
      currentMarketCapUsd: 'latest_market_cap_usd',
      graduatedToAmm: 'graduated_to_amm',
      graduationAt: 'graduation_at',
      graduationSlot: 'graduation_slot',
      priceSource: 'price_source'
    };
    
    const updateFields: string[] = [];
    const values: any[] = [mintAddress];
    let paramIndex = 2;
    
    for (const [key, value] of Object.entries(updates)) {
      const dbField = fieldMapping[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      updateFields.push(`${dbField} = $${paramIndex++}`);
      values.push(value);
    }
    
    const query = `
      UPDATE tokens_unified SET
        ${updateFields.join(', ')},
        updated_at = NOW()
      WHERE mint_address = $1
    `;
    
    const result = await this.pool.query(query, values);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Find tokens by filter
   */
  async findByFilter(filter: TokenFilter): Promise<Token[]> {
    let query = 'SELECT * FROM tokens_unified WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.graduatedToAmm !== undefined) {
      query += ` AND graduated_to_amm = $${paramIndex++}`;
      params.push(filter.graduatedToAmm);
    }

    if (filter.marketCapUsdGte !== undefined) {
      query += ` AND first_market_cap_usd >= $${paramIndex++}`;
      params.push(filter.marketCapUsdGte);
    }

    if (filter.priceSource) {
      query += ` AND price_source = $${paramIndex++}`;
      params.push(filter.priceSource);
    }

    if (filter.needsMetadata) {
      query += ' AND (name IS NULL OR symbol IS NULL)';
    }

    if (filter.needsPriceUpdate) {
      query += ` AND (
        last_price_update IS NULL OR 
        last_price_update < NOW() - INTERVAL '30 minutes'
      )`;
    }

    query += ' ORDER BY first_market_cap_usd DESC NULLS LAST';

    if (filter.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filter.limit);
    }

    if (filter.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filter.offset);
    }

    return this.query<Token>(query, params);
  }

  /**
   * Get tokens above threshold
   */
  async getTokensAboveThreshold(thresholdUsd: number): Promise<Token[]> {
    return this.findByFilter({
      marketCapUsdGte: thresholdUsd,
      limit: 1000
    });
  }

  /**
   * Get tokens needing metadata
   */
  async getTokensNeedingMetadata(limit: number = 50): Promise<Token[]> {
    return this.findByFilter({
      needsMetadata: true,
      marketCapUsdGte: 1000, // Only enrich valuable tokens
      limit
    });
  }

  /**
   * Get stale tokens for price recovery
   */
  async getStaleTokens(limit: number = 10): Promise<Token[]> {
    return this.findByFilter({
      needsPriceUpdate: true,
      limit
    });
  }

  /**
   * Update metadata
   */
  async updateMetadata(
    mintAddress: string,
    metadata: Partial<Token>
  ): Promise<boolean> {
    const columns = Object.keys(metadata)
      .filter(key => key !== 'mintAddress')
      .map(key => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`));
    
    if (columns.length === 0) return false;

    const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
    const values = [mintAddress, ...Object.values(metadata)];

    const query = `
      UPDATE tokens_unified SET
        ${setClause},
        last_metadata_update = NOW(),
        updated_at = NOW()
      WHERE mint_address = $1
    `;

    const result = await this.pool.query(query, values);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    total: number;
    graduated: number;
    withMetadata: number;
    aboveThreshold: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE name IS NOT NULL AND symbol IS NOT NULL) as with_metadata,
        COUNT(*) FILTER (WHERE first_market_cap_usd >= 8888) as above_threshold
      FROM tokens_unified
    `;

    const result = await this.queryOne<any>(query);
    return {
      total: parseInt(result.total, 10),
      graduated: parseInt(result.graduated, 10),
      withMetadata: parseInt(result.with_metadata, 10),
      aboveThreshold: parseInt(result.above_threshold, 10)
    };
  }

  /**
   * Execute a raw query (for graduation handler use)
   */
  async executeQuery<R = any>(text: string, params?: any[]): Promise<{ rows: R[] }> {
    const result = await this.pool.query(text, params);
    return result;
  }
}