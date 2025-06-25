import { Connection, PublicKey } from '@solana/web3.js';
import { HeliusService } from '../services/helius';

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT);

export async function getTokenCreationTime(mintAddress: string): Promise<Date | null> {
  try {
    // First, try to get from Helius enhanced transactions
    const helius = HeliusService.getInstance();
    const transactions = await helius.getEnhancedTransactions(mintAddress, 1000);
    
    if (transactions && transactions.length > 0) {
      // Find the earliest transaction (token creation)
      const earliestTx = transactions.reduce((earliest, tx) => {
        const txTime = tx.timestamp || tx.blockTime;
        const earliestTime = earliest.timestamp || earliest.blockTime;
        return txTime < earliestTime ? tx : earliest;
      });
      
      if (earliestTx.timestamp || earliestTx.blockTime) {
        return new Date((earliestTx.timestamp || earliestTx.blockTime) * 1000);
      }
    }
    
    // Fallback: Get token account info and estimate from first signature
    const mint = new PublicKey(mintAddress);
    const signatures = await connection.getSignaturesForAddress(mint, { limit: 1000 });
    
    if (signatures.length > 0) {
      // Get the oldest signature (last in array)
      const oldestSig = signatures[signatures.length - 1];
      
      if (oldestSig.blockTime) {
        return new Date(oldestSig.blockTime * 1000);
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching creation time for ${mintAddress}:`, error);
    return null;
  }
}

// Batch fetch creation times for multiple tokens
export async function batchGetTokenCreationTimes(
  mintAddresses: string[]
): Promise<Map<string, Date | null>> {
  const results = new Map<string, Date | null>();
  
  // Process in batches to avoid overwhelming the RPC
  const batchSize = 10;
  for (let i = 0; i < mintAddresses.length; i += batchSize) {
    const batch = mintAddresses.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const creationTime = await getTokenCreationTime(address);
        return { address, creationTime };
      })
    );
    
    batchResults.forEach(({ address, creationTime }) => {
      results.set(address, creationTime);
    });
    
    // Progress update
    console.log(`Fetched creation times: ${Math.min(i + batchSize, mintAddresses.length)}/${mintAddresses.length}`);
  }
  
  return results;
}