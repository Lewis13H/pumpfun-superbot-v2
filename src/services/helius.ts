import 'dotenv/config';

interface TokenMetadata {
  address: string;
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  supply?: number;
  decimals?: number;
  tokenStandard?: string;
  compressed?: boolean;
}

interface TokenHolders {
  total: number;
  holders: Array<{
    owner: string;
    balance: number;
    percentage: number;
  }>;
}

interface HeliusCache {
  metadata: Map<string, { data: TokenMetadata; timestamp: number }>;
  holders: Map<string, { data: TokenHolders; timestamp: number }>;
  transactions: Map<string, { data: any[]; timestamp: number }>;
}

export class HeliusService {
  private static instance: HeliusService;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.helius.xyz/v0';
  private readonly cache: HeliusCache;
  private readonly cacheTimeout = 3600000; // 1 hour in milliseconds
  private readonly rateLimitDelay = 100; // 100ms between requests
  private lastRequestTime = 0;
  
  private constructor() {
    this.apiKey = process.env.HELIUS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY not found in environment variables');
    }
    
    this.cache = {
      metadata: new Map(),
      holders: new Map(),
      transactions: new Map()
    };
  }
  
  static getInstance(): HeliusService {
    if (!HeliusService.instance) {
      HeliusService.instance = new HeliusService();
    }
    return HeliusService.instance;
  }
  
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await this.delay(this.rateLimitDelay - timeSinceLastRequest);
    }
    
    this.lastRequestTime = Date.now();
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private isValidCache(timestamp: number): boolean {
    return Date.now() - timestamp < this.cacheTimeout;
  }
  
  async getTokenMetadata(address: string): Promise<TokenMetadata | null> {
    // Check cache first
    const cached = this.cache.metadata.get(address);
    if (cached && this.isValidCache(cached.timestamp)) {
      console.log(`📦 Using cached metadata for ${address}`);
      return cached.data;
    }
    
    try {
      await this.enforceRateLimit();
      
      // Helius uses RPC-style API for token metadata
      const response = await fetch(`${this.baseUrl}/token-metadata?api-key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mintAccounts: [address]
        })
      });
      
      if (!response.ok) {
        console.error(`Failed to fetch metadata for ${address}: ${response.statusText}`);
        return null;
      }
      
      const results = await response.json() as any[];
      if (!results || results.length === 0) {
        return null;
      }
      
      const data = results[0];
      
      // Transform the response to our TokenMetadata format
      const metadata: TokenMetadata = {
        address,
        name: data.onChainMetadata?.metadata?.data?.name || data.legacyMetadata?.name,
        symbol: data.onChainMetadata?.metadata?.data?.symbol || data.legacyMetadata?.symbol,
        description: data.onChainMetadata?.metadata?.data?.description || data.legacyMetadata?.description,
        image: data.onChainMetadata?.metadata?.data?.uri || data.legacyMetadata?.logoURI,
        supply: data.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.supply,
        decimals: data.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.decimals || data.legacyMetadata?.decimals,
        tokenStandard: data.onChainMetadata?.metadata?.tokenStandard,
        creators: data.onChainMetadata?.metadata?.data?.creators
      };
      
      // Cache the result
      this.cache.metadata.set(address, {
        data: metadata,
        timestamp: Date.now()
      });
      
      console.log(`✅ Fetched metadata for ${metadata.symbol || address}`);
      return metadata;
      
    } catch (error) {
      console.error(`Error fetching metadata for ${address}:`, error);
      return null;
    }
  }
  
  async getTokenHolders(address: string, limit: number = 100): Promise<TokenHolders | null> {
    // Check cache first
    const cached = this.cache.holders.get(address);
    if (cached && this.isValidCache(cached.timestamp)) {
      console.log(`📦 Using cached holders for ${address}`);
      return cached.data;
    }
    
    try {
      await this.enforceRateLimit();
      
      // Helius uses different endpoint for token accounts
      const response = await fetch(
        `${this.baseUrl}/addresses/${address}/balances?api-key=${this.apiKey}&limit=${limit}`,
        {
          method: 'GET'
        }
      );
      
      if (!response.ok) {
        console.error(`Failed to fetch holders for ${address}: ${response.statusText}`);
        return null;
      }
      
      // Note: The balances endpoint returns native token balances, not SPL token holdings
      // We'll need to use the token-accounts endpoint instead
      const tokenAccountsResponse = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getProgramAccounts',
            params: [
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              {
                encoding: 'jsonParsed',
                filters: [
                  {
                    dataSize: 165
                  },
                  {
                    memcmp: {
                      offset: 0,
                      bytes: address
                    }
                  }
                ]
              }
            ]
          })
        }
      );
      
      if (!tokenAccountsResponse.ok) {
        console.error(`Failed to fetch token accounts: ${tokenAccountsResponse.statusText}`);
        return null;
      }
      
      const rpcResult: any = await tokenAccountsResponse.json();
      const accounts = rpcResult.result || [];
      
      // Calculate holder statistics
      const totalSupply = accounts.reduce((sum: number, account: any) => {
        const amount = account.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
        return sum + amount;
      }, 0);
      
      const holders = accounts
        .map((account: any) => {
          const info = account.account?.data?.parsed?.info;
          const amount = info?.tokenAmount?.uiAmount || 0;
          return {
            owner: info?.owner || '',
            balance: amount,
            percentage: totalSupply > 0 ? (amount / totalSupply) * 100 : 0
          };
        })
        .filter((holder: any) => holder.balance > 0)
        .sort((a: any, b: any) => b.balance - a.balance);
      
      const holdersData: TokenHolders = {
        total: holders.length,
        holders: holders.slice(0, limit)
      };
      
      // Cache the result
      this.cache.holders.set(address, {
        data: holdersData,
        timestamp: Date.now()
      });
      
      console.log(`✅ Fetched ${holdersData.total} holders for ${address}`);
      return holdersData;
      
    } catch (error) {
      console.error(`Error fetching holders for ${address}:`, error);
      return null;
    }
  }
  
  async getEnhancedTransactions(address: string, limit: number = 100): Promise<any[]> {
    // Check cache first
    const cached = this.cache.transactions.get(address);
    if (cached && this.isValidCache(cached.timestamp)) {
      console.log(`📦 Using cached transactions for ${address}`);
      return cached.data;
    }
    
    try {
      await this.enforceRateLimit();
      
      const response = await fetch(
        `${this.baseUrl}/addresses/${address}/transactions?api-key=${this.apiKey}&limit=${limit}`,
        {
          method: 'GET'
        }
      );
      
      if (!response.ok) {
        console.error(`Failed to fetch transactions for ${address}: ${response.statusText}`);
        return [];
      }
      
      const transactions = await response.json() as any[];
      
      // Cache the result
      this.cache.transactions.set(address, {
        data: transactions,
        timestamp: Date.now()
      });
      
      console.log(`✅ Fetched ${transactions.length} transactions for ${address}`);
      return transactions;
      
    } catch (error) {
      console.error(`Error fetching transactions for ${address}:`, error);
      return [];
    }
  }
  
  async batchGetTokenMetadata(addresses: string[]): Promise<Map<string, TokenMetadata | null>> {
    const results = new Map<string, TokenMetadata | null>();
    
    console.log(`🔄 Fetching metadata for ${addresses.length} tokens...`);
    
    // Helius supports batch requests for token metadata
    // Process in batches of 100 (Helius limit)
    const batchSize = 100;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      
      try {
        await this.enforceRateLimit();
        
        const response = await fetch(`${this.baseUrl}/token-metadata?api-key=${this.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            mintAccounts: batch
          })
        });
        
        if (!response.ok) {
          console.error(`Batch request failed: ${response.statusText}`);
          // Fall back to individual requests
          for (const address of batch) {
            const metadata = await this.getTokenMetadata(address);
            results.set(address, metadata);
          }
        } else {
          const batchResults = await response.json() as any[];
          
          // Map results back to addresses
          for (const data of batchResults) {
            const address = data.account || data.mint;
            const metadata: TokenMetadata = {
              address,
              name: data.onChainMetadata?.metadata?.data?.name || data.legacyMetadata?.name,
              symbol: data.onChainMetadata?.metadata?.data?.symbol || data.legacyMetadata?.symbol,
              description: data.onChainMetadata?.metadata?.data?.description || data.legacyMetadata?.description,
              image: data.onChainMetadata?.metadata?.data?.uri || data.legacyMetadata?.logoURI,
              supply: data.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.supply,
              decimals: data.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.decimals || data.legacyMetadata?.decimals,
              tokenStandard: data.onChainMetadata?.metadata?.tokenStandard,
              creators: data.onChainMetadata?.metadata?.data?.creators
            };
            
            results.set(address, metadata);
            
            // Cache the result
            this.cache.metadata.set(address, {
              data: metadata,
              timestamp: Date.now()
            });
          }
        }
        
        // Progress update
        const processed = Math.min(i + batchSize, addresses.length);
        console.log(`📊 Progress: ${processed}/${addresses.length} tokens processed`);
        
        // Add delay between batches
        if (i + batchSize < addresses.length) {
          await this.delay(500); // 500ms between batches
        }
      } catch (error) {
        console.error(`Batch processing error:`, error);
        // Fall back to individual requests
        for (const address of batch) {
          const metadata = await this.getTokenMetadata(address);
          results.set(address, metadata);
        }
      }
    }
    
    return results;
  }
  
  // Get comprehensive token data
  async getComprehensiveTokenData(address: string): Promise<{
    metadata: TokenMetadata | null;
    holders: TokenHolders | null;
    recentTransactions: any[];
  }> {
    console.log(`🔍 Fetching comprehensive data for ${address}...`);
    
    // Fetch all data in parallel
    const [metadata, holders, transactions] = await Promise.all([
      this.getTokenMetadata(address),
      this.getTokenHolders(address, 50), // Top 50 holders
      this.getEnhancedTransactions(address, 25) // Last 25 transactions
    ]);
    
    return {
      metadata,
      holders,
      recentTransactions: transactions
    };
  }
  
  // Clear cache for specific token or all tokens
  clearCache(address?: string): void {
    if (address) {
      this.cache.metadata.delete(address);
      this.cache.holders.delete(address);
      this.cache.transactions.delete(address);
      console.log(`🗑️ Cleared cache for ${address}`);
    } else {
      this.cache.metadata.clear();
      this.cache.holders.clear();
      this.cache.transactions.clear();
      console.log('🗑️ Cleared all cache');
    }
  }
  
  // Get cache statistics
  getCacheStats(): {
    metadata: number;
    holders: number;
    transactions: number;
    totalSize: number;
  } {
    return {
      metadata: this.cache.metadata.size,
      holders: this.cache.holders.size,
      transactions: this.cache.transactions.size,
      totalSize: this.cache.metadata.size + this.cache.holders.size + this.cache.transactions.size
    };
  }
}