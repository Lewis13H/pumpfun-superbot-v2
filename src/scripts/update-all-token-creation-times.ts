/**
 * Update Creation Times for All Enriched Tokens
 * Enhanced version with better rate limiting and progress tracking
 */

import chalk from 'chalk';
import { db } from '../database';
import { TokenCreationTimeService } from '../services/token-management/token-creation-time-service';
import * as fs from 'fs';
import * as path from 'path';

const PROGRESS_FILE = path.join(__dirname, '.token-creation-progress.json');

interface Progress {
  processed: string[];
  failed: string[];
  lastProcessed: string | null;
  startedAt: string;
  updatedAt: string;
}

async function loadProgress(): Promise<Progress> {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow('No previous progress found, starting fresh'));
  }
  
  return {
    processed: [],
    failed: [],
    lastProcessed: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function saveProgress(progress: Progress) {
  progress.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function updateAllTokenCreationTimes() {
  console.log(chalk.blue('\n🚀 Updating Creation Times for All Enriched Tokens\n'));
  
  const progress = await loadProgress();
  
  try {
    // Get all enriched tokens without creation time
    const query = progress.lastProcessed 
      ? `SELECT mint_address, symbol, name 
         FROM tokens_unified 
         WHERE metadata_enriched = true 
           AND token_created_at IS NULL
           AND mint_address > $1
         ORDER BY mint_address
         LIMIT 1000`
      : `SELECT mint_address, symbol, name 
         FROM tokens_unified 
         WHERE metadata_enriched = true 
           AND token_created_at IS NULL
         ORDER BY mint_address
         LIMIT 1000`;
    
    const values = progress.lastProcessed ? [progress.lastProcessed] : [];
    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      console.log(chalk.green('✅ All enriched tokens have been processed!'));
      
      // Clean up progress file
      if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
      }
      
      return;
    }
    
    console.log(chalk.cyan(`📊 Found ${result.rows.length} tokens to process`));
    console.log(chalk.cyan(`📊 Previously processed: ${progress.processed.length}`));
    console.log(chalk.cyan(`📊 Previously failed: ${progress.failed.length}\n`));
    
    const creationTimeService = TokenCreationTimeService.getInstance();
    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;
    
    // Check for API keys
    const hasShyftKey = !!process.env.SHYFT_API_KEY;
    const hasHeliusKey = !!process.env.HELIUS_API_KEY;
    
    console.log(chalk.gray('API Configuration:'));
    console.log(chalk.gray(`  Shyft API: ${hasShyftKey ? '✅ Configured' : '❌ Not configured'}`));
    console.log(chalk.gray(`  Helius API: ${hasHeliusKey ? '✅ Configured' : '❌ Not configured'}`));
    console.log(chalk.gray(`  RPC: Using ${process.env.SOLANA_RPC_URL || 'default'}\n`));
    
    for (const token of result.rows) {
      // Skip if already processed
      if (progress.processed.includes(token.mint_address)) {
        skipCount++;
        continue;
      }
      
      // Skip if failed too many times
      const failCount = progress.failed.filter(m => m === token.mint_address).length;
      if (failCount >= 3) {
        console.log(chalk.gray(`⏭️  Skipping ${token.symbol} - failed ${failCount} times`));
        skipCount++;
        continue;
      }
      
      console.log(chalk.white(`\n📍 Processing ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`));
      
      try {
        const creationInfo = await creationTimeService.getTokenCreationTime(token.mint_address);
        
        if (creationInfo) {
          await creationTimeService.updateTokenCreationTime(token.mint_address, creationInfo);
          console.log(chalk.green(`   ✅ Success: ${creationInfo.creationTime.toLocaleString()} (${creationInfo.source})`));
          successCount++;
          progress.processed.push(token.mint_address);
        } else {
          console.log(chalk.red(`   ❌ Failed: Could not find creation time`));
          errorCount++;
          progress.failed.push(token.mint_address);
        }
      } catch (error) {
        console.log(chalk.red(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        errorCount++;
        progress.failed.push(token.mint_address);
        
        // If we hit rate limit, wait longer
        if (error instanceof Error && error.message.includes('429')) {
          console.log(chalk.yellow('   ⏸️  Rate limited, waiting 10 seconds...'));
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
      
      // Update progress
      progress.lastProcessed = token.mint_address;
      
      // Save progress every 10 tokens
      if ((successCount + errorCount) % 10 === 0) {
        await saveProgress(progress);
        console.log(chalk.gray(`\n📊 Progress: ${successCount} success, ${errorCount} errors, ${skipCount} skipped`));
      }
      
      // Rate limiting - use longer delay for RPC
      const delay = hasShyftKey || hasHeliusKey ? 500 : 1500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Final stats
    console.log(chalk.cyan('\n📊 Final Statistics:'));
    console.log(chalk.green(`   ✅ Successfully updated: ${successCount}`));
    console.log(chalk.red(`   ❌ Failed: ${errorCount}`));
    console.log(chalk.gray(`   ⏭️  Skipped: ${skipCount}`));
    console.log(chalk.blue(`   📁 Total processed overall: ${progress.processed.length}`));
    
    // Save final progress
    await saveProgress(progress);
    
    // Check if there are more to process
    const remaining = await db.query(
      `SELECT COUNT(*) as count 
       FROM tokens_unified 
       WHERE metadata_enriched = true 
         AND token_created_at IS NULL`
    );
    
    if (remaining.rows[0].count > 0) {
      console.log(chalk.yellow(`\n⚠️  ${remaining.rows[0].count} tokens still need creation times`));
      console.log(chalk.yellow('Run this script again to continue processing'));
    } else {
      console.log(chalk.green('\n✅ All enriched tokens now have creation times!'));
      
      // Clean up progress file
      if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    await saveProgress(progress);
    console.log(chalk.yellow('\nProgress saved. Run script again to resume.'));
  } finally {
    await db.end();
  }
}

// Run the update
updateAllTokenCreationTimes().catch(console.error);