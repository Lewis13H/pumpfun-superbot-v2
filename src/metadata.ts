import { config } from './config';
import { db } from './database';

const SHYFT_API_URL = 'https://api.shyft.to/sol/v1';
const PUMP_FUN_API_URL = 'https://frontend-api.pump.fun';

export class MetadataFetcher {
  private queue: string[] = [];
  private processing = false;
  private retryQueue = new Map<string, number>(); // token -> retry count
  private fetchedTokens = new Set<string>(); // Track already fetched tokens

  async fetchTokenMetadata(mint: string) {
    // Skip if already fetched
    if (this.fetchedTokens.has(mint)) {
      console.log(`⏭️ Skipping already fetched token: ${mint}`);
      return null;
    }

    // Skip native SOL
    if (mint === 'So11111111111111111111111111111111111111112') {
      return null;
    }

    try {
      const response = await fetch(
        `${SHYFT_API_URL}/token/get_info?network=mainnet-beta&token_address=${mint}`,
        {
          headers: {
            'x-api-key': config.shyft.apiKey
          }
        }
      );

      if (response.status === 429) {
        throw new Error('Shyft API error: 429');
      }

      if (!response.ok) {
        throw new Error(`Shyft API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.result) {
        throw new Error('Invalid response from Shyft API');
      }

      const token = data.result;
      
      // Extract pump.fun vanity ID from metadata if available
      let vanityId = null;
      if (token.metadata?.uri) {
        try {
          const match = token.metadata.uri.match(/\/([^/]+)$/);
          if (match) vanityId = match[1];
        } catch (e) {
          // Ignore
        }
      }

      // Mark as fetched
      this.fetchedTokens.add(mint);

      return {
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        imageUri: token.image || null,
        vanityId
      };
    } catch (error) {
      throw error;
    }
  }

  enqueue(mint: string) {
    // Skip if already in queue or already fetched
    if (this.queue.includes(mint) || this.fetchedTokens.has(mint)) {
      return;
    }
    
    // Skip native SOL
    if (mint === 'So11111111111111111111111111111111111111112') {
      return;
    }

    this.queue.push(mint);
    this.processQueue();
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const mint = this.queue.shift()!;
      const retryCount = this.retryQueue.get(mint) || 0;
      
      try {
        const metadata = await this.fetchTokenMetadata(mint);
        if (metadata) {
          await db.upsertToken(
            {
              address: mint,
              bondingCurve: '', // Will be updated by main process
              ...metadata
            },
            new Date(),
            '',
            ''
          );
          console.log(`✅ Metadata fetched for ${metadata.symbol} (${mint})`);
        }
        
        // Remove from retry queue on success
        this.retryQueue.delete(mint);
        
        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`Error fetching metadata for ${mint}:`, error);
        
        // Handle rate limiting
        if (error.message.includes('429')) {
          // Exponential backoff
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 30000);
          console.log(`⏳ Rate limited. Retrying ${mint} in ${backoffTime}ms (attempt ${retryCount + 1})`);
          
          this.retryQueue.set(mint, retryCount + 1);
          
          // Re-add to queue after delay
          setTimeout(() => {
            if (retryCount < 3) { // Max 3 retries
              this.enqueue(mint);
            } else {
              console.error(`❌ Max retries reached for ${mint}`);
              this.retryQueue.delete(mint);
            }
          }, backoffTime);
          
          // Longer pause after rate limit
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.error(`Failed to process token ${mint}:`, error);
        }
      }
    }
    
    this.processing = false;
  }
}