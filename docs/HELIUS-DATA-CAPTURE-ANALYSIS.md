# Helius API Data Capture Analysis for Pump.fun Tokens

## Overview
Helius provides comprehensive APIs for Solana data, though with current limitations for DeFi transaction parsing. Here's what data we can capture to enhance our pump.fun monitoring system.

## Available Helius APIs and Data

### 1. DAS (Digital Asset Standard) API

#### getAsset Endpoint
Retrieves comprehensive token/NFT metadata by mint address.

**Available Data:**
```javascript
{
  // Basic token information
  "id": "mint_address",
  "interface": "FungibleToken",
  "ownership": {
    "owner": "wallet_address",
    "delegate": null,
    "delegated": false,
    "frozen": false
  },
  
  // Token metadata
  "content": {
    "$schema": "https://schema.metaplex.com/nft1.0.json",
    "json_uri": "metadata_uri",
    "metadata": {
      "name": "Token Name",
      "symbol": "SYMBOL",
      "description": "Token description",
      "image": "image_url",
      "attributes": [],
      "properties": {
        "category": "currency",
        "creators": [{
          "address": "creator_wallet",
          "share": 100
        }]
      }
    },
    "files": [{
      "uri": "original_uri",
      "cdn_uri": "cached_cdn_uri",
      "mime": "image/png"
    }]
  },
  
  // On-chain data
  "authorities": [{
    "address": "authority_address",
    "scopes": ["full"]
  }],
  
  // Supply information
  "supply": {
    "print_max_supply": 0,
    "print_current_supply": 0,
    "edition_nonce": null
  },
  
  // Minting information
  "mutable": true,
  "burnt": false,
  "mint_extensions": {}
}
```

**Use for Pump.fun:**
- Get complete token metadata (name, symbol, image)
- Identify creator addresses
- Check if token is frozen or burnt
- Verify token authorities

#### getAssetsByOwner
Get all tokens held by a specific wallet.

**Available Data:**
- List of all fungible tokens and NFTs
- Token balances
- Ownership details

**Use for Pump.fun:**
- Track holder portfolios
- Analyze wallet behavior
- Identify whale wallets

#### getAssetsByCreator
Get all tokens created by a specific address.

**Use for Pump.fun:**
- Analyze creator history
- Track serial token creators
- Assess creator reputation

### 2. Enhanced Transactions API

**Current Limitations:**
- Only parses NFT, Jupiter, and SPL transactions
- Limited DeFi parsing (V2 coming)
- May not fully parse pump.fun specific instructions

**Available Data:**
```javascript
{
  "signature": "transaction_signature",
  "timestamp": 1234567890,
  "slot": 123456789,
  "fee": 5000,
  "feePayer": "payer_address",
  
  // Parsed instructions
  "instructions": [{
    "programId": "program_address",
    "type": "TRANSFER", // Human-readable type
    "source": "source_wallet",
    "destination": "dest_wallet",
    "amount": 1000000,
    "mint": "token_mint"
  }],
  
  // Token balance changes
  "tokenBalanceChanges": [{
    "userAccount": "wallet_address",
    "tokenAccount": "token_account",
    "mint": "token_mint",
    "rawTokenAmount": {
      "tokenAmount": "1000000",
      "decimals": 6
    }
  }],
  
  // Account data changes
  "accountData": [{
    "account": "account_address",
    "nativeBalanceChange": -5000,
    "tokenBalanceChanges": []
  }],
  
  // Transaction type classification
  "type": "TRANSFER",
  "source": "SYSTEM_PROGRAM",
  
  // Events emitted
  "events": {
    "compressed": [],
    "nft": {
      "description": "User transferred token"
    }
  }
}
```

**Use for Pump.fun:**
- Track token transfers
- Monitor balance changes
- Identify transaction types
- Calculate fees paid

### 3. Token API Features

#### Token Balances
```javascript
// Get token balances for a wallet
{
  "tokens": [{
    "mint": "token_mint_address",
    "amount": 1000000000,
    "decimals": 6,
    "tokenAccount": "associated_token_account",
    "owner": "wallet_address"
  }]
}
```

