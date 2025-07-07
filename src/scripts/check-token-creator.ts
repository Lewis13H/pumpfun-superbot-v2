import { db } from '../database';

async function checkTokenCreator() {
  const mintAddress = 'FBLygxP8nAefyskSBofoa8Luzw5tdTzp7a5PaTWCMTLk';
  
  const result = await db.query(
    'SELECT mint_address, creator, symbol, name FROM tokens_unified WHERE mint_address = $1',
    [mintAddress]
  );
  
  if (result.rows.length > 0) {
    const token = result.rows[0];
    console.log('Token data:');
    console.log('- Symbol:', token.symbol);
    console.log('- Name:', token.name);
    console.log('- Creator:', token.creator || '(empty)');
    console.log('- Creator length:', token.creator ? token.creator.length : 0);
  } else {
    console.log('Token not found');
  }
  
  await db.end();
}

checkTokenCreator().catch(console.error);