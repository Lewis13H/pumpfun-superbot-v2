#!/usr/bin/env node
import 'dotenv/config';
import { db } from '../database';
import { HeliusService } from '../services/helius';

interface EnrichmentStats {
  total: number;
  enriched: number;
  failed: number;
  skipped: number;
}

async function enrichTokensWithHelius() {
  console.log('🚀 Token Enrichment with Helius API\n');
  
  const helius = HeliusService.getInstance();
  const stats: EnrichmentStats = {
    total: 0,
    enriched: 0,
    failed: 0,
    skipped: 0
  };
  
  try {
    // First, let's add the new columns if they don't exist
    console.log('📋 Checking database schema...');
    await updateDatabaseSchema();
    
    // Get all tokens from database
    const tokensResult = await db.query(`
      SELECT address, name, symbol 
      FROM tokens 
      ORDER BY created_at DESC
    `);
    
    const tokens = tokensResult.rows;
    stats.total = tokens.length;
    
    console.log(`Found ${stats.total} tokens to enrich\n`);
    
    // Process each token
    for (const token of tokens) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`Processing: ${token.address}`);
      
      try {
        // Get comprehensive data from Helius
        const data = await helius.getComprehensiveTokenData(token.address);
        
        if (!data.metadata) {
          console.log('⚠️  No metadata found');
          stats.skipped++;
          continue;
        }
        
        // Update token metadata
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
          token.address
        ]);
        
        // Log enrichment details
        console.log(`✅ Enriched: ${data.metadata.symbol || token.symbol || 'Unknown'}`);
        console.log(`   Name: ${data.metadata.name || 'N/A'}`);
        console.log(`   Holders: ${data.holders?.total || 0}`);
        console.log(`   Top Holder: ${data.holders?.holders[0]?.percentage.toFixed(2) || 0}%`);
        console.log(`   Recent Txns: ${data.recentTransactions.length}`);
        
        stats.enriched++;
        
        // Save holder distribution if we have it
        if (data.holders && data.holders.holders.length > 0) {
          await saveHolderDistribution(token.address, data.holders);
        }
        
      } catch (error) {
        console.error(`❌ Failed to enrich token:`, error);
        stats.failed++;
      }
      
      // Show progress
      const processed = stats.enriched + stats.failed + stats.skipped;
      const percentage = ((processed / stats.total) * 100).toFixed(1);
      console.log(`\n📊 Progress: ${processed}/${stats.total} (${percentage}%)`);
    }
    
    // Final statistics
    console.log(`\n${'═'.repeat(60)}`);
    console.log('📈 Enrichment Complete!\n');
    console.log(`Total Tokens: ${stats.total}`);
    console.log(`✅ Enriched: ${stats.enriched}`);
    console.log(`⚠️  Skipped: ${stats.skipped}`);
    console.log(`❌ Failed: ${stats.failed}`);
    
    // Show cache statistics
    const cacheStats = helius.getCacheStats();
    console.log(`\n📦 Cache Statistics:`);
    console.log(`   Metadata: ${cacheStats.metadata} entries`);
    console.log(`   Holders: ${cacheStats.holders} entries`);
    console.log(`   Transactions: ${cacheStats.transactions} entries`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await db.close();
  }
}

async function updateDatabaseSchema() {
  try {
    // Add new columns if they don't exist
    await db.query(`
      ALTER TABLE tokens 
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS holder_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS top_holder_percentage NUMERIC(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS helius_metadata JSONB,
      ADD COLUMN IF NOT EXISTS helius_updated_at TIMESTAMP WITH TIME ZONE
    `);
    
    // Create holder distribution table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS token_holders (
        token TEXT NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
        wallet TEXT NOT NULL,
        balance NUMERIC(20,0) NOT NULL,
        percentage NUMERIC(5,2) NOT NULL,
        rank INTEGER NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (token, wallet)
      )
    `);
    
    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_token_holders_token ON token_holders(token);
      CREATE INDEX IF NOT EXISTS idx_token_holders_percentage ON token_holders(percentage DESC);
      CREATE INDEX IF NOT EXISTS idx_tokens_holder_count ON tokens(holder_count DESC);
      CREATE INDEX IF NOT EXISTS idx_tokens_helius_updated ON tokens(helius_updated_at);
    `);
    
    console.log('✅ Database schema updated\n');
  } catch (error) {
    console.error('Error updating schema:', error);
    throw error;
  }
}

async function saveHolderDistribution(tokenAddress: string, holders: any) {
  try {
    // Delete existing holder data
    await db.query('DELETE FROM token_holders WHERE token = $1', [tokenAddress]);
    
    // Insert top holders (limit to top 20)
    const topHolders = holders.holders.slice(0, 20);
    
    for (let i = 0; i < topHolders.length; i++) {
      const holder = topHolders[i];
      await db.query(`
        INSERT INTO token_holders (token, wallet, balance, percentage, rank)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        tokenAddress,
        holder.owner,
        holder.balance,
        holder.percentage,
        i + 1
      ]);
    }
    
    console.log(`   💎 Saved top ${topHolders.length} holders`);
  } catch (error) {
    console.error('Error saving holder distribution:', error);
  }
}

// Run the enrichment
enrichTokensWithHelius().catch(console.error);