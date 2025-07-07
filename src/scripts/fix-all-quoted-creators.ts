import { db } from '../database';
import chalk from 'chalk';

async function fixAllQuotedCreators() {
  console.log(chalk.blue('🔍 Finding tokens with quoted creators...\n'));
  
  // Find all tokens where creator starts and ends with quotes
  const result = await db.query(`
    SELECT mint_address, symbol, creator
    FROM tokens_unified
    WHERE creator LIKE '"%"'
    AND LENGTH(creator) > 2
    ORDER BY latest_market_cap_usd DESC NULLS LAST
  `);
  
  if (result.rows.length === 0) {
    console.log(chalk.green('✅ No tokens with quoted creators found!'));
    return;
  }
  
  console.log(chalk.yellow(`Found ${result.rows.length} tokens with quoted creators\n`));
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const token of result.rows) {
    try {
      // Remove surrounding quotes
      const cleanCreator = token.creator.slice(1, -1);
      
      console.log(chalk.white(`Fixing ${token.symbol}:`));
      console.log(chalk.gray(`  Old: ${token.creator}`));
      console.log(chalk.green(`  New: ${cleanCreator}`));
      
      await db.query(
        `UPDATE tokens_unified 
         SET creator = $2,
             updated_at = NOW()
         WHERE mint_address = $1`,
        [token.mint_address, cleanCreator]
      );
      
      successCount++;
    } catch (error) {
      console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      errorCount++;
    }
  }
  
  console.log(chalk.cyan('\n📊 Summary:'));
  console.log(chalk.green(`   ✅ Fixed: ${successCount}`));
  console.log(chalk.red(`   ❌ Failed: ${errorCount}`));
  
  // Check if any quoted creators remain
  const remaining = await db.query(
    `SELECT COUNT(*) as count FROM tokens_unified WHERE creator LIKE '"%"'`
  );
  
  if (remaining.rows[0].count > 0) {
    console.log(chalk.yellow(`\n⚠️  ${remaining.rows[0].count} tokens still have quoted creators`));
  } else {
    console.log(chalk.green('\n✅ All quoted creators have been fixed!'));
  }
}

fixAllQuotedCreators().catch(console.error);