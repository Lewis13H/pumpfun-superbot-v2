#!/usr/bin/env ts-node

/**
 * Test script for pump.fun data enrichment
 * Verifies that creator, supply, and bonding curve data is being captured
 */

import { db } from '../src/database';
import { GraphQLMetadataEnricher } from '../src/services/graphql-metadata-enricher';
import chalk from 'chalk';

async function testPumpFunEnrichment() {
  console.log(chalk.blue('🧪 Testing pump.fun data enrichment...\n'));
  
  try {
    // First, check if we have the new columns
    console.log(chalk.yellow('📊 Checking database schema...'));
    const schemaCheck = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified' 
      AND column_name IN ('creator', 'total_supply', 'bonding_curve_key')
    `);
    
    if (schemaCheck.rows.length === 0) {
      console.log(chalk.red('❌ Missing pump.fun columns! Run migration first:'));
      console.log(chalk.gray('psql $DATABASE_URL -f migrations/add-pump-fun-columns.sql'));
      process.exit(1);
    }
    
    console.log(chalk.green('✅ Schema check passed'));
    schemaCheck.rows.forEach((row: any) => {
      console.log(chalk.gray(`  - ${row.column_name}: ${row.data_type}`));
    });
    
    // Get some tokens to test enrichment
    console.log(chalk.yellow('\n📋 Finding tokens to enrich...'));
    const tokensResult = await db.query(`
      SELECT mint_address, symbol, name, creator, total_supply, bonding_curve_key
      FROM tokens_unified 
      WHERE latest_market_cap_usd > 10000
      AND (creator IS NULL OR total_supply IS NULL)
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `);
    
    if (tokensResult.rows.length === 0) {
      console.log(chalk.yellow('⚠️  No tokens need enrichment'));
      
      // Show some tokens that already have data
      const enrichedResult = await db.query(`
        SELECT mint_address, symbol, creator, total_supply
        FROM tokens_unified 
        WHERE creator IS NOT NULL
        LIMIT 5
      `);
      
      if (enrichedResult.rows.length > 0) {
        console.log(chalk.green('\n✅ Some tokens already have pump.fun data:'));
        enrichedResult.rows.forEach((token: any) => {
          console.log(chalk.gray(`  ${token.symbol || 'Unknown'}: creator=${token.creator?.slice(0,8)}... supply=${token.total_supply}`));
        });
      }
      return;
    }
    
    console.log(chalk.cyan(`\n🔍 Enriching ${tokensResult.rows.length} tokens with pump.fun data...`));
    
    // Test enrichment
    const enricher = GraphQLMetadataEnricher.getInstance();
    const mintAddresses = tokensResult.rows.map((t: any) => t.mint_address);
    
    const enrichmentResult = await enricher.enrichTokensInDatabase(mintAddresses);
    
    console.log(chalk.green(`\n✅ Enrichment results:`));
    console.log(chalk.gray(`  - Success: ${enrichmentResult.success}`));
    console.log(chalk.gray(`  - Failed: ${enrichmentResult.failed}`));
    console.log(chalk.gray(`  - Source: ${enrichmentResult.source}`));
    
    // Verify enrichment
    console.log(chalk.yellow('\n🔍 Verifying enrichment...'));
    const verifyResult = await db.query(`
      SELECT mint_address, symbol, name, creator, total_supply, bonding_curve_key
      FROM tokens_unified 
      WHERE mint_address = ANY($1)
      AND creator IS NOT NULL
    `, [mintAddresses]);
    
    if (verifyResult.rows.length > 0) {
      console.log(chalk.green(`\n✅ Successfully enriched ${verifyResult.rows.length} tokens:`));
      verifyResult.rows.forEach((token: any) => {
        console.log(chalk.cyan(`\n  ${token.symbol || 'Unknown'} (${token.mint_address.slice(0,8)}...)`));
        console.log(chalk.gray(`    - Creator: ${token.creator}`));
        console.log(chalk.gray(`    - Supply: ${token.total_supply}`));
        console.log(chalk.gray(`    - BC Key: ${token.bonding_curve_key || 'N/A'}`));
      });
    } else {
      console.log(chalk.yellow('\n⚠️  No tokens were enriched with creator data'));
      console.log(chalk.gray('This might mean the GraphQL queries need debugging'));
    }
    
    // Check recent trades for creator extraction
    console.log(chalk.yellow('\n📈 Checking recent BC trades for creator data...'));
    const tradesResult = await db.query(`
      SELECT t.signature, t.mint_address, t.bonding_curve_key, tk.creator
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'bonding_curve'
      AND t.bonding_curve_key IS NOT NULL
      ORDER BY t.block_time DESC
      LIMIT 5
    `);
    
    if (tradesResult.rows.length > 0) {
      console.log(chalk.green(`\n✅ Recent trades with BC data:`));
      tradesResult.rows.forEach((trade: any) => {
        console.log(chalk.gray(`  - ${trade.mint_address.slice(0,8)}... BC: ${trade.bonding_curve_key?.slice(0,8)}... Creator: ${trade.creator || 'Not captured'}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error);
    process.exit(1);
  } finally {
    // Close database connection
    process.exit(0);
  }
}

// Run the test
testPumpFunEnrichment().catch(console.error);