#### Token Supply & Holders
```javascript
// Get token supply information
{
  "mint": "token_mint_address",
  "supply": 1000000000000000,
  "decimals": 6,
  "isInitialized": true,
  "freezeAuthority": null,
  "mintAuthority": null
}
```

### 4. Webhooks for Real-time Monitoring

**Configuration:**
```javascript
{
  "webhookURL": "your_endpoint",
  "transactionTypes": ["TOKEN_MINT", "ANY"],
  "accountAddresses": ["pump_fun_program"],
  "webhookType": "enhanced",
  "filters": {
    "programId": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
  }
}
```

**Real-time Events:**
- New token mints
- Token transfers
- Account updates
- Program interactions

### 5. Geyser Enhanced WebSockets

**Features:**
- Ultra-low latency streaming
- Account state updates
- Transaction streaming
- Program-specific monitoring

**Connection:**
```javascript
const ws = new WebSocket('wss://atlas-mainnet.helius-rpc.com/?api-key=YOUR_KEY');

ws.send(JSON.stringify({
  "jsonrpc": "2.0",
  "id": 420,
  "method": "transactionSubscribe",
  "params": [{
    "accountInclude": ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]
  }]
}));
```

## Data We Can Capture for Pump.fun

### 1. Token Metadata Enhancement
```typescript
async function enrichTokenMetadata(mintAddress: string) {
  const helius = new Helius(API_KEY);
  
  // Get complete token metadata
  const asset = await helius.rpc.getAsset({
    id: mintAddress,
    displayOptions: {
      showFungible: true
    }
  });
  
  return {
    name: asset.content.metadata.name,
    symbol: asset.content.metadata.symbol,
    description: asset.content.metadata.description,
    image: asset.content.files[0]?.cdn_uri,
    creator: asset.content.metadata.properties.creators[0]?.address,
    authorities: asset.authorities,
    mutable: asset.mutable,
    supply: asset.supply
  };
}
```

### 2. Creator Analysis
```typescript
async function analyzeCreator(creatorAddress: string) {
  const helius = new Helius(API_KEY);
  
  // Get all tokens created by this address
  const createdAssets = await helius.rpc.getAssetsByCreator({
    creatorAddress,
    page: 1,
    limit: 1000
  });
  
  // Analyze creator patterns
  const tokenHistory = createdAssets.items.map(asset => ({
    mint: asset.id,
    name: asset.content.metadata.name,
    created: asset.content.metadata.properties.timestamp,
    burnt: asset.burnt,
    supply: asset.supply
  }));
  
  return {
    totalTokensCreated: tokenHistory.length,
    activetokens: tokenHistory.filter(t => !t.burnt).length,
    creationPattern: analyzePattern(tokenHistory)
  };
}
```

### 3. Holder Distribution
```typescript
async function getHolderDistribution(mintAddress: string) {
  // Get top holders by checking largest accounts
  const largeAccounts = await helius.rpc.getTokenLargestAccounts({
    mint: mintAddress
  });
  
  // For each large account, get owner info
  const holders = await Promise.all(
    largeAccounts.map(async (account) => {
      const ownerInfo = await helius.rpc.getAssetsByOwner({
        ownerAddress: account.owner,
        displayOptions: { showFungible: true }
      });
      
      return {
        owner: account.owner,
        balance: account.amount,
        percentage: (account.amount / totalSupply) * 100,
        otherHoldings: ownerInfo.items.length
      };
    })
  );
  
  return holders;
}
```

### 4. Real-time Trade Monitoring
```typescript
// Set up webhook for pump.fun trades
const webhook = await helius.rpc.createWebhook({
  webhookURL: "https://your-server.com/webhook",
  transactionTypes: ["ANY"],
  accountAddresses: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
  webhookType: "enhanced"
});

// Process incoming trades
app.post('/webhook', (req, res) => {
  const transaction = req.body;
  
  // Extract trade data
  const tradeData = {
    signature: transaction.signature,
    timestamp: transaction.timestamp,
    fee: transaction.fee,
    instructions: transaction.instructions,
    balanceChanges: transaction.tokenBalanceChanges,
    
    // Parse pump.fun specific data
    mint: extractMintFromTransaction(transaction),
    tradeType: extractTradeType(transaction),
    amount: extractTradeAmount(transaction)
  };
  
  // Process trade...
});
```

