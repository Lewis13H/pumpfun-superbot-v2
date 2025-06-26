import { db } from '../database';
import { HeliusService } from './helius';

const MARKET_CAP_THRESHOLD = 8888; // $8888 USD

interface TokenData {
  mint: string;
  priceInSol: number;
  priceInUsd: number;
  mcapSol: number;
  mcapUsd: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  progress?: number;
}

export class ThresholdTracker {
  private static instance: ThresholdTracker;
  private trackedTokens: Set<string> = new Set();
  private heliusService: HeliusService;
  private enrichmentEnabled: boolean = true;
  
  private constructor() {
    this.heliusService = HeliusService.getInstance();
  }
  
  static getInstance(): ThresholdTracker {
    if (!ThresholdTracker.instance) {
      ThresholdTracker.instance = new ThresholdTracker();
    }
    return ThresholdTracker.instance;
  }
  
  setEnrichmentEnabled(enabled: boolean): void {
    this.enrichmentEnabled = enabled;
  }
  
  async isTracked(mint: string): Promise<boolean> {
    return this.trackedTokens.has(mint);
  }
  
  async checkAndSaveToken(data: TokenData): Promise<boolean> {
    // Check if market cap meets or exceeds threshold
    if (data.mcapUsd < MARKET_CAP_THRESHOLD) {
      return false;
    }
    
    // Check if we've already tracked this token
    if (this.trackedTokens.has(data.mint)) {
      // Still save the price update
      await this.savePriceUpdate(data);
      return false;
    }
    
    console.log(`\n🎉 TOKEN REACHED $${MARKET_CAP_THRESHOLD} THRESHOLD!`);
    console.log(`   Address: ${data.mint}`);
    console.log(`   Market Cap: $${data.mcapUsd.toFixed(2)}`);
    console.log(`   Price: $${data.priceInUsd.toFixed(8)}`);
    
    try {
      // Save token to database
      await this.saveToken(data);
      
      // Save initial price update
      await this.savePriceUpdate(data);
      
      // Mark as tracked
      this.trackedTokens.add(data.mint);
      
      console.log(`✅ Token saved to database!`);
      
      // Enrich with Helius data if enabled
      if (this.enrichmentEnabled) {
        console.log(`🔄 Fetching additional data from Helius...`);
        await this.enrichTokenWithHelius(data.mint);
      }
      
      console.log('');
      return true;
    } catch (error) {
      console.error('Error saving token to database:', error);
      return false;
    }
  }
  
  private async saveToken(data: TokenData): Promise<void> {
    const query = `
      INSERT INTO tokens (
        address,
        bonding_curve,
        created_at,
        creator,
        graduated,
        volume_24h_usd,
        volume_24h_sol
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6)
      ON CONFLICT (address) DO UPDATE SET
        last_updated = NOW(),
        last_activity = NOW()
    `;
    
    // For now, we'll use placeholder values for some fields
    // In a real implementation, you'd extract these from the transaction
    const values = [
      data.mint,                    // address
      data.mint,                    // bonding_curve (same as address for now)
      'unknown',                    // creator (would need to extract from transaction)
      false,                        // graduated
      0,                           // volume_24h_usd
      0                            // volume_24h_sol
    ];
    
    await db.query(query, values);
  }
  
  private async savePriceUpdate(data: TokenData): Promise<void> {
    const query = `
      INSERT INTO price_updates (
        time,
        token,
        price_sol,
        price_usd,
        liquidity_sol,
        liquidity_usd,
        market_cap_usd,
        bonding_complete,
        progress
      ) VALUES (
        NOW(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
    `;
    
    // Calculate liquidity (virtual SOL reserves)
    const liquiditySol = Number(data.virtualSolReserves) / 1e9;
    const liquidityUsd = liquiditySol * (data.priceInUsd / data.priceInSol);
    
    // Determine if bonding is complete (progress >= 100)
    const bondingComplete = data.progress ? data.progress >= 100 : false;
    
    const values = [
      data.mint,                    // token
      data.priceInSol,             // price_sol
      data.priceInUsd,             // price_usd
      liquiditySol,                // liquidity_sol
      liquidityUsd,                // liquidity_usd
      data.mcapUsd,                // market_cap_usd
      bondingComplete,             // bonding_complete
      data.progress || 0           // progress
    ];
    
    await db.query(query, values);
  }
  
  async getTrackedTokensCount(): Promise<number> {
    return this.trackedTokens.size;
  }
  
  isTokenTracked(mint: string): boolean {
    return this.trackedTokens.has(mint);
  }
  
  private async enrichTokenWithHelius(mint: string): Promise<void> {
    try {
      // First check if schema is ready
      await this.ensureEnrichmentSchema();
      
      // Get comprehensive data
      const data = await this.heliusService.getComprehensiveTokenData(mint);
      
      if (!data.metadata) {
        console.log('⚠️  No Helius metadata available');
        return;
      }
      
      // Update token with enriched data
      await db.query(`
        UPDATE tokens 
        SET 
          name = COALESCE($1, name),
          symbol = COALESCE($2, symbol),
          image_uri = COALESCE($3, image_uri),
          description = $4,
          creator = COALESCE($5, creator),
          holder_count = $6,
          top_holder_percentage = $7,
          helius_metadata = $8,
          helius_updated_at = NOW()
        WHERE address = $9
      `, [
        data.metadata.name,
        data.metadata.symbol,
        data.metadata.image,
        data.metadata.description,
        data.metadata.creators?.[0]?.address || 'unknown',
        data.holders?.total || 0,
        data.holders?.holders[0]?.percentage || 0,
        JSON.stringify({
          metadata: data.metadata,
          holders: data.holders,
          lastTransactionCount: data.recentTransactions.length
        }),
        mint
      ]);
      
      console.log(`✨ Enriched with Helius data:`);
      console.log(`   Name: ${data.metadata.name || 'Unknown'}`);
      console.log(`   Symbol: ${data.metadata.symbol || 'Unknown'}`);
      console.log(`   Holders: ${data.holders?.total || 0}`);
      console.log(`   Top Holder: ${data.holders?.holders[0]?.percentage.toFixed(2) || 0}%`);
      
    } catch (error) {
      console.error('Error enriching token with Helius:', error);
    }
  }
  
  private async ensureEnrichmentSchema(): Promise<void> {
    try {
      await db.query(`
        ALTER TABLE tokens 
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS holder_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS top_holder_percentage NUMERIC(5,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS helius_metadata JSONB,
        ADD COLUMN IF NOT EXISTS helius_updated_at TIMESTAMP WITH TIME ZONE
      `);
    } catch (error) {
      // Schema might already exist, that's ok
    }
  }
}