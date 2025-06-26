#!/usr/bin/env node
import 'dotenv/config';
import { AutoEnricher } from '../services/auto-enricher';
import { db } from '../database';

async function main() {
  console.log('🤖 Auto Token Enricher');
  console.log('📊 Enriching tokens with missing metadata...\n');
  
  // Check if Helius API key is configured
  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY not found in environment variables');
    console.log('Please add HELIUS_API_KEY to your .env file');
    process.exit(1);
  }
  
  try {
    // Get initial stats
    const unknownResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tokens 
      WHERE (name IS NULL OR name = '') 
         OR (symbol IS NULL OR symbol = '')
         OR (image_uri IS NULL OR image_uri = '')
    `);
    
    const unknownCount = parseInt(unknownResult.rows[0].count);
    console.log(`📊 Found ${unknownCount} tokens needing enrichment\n`);
    
    if (unknownCount === 0) {
      console.log('✨ All tokens are already enriched!');
      process.exit(0);
    }
    
    // Start the auto-enricher
    const enricher = AutoEnricher.getInstance();
    await enricher.start();
    
    // Show progress every 5 seconds
    const progressInterval = setInterval(async () => {
      const stats = await enricher.getStats();
      console.log(`\n📊 Progress: ${stats.queueSize} in queue, ${stats.unknownTokens} remaining`);
    }, 5000);
    
    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n\n🛑 Shutting down...');
      clearInterval(progressInterval);
      enricher.stop();
      await db.close();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep running
    console.log('⌨️  Press Ctrl+C to stop\n');
    
  } catch (error) {
    console.error('Error:', error);
    await db.close();
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await db.close();
  process.exit(1);
});