### 5. Enhanced Transaction Analysis
```typescript
async function analyzeTransaction(signature: string) {
  const transaction = await helius.rpc.getTransaction({
    signature,
    commitment: "confirmed"
  });
  
  return {
    // Basic info
    signature: transaction.signature,
    timestamp: transaction.timestamp,
    slot: transaction.slot,
    
    // Fee analysis
    fee: transaction.fee,
    computeUnits: transaction.meta.computeUnitsConsumed,
    
    // Token movements
    tokenTransfers: transaction.tokenBalanceChanges.map(change => ({
      mint: change.mint,
      from: change.userAccount,
      amount: change.rawTokenAmount.tokenAmount,
      decimals: change.rawTokenAmount.decimals
    })),
    
    // Account changes
    accountChanges: transaction.accountData.map(account => ({
      account: account.account,
      solChange: account.nativeBalanceChange,
      tokenChanges: account.tokenBalanceChanges
    }))
  };
}
```

## Integration Strategy for Pump.fun Monitoring

### 1. Metadata Enrichment Pipeline
```typescript
class HeliusEnricher {
  async enrichToken(mintAddress: string) {
    try {
      // Get token metadata
      const asset = await this.helius.rpc.getAsset({
        id: mintAddress,
        displayOptions: { showFungible: true }
      });
      
      // Get creator info
      const creator = asset.content.metadata.properties.creators[0];
      const creatorHistory = await this.analyzeCreator(creator.address);
      
      // Get holder distribution
      const holders = await this.getTopHolders(mintAddress);
      
      return {
        metadata: {
          name: asset.content.metadata.name,
          symbol: asset.content.metadata.symbol,
          description: asset.content.metadata.description,
          image: asset.content.files[0]?.cdn_uri
        },
        creator: {
          address: creator.address,
          history: creatorHistory
        },
        holders: holders,
        authorities: asset.authorities,
        mutable: asset.mutable
      };
    } catch (error) {
      console.error('Helius enrichment failed:', error);
      return null;
    }
  }
}
```

### 2. Real-time Monitoring Enhancement
```typescript
// Combine gRPC stream with Helius webhooks
class EnhancedMonitor {
  constructor() {
    // Primary: gRPC stream for trades
    this.setupGrpcStream();
    
    // Secondary: Helius webhook for enhanced data
    this.setupHeliusWebhook();
    
    // Tertiary: Periodic enrichment
    this.setupEnrichmentJob();
  }
  
  async setupHeliusWebhook() {
    const webhook = await helius.createWebhook({
      webhookURL: process.env.WEBHOOK_URL,
      accountAddresses: [PUMP_PROGRAM],
      webhookType: "enhanced"
    });
    
    // Process enhanced transactions
    this.app.post('/helius-webhook', async (req, res) => {
      const enhanced = req.body;
      
      // Merge with gRPC data
      await this.mergeWithStreamData(enhanced);
      
      res.status(200).send('OK');
    });
  }
}
```

## Limitations & Considerations

### Current Limitations:
1. **Enhanced Transactions API v1** doesn't fully parse DeFi transactions
2. **Rate limits** apply based on pricing tier
3. **Webhook delivery** isn't guaranteed (need retry logic)
4. **Cost** increases with usage

### Best Practices:
1. Use Helius as **secondary enrichment** source
2. Cache metadata aggressively
3. Batch API requests when possible
4. Use webhooks for critical events only
5. Fall back to RPC for missing data

## Summary

Helius provides valuable data for pump.fun token monitoring:

### ✅ Excellent for:
- Token metadata (name, symbol, image, description)
- Creator information and history
- Holder distribution analysis
- Authority and supply data
- Real-time event notifications

### ⚠️ Limited for:
- Complex DeFi transaction parsing (v2 coming)
- Pump.fun specific instruction decoding
- Historical trade reconstruction

### 🎯 Recommended Usage:
1. **Primary**: Use for metadata enrichment
2. **Secondary**: Creator reputation analysis
3. **Tertiary**: Holder distribution tracking
4. **Supplementary**: Real-time webhooks for critical events

Integrate Helius APIs to enhance data quality while maintaining your gRPC stream as the primary data source for pump.fun trades.