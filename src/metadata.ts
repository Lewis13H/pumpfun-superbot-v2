import { config } from './config';
import { db, Token } from './database';

export class MetadataFetcher {
  private queue: any[] = [];
  private processing = false;

  async fetchTokenMetadata(tokenAddress: string): Promise<Partial<Token>> {
    try {
      const response = await fetch(
        `${config.shyft.apiUrl}/token/get_info?network=mainnet-beta&token_address=${tokenAddress}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': config.shyft.apiKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        // If token is too new, it might not be indexed yet
        if (response.status === 404 || response.status === 417) {
          console.log(`Token ${tokenAddress} not found in Shyft API yet, will retry later`);
          return {
            address: tokenAddress,
            symbol: null,
            name: null,
            imageUri: null,
            vanityId: null
          };
        }
        throw new Error(`Shyft API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success || !data.result) {
        console.log(`No metadata found for ${tokenAddress}`);
        return {
          address: tokenAddress,
          symbol: null,
          name: null,
          imageUri: null,
          vanityId: null
        };
      }

      const result = data.result;

      // Extract pump.fun specific data if available
      let vanityId = null;
      if (result.creators && result.creators.length > 0) {
        // Sometimes pump.fun vanity ID is stored in different places
        vanityId = result.pump_fun_data?.vanity_id || 
                   result.pumpfun_data?.vanity_id ||
                   result.vanity_id;
      }

      return {
        address: tokenAddress,
        symbol: result.symbol || null,
        name: result.name || null,
        imageUri: result.image || result.image_uri || null,
        vanityId: vanityId
      };
    } catch (error) {
      console.error(`Error fetching metadata for ${tokenAddress}:`, error);
      throw error;
    }
  }

  queueToken(tokenData: any) {
    this.queue.push(tokenData);
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    this.processing = true;

    while (this.queue.length > 0) {
      const token = this.queue.shift();
      
      try {
        const metadata = await this.fetchTokenMetadata(token.address);
        
        await db.upsertToken(
          {
            address: token.address,
            bondingCurve: token.bondingCurve,
            ...metadata
          },
          token.timestamp,
          token.creator,
          token.signature
        );

        if (metadata.symbol) {
          console.log(`✅ Metadata fetched for ${metadata.symbol} (${token.address})`);
        } else {
          console.log(`⏳ Token ${token.address} saved, metadata pending`);
          // Re-queue for later retry
          setTimeout(() => this.queue.push(token), 60000); // Retry after 1 minute
        }
      } catch (error) {
        console.error(`Failed to process token ${token.address}:`, error);
        // Re-queue with exponential backoff
        const retryDelay = token.retryCount ? Math.min(token.retryCount * 30000, 300000) : 30000;
        setTimeout(() => {
          token.retryCount = (token.retryCount || 0) + 1;
          if (token.retryCount < 10) { // Max 10 retries
            this.queue.push(token);
          }
        }, retryDelay);
      }

      // Rate limit: 10 requests per second
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
  }
}