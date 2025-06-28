#!/usr/bin/env node
import { SubscribeRequest, CommitmentLevel, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../../stream/client';
import { PUMP_SWAP_PROGRAM } from '../../utils/constants';
import bs58 from 'bs58';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { decodeAmmPoolAccount, formatPoolData } from '../../utils/amm-pool-decoder';
import { PublicKey } from '@solana/web3.js';

dotenv.config();

interface TokenAccountData {
  mint: string;
  owner: string;
  amount: bigint;
  decimals: number;
}

async function testAmmReserves() {
  console.log(chalk.cyan('🔍 AMM Pool Reserves Test'));
  console.log(chalk.gray('=' .repeat(50)));
  
  const client = await StreamClient.getInstance().getClient();
  const stream = await client.subscribe();

  // We'll monitor a specific pool and its token accounts
  const targetPool = '9tv7erQ47kUNxrgu3bneB68pWQ2LHJQpXjypnosjmwjr'; // Example pool from debug output
  const poolBaseTokenAccount = '9gbaLt6fyUapn4c3jRAeSrCHTuTtnbyHLeLS293VusNV';
  const poolQuoteTokenAccount = 'Gdcehk7QNkQiz3Yc6kix3fTDGMFu1t9C1DqjBqhZY8TL';

  const request: SubscribeRequest = {
    slots: {},
    accounts: {
      pool: {
        account: [targetPool],
        owner: [],
        filters: [],
      },
      token_accounts: {
        account: [poolBaseTokenAccount, poolQuoteTokenAccount],
        owner: [],
        filters: [],
      },
    },
    transactions: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.CONFIRMED,
    entry: {},
    transactionsStatus: {},
  };

  const tokenAccounts = new Map<string, TokenAccountData>();

  stream.on('data', async (data: SubscribeUpdate) => {
    try {
      if (data.account) {
        const accountInfo = data.account.account;
        if (!accountInfo) return;
        
        const dataBuffer = Buffer.from(accountInfo.data);
        const pubkey = typeof accountInfo.pubkey === 'string' 
          ? accountInfo.pubkey 
          : bs58.encode(accountInfo.pubkey);
        
        // Check if it's the pool account
        if (pubkey === targetPool) {
          console.log(chalk.yellow(`\n📦 Pool Account: ${pubkey}`));
          
          const decodedPool = decodeAmmPoolAccount(dataBuffer);
          if (decodedPool) {
            const formatted = formatPoolData(decodedPool);
            console.log(chalk.green('✅ Pool decoded:'));
            console.log(chalk.white('  Base Mint:'), chalk.yellow(formatted.baseMint));
            console.log(chalk.white('  Quote Mint:'), chalk.yellow(formatted.quoteMint));
            
            // Check if we have token account data
            const baseData = tokenAccounts.get(poolBaseTokenAccount);
            const quoteData = tokenAccounts.get(poolQuoteTokenAccount);
            
            if (baseData && quoteData) {
              console.log(chalk.cyan('\n💰 Pool Reserves:'));
              console.log(chalk.white('  Base Reserve:'), chalk.yellow(`${baseData.amount} (${Number(baseData.amount) / 1e6} tokens)`));
              console.log(chalk.white('  Quote Reserve:'), chalk.yellow(`${quoteData.amount} (${Number(quoteData.amount) / 1e9} SOL)`));
              
              // Calculate price
              const baseTokens = Number(baseData.amount) / 1e6;
              const quoteSol = Number(quoteData.amount) / 1e9;
              const price = quoteSol / baseTokens;
              console.log(chalk.green('  Price:'), chalk.yellow(`${price.toFixed(9)} SOL per token`));
            }
          }
        } 
        // Check if it's a token account
        else if (pubkey === poolBaseTokenAccount || pubkey === poolQuoteTokenAccount) {
          console.log(chalk.blue(`\n💳 Token Account: ${pubkey}`));
          
          // Parse SPL Token account (165 bytes)
          if (dataBuffer.length >= 165) {
            const mint = new PublicKey(dataBuffer.slice(0, 32)).toBase58();
            const owner = new PublicKey(dataBuffer.slice(32, 64)).toBase58();
            const amount = dataBuffer.readBigUInt64LE(64);
            
            // For now, assume 6 decimals for token, 9 for SOL
            const decimals = mint === 'So11111111111111111111111111111111111111112' ? 9 : 6;
            
            tokenAccounts.set(pubkey, { mint, owner, amount, decimals });
            
            console.log(chalk.white('  Mint:'), chalk.yellow(mint));
            console.log(chalk.white('  Amount:'), chalk.yellow(`${amount} (${Number(amount) / Math.pow(10, decimals)})`));
          }
        }
        
      } else if (data.ping) {
        const pingId = (data.ping as any).id;
        if (pingId) {
          const pongMsg = { pong: { id: pingId } } as any;
          await stream.write(pongMsg);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
    }
  });

  stream.write(request, (err: any) => {
    if (err) {
      console.error(chalk.red('Failed to subscribe:'), err);
    } else {
      console.log(chalk.green('✅ Subscription active'));
      console.log(chalk.gray('Monitoring pool and token accounts...'));
    }
  });

  // Exit after 30 seconds
  setTimeout(() => {
    console.log(chalk.yellow('\n👋 Test complete'));
    stream.cancel();
    process.exit(0);
  }, 30000);

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Shutting down...'));
    stream.cancel();
    process.exit(0);
  });
}

testAmmReserves().catch(console.error);