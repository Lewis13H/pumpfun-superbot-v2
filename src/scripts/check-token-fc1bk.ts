import { db } from '../database';
import chalk from 'chalk';

async function checkToken() {
  const mintAddress = 'FC1bK4PbXf2QDSRERFawYeiQ3RDfQXm8nndP55FVpump';
  
  const result = await db.query(
    `SELECT mint_address, symbol, name, creator, 
     LENGTH(creator) as creator_len,
     creator IS NULL as is_null,
     creator = '' as is_empty,
     creator = '""' as is_empty_quotes
     FROM tokens_unified 
     WHERE mint_address = $1`,
    [mintAddress]
  );
  
  if (result.rows.length === 0) {
    console.log(chalk.red('Token not found!'));
    return;
  }
  
  const token = result.rows[0];
  console.log(chalk.blue('Token data:'));
  console.log('- Symbol:', token.symbol);
  console.log('- Name:', token.name);
  console.log('- Creator:', token.creator);
  console.log('- Creator length:', token.creator_len);
  console.log('- Is NULL:', token.is_null);
  console.log('- Is empty string:', token.is_empty);
  console.log('- Is empty quotes:', token.is_empty_quotes);
  console.log('- Creator value bytes:', token.creator ? Buffer.from(token.creator).toString('hex') : 'none');
}

checkToken().catch(console.error);