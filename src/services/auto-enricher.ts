import { db } from '../database';
import { HeliusService } from './helius';


export class AutoEnricher {
  private static instance: AutoEnricher;
  private heliusService: HeliusService;
  private isRunning = false;
  private enrichmentQueue: Set<string> = new Set();
  private enrichmentInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 5; // Process 5 tokens at a time
  private readonly CHECK_INTERVAL = 30000; // Check every 30 seconds
  
  private constructor() {
    this.heliusService = HeliusService.getInstance();
  }
  
  static getInstance(): AutoEnricher {
    if (!AutoEnricher.instance) {
      AutoEnricher.instance = new AutoEnricher();
    }
    return AutoEnricher.instance;
  }
  
  async start() {
    if (this.isRunning) {
      console.log('Auto-enricher already running');
      return;
    }
    
    console.log('🤖 Starting auto-enrichment service...');
    this.isRunning = true;
    
    // Initial check for unknown tokens
    await this.checkForUnknownTokens();
    
    // Set up periodic checks
    this.enrichmentInterval = setInterval(async () => {
      await this.checkForUnknownTokens();
    }, this.CHECK_INTERVAL);
  }
  
  stop() {
    if (this.enrichmentInterval) {
      clearInterval(this.enrichmentInterval);
      this.enrichmentInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Auto-enricher stopped');
  }
  
  // Add token to enrichment queue
  async addToken(address: string) {
    if (!this.enrichmentQueue.has(address)) {
      this.enrichmentQueue.add(address);
      console.log(`📝 Added ${address} to enrichment queue`);
      
      // If not running periodic enrichment, process immediately
      if (!this.isRunning) {
        await this.processQueue();
      }
    }
  }
  
  // Check for tokens that need enrichment
  private async checkForUnknownTokens() {
    try {
      const result = await db.query(`
        SELECT address 
        FROM tokens 
        WHERE (name IS NULL OR name = '') 
           OR (symbol IS NULL OR symbol = '')
           OR (image_uri IS NULL OR image_uri = '')
        ORDER BY created_at DESC
        LIMIT 20
      `);
      
      if (result.rows.length > 0) {
        console.log(`\n🔍 Found ${result.rows.length} tokens needing enrichment`);
        
        for (const row of result.rows) {
          this.enrichmentQueue.add(row.address);
        }
        
        await this.processQueue();
      }
    } catch (error) {
      console.error('Error checking for unknown tokens:', error);
    }
  }
  
  // Process the enrichment queue
  private async processQueue() {
    if (this.enrichmentQueue.size === 0) return;
    
    const tokensToProcess = Array.from(this.enrichmentQueue).slice(0, this.BATCH_SIZE);
    console.log(`\n🔄 Processing ${tokensToProcess.length} tokens for enrichment...`);
    
    for (const address of tokensToProcess) {
      try {
        await this.enrichToken(address);
        this.enrichmentQueue.delete(address);
        
        // Small delay between API calls to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error enriching ${address}:`, error);
        // Keep in queue for retry
      }
    }
    
    if (this.enrichmentQueue.size > 0) {
      console.log(`📋 ${this.enrichmentQueue.size} tokens remaining in queue`);
    }
  }
  
  // Enrich a single token
  private async enrichToken(address: string) {
    console.log(`✨ Enriching token: ${address}`);
    
    try {
      // Ensure schema is ready
      await this.ensureEnrichmentSchema();
      
      // Get comprehensive data from Helius
      const data = await this.heliusService.getComprehensiveTokenData(address);
      
      if (!data.metadata) {
        console.log(`⚠️  No metadata available for ${address}`);
        return;
      }
      
      // Update token with enriched data
      await db.query(`
        UPDATE tokens 
        SET 
          name = COALESCE(NULLIF($1, ''), name),
          symbol = COALESCE(NULLIF($2, ''), symbol),
          image_uri = COALESCE(NULLIF($3, ''), image_uri),
          description = $4,
          creator = COALESCE(NULLIF($5, ''), creator),
          holder_count = COALESCE($6, holder_count),
          top_holder_percentage = COALESCE($7, top_holder_percentage),
          helius_metadata = $8,
          helius_updated_at = NOW()
        WHERE address = $9
      `, [
        data.metadata.name || '',
        data.metadata.symbol || '',
        data.metadata.image || '',
        data.metadata.description || '',
        data.metadata.creators?.[0]?.address || '',
        data.holders?.total || 0,
        data.holders?.holders[0]?.percentage || 0,
        JSON.stringify({
          metadata: data.metadata,
          holders: data.holders,
          lastTransactionCount: data.recentTransactions.length
        }),
        address
      ]);
      
      // Save holder distribution if available
      if (data.holders?.holders && data.holders.holders.length > 0) {
        await this.saveHolderDistribution(address, data.holders.holders);
      }
      
      console.log(`✅ Enriched: ${data.metadata.name || 'Unknown'} (${data.metadata.symbol || 'Unknown'})`);
      console.log(`   Holders: ${data.holders?.total || 0}, Top holder: ${data.holders?.holders[0]?.percentage.toFixed(2) || 0}%`);
      
    } catch (error) {
      console.error(`Failed to enrich ${address}:`, error);
      throw error;
    }
  }
  
  // Save holder distribution
  private async saveHolderDistribution(tokenAddress: string, holders: any[]) {
    try {
      // Clear existing holders
      await db.query('DELETE FROM token_holders WHERE token = $1', [tokenAddress]);
      
      // Filter out holders with null addresses and take top 20
      const validHolders = holders.filter(h => h.address && h.address !== null);
      const holdersToInsert = validHolders.slice(0, 20);
      if (holdersToInsert.length === 0) return;
      
      // Build VALUES clause with proper parameter placeholders
      const values = holdersToInsert.map((_, holderIndex) => {
        const baseIndex = holderIndex * 5;
        return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, NOW())`;
      });
      
      const query = `
        INSERT INTO token_holders (token, wallet, balance, percentage, rank, updated_at)
        VALUES ${values.join(', ')}
      `;
      
      const params = holdersToInsert.flatMap((holder, index) => [
        tokenAddress,
        holder.address,
        holder.balance,
        holder.percentage,
        index + 1
      ]);
      
      await db.query(query, params);
    } catch (error) {
      console.error('Error saving holder distribution:', error);
    }
  }
  
  // Ensure database schema for enrichment
  private async ensureEnrichmentSchema(): Promise<void> {
    try {
      // Add columns if they don't exist
      await db.query(`
        ALTER TABLE tokens 
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS holder_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS top_holder_percentage NUMERIC(5,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS helius_metadata JSONB,
        ADD COLUMN IF NOT EXISTS helius_updated_at TIMESTAMP WITH TIME ZONE
      `);
      
      // Ensure token_holders table exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS token_holders (
          token TEXT REFERENCES tokens(address),
          wallet TEXT NOT NULL,
          balance NUMERIC,
          percentage NUMERIC(5,2),
          rank INTEGER,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (token, wallet)
        )
      `);
      
      // Create index for performance
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_token_holders_token 
        ON token_holders(token)
      `);
    } catch (error) {
      // Schema might already exist, that's ok
    }
  }
  
  // Get enrichment stats
  async getStats(): Promise<{
    queueSize: number;
    isRunning: boolean;
    unknownTokens: number;
  }> {
    const unknownResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tokens 
      WHERE (name IS NULL OR name = '') 
         OR (symbol IS NULL OR symbol = '')
    `);
    
    return {
      queueSize: this.enrichmentQueue.size,
      isRunning: this.isRunning,
      unknownTokens: parseInt(unknownResult.rows[0].count)
    };
  }
}