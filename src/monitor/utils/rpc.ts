// src/utils/rpc.ts

export function getRpcUrl(config: any): string {
  // If using Shyft RPC (recommended for pump.fun)
  if (config.priceRefresh.useShyftRpc && config.shyft.apiKey) {
    return `https://rpc.shyft.to?api_key=${config.shyft.apiKey}`;
  }
  
  // Otherwise use configured RPC
  return config.priceRefresh.rpcUrl || config.solana.rpcUrl || 'https://api.mainnet-beta.solana.com';
}

export function getConnectionConfig() {
  return {
    commitment: 'confirmed' as const,
    wsEndpoint: undefined, // No WebSocket needed for price refresh
    httpHeaders: {
      'Content-Type': 'application/json',
    }
  };
}