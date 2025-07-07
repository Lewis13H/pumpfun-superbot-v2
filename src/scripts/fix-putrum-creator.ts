import { db } from '../database';
import chalk from 'chalk';

async function fixPutrumCreator() {
  const mintAddress = 'FBLygxP8nAefyskSBofoa8Luzw5tdTzp7a5PaTWCMTLk';
  
  console.log(chalk.blue('Checking PUTRUM token creator...'));
  
  // First check current status
  const checkResult = await db.query(
    `SELECT mint_address, symbol, creator, 
     LENGTH(creator) as creator_len,
     creator LIKE '%"%' as has_quotes
     FROM tokens_unified 
     WHERE mint_address = $1`,
    [mintAddress]
  );
  
  if (checkResult.rows.length === 0) {
    console.log(chalk.red('Token not found!'));
    return;
  }
  
  const token = checkResult.rows[0];
  console.log('\nCurrent status:');
  console.log('- Symbol:', token.symbol);
  console.log('- Creator:', token.creator);
  console.log('- Creator length:', token.creator_len);
  console.log('- Has quotes:', token.has_quotes);
  
  // Check if creator has quotes
  if (token.creator === '""' || token.creator === '') {
    console.log(chalk.yellow('\nCreator is empty or has empty quotes. Running update...'));
    
    // Run the update script
    const { execSync } = require('child_process');
    execSync('npx tsx src/scripts/update-token-creators.ts', { stdio: 'inherit' });
    
  } else if (token.has_quotes) {
    console.log(chalk.yellow('\nCreator has quotes. Cleaning...'));
    
    // Remove quotes from creator
    const cleanCreator = token.creator.replace(/^"|"$/g, '');
    
    await db.query(
      `UPDATE tokens_unified 
       SET creator = $2,
           updated_at = NOW()
       WHERE mint_address = $1`,
      [mintAddress, cleanCreator]
    );
    
    console.log(chalk.green(`✅ Cleaned creator: ${cleanCreator}`));
  } else {
    console.log(chalk.green('\n✅ Creator looks good!'));
  }
  
  // Check final result
  const finalResult = await db.query(
    'SELECT creator FROM tokens_unified WHERE mint_address = $1',
    [mintAddress]
  );
  
  console.log(chalk.cyan('\nFinal creator:'), finalResult.rows[0].creator);
}

fixPutrumCreator().catch(console.error);