#!/usr/bin/env node
import { SubscribeRequest, CommitmentLevel, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../../stream/client';
import { PUMP_SWAP_PROGRAM } from '../../utils/constants';
import bs58 from 'bs58';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { decodeAmmPoolAccount, formatPoolData } from '../../utils/amm-pool-decoder';

dotenv.config();

async function debugAmmPool() {
  console.log(chalk.cyan('🔍 AMM Pool Debug Monitor'));
  console.log(chalk.gray('=' .repeat(50)));
  
  const client = await StreamClient.getInstance().getClient();
  const stream = await client.subscribe();

  const request: SubscribeRequest = {
    slots: {},
    accounts: {
      amm_pools: {
        account: [],
        owner: [PUMP_SWAP_PROGRAM],
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

  let poolCount = 0;

  stream.on('data', async (data: SubscribeUpdate) => {
    try {
      if (data.account) {
        poolCount++;
        if (poolCount > 5) {
          console.log(chalk.yellow('\n✅ Analyzed 5 pools, stopping...'));
          process.exit(0);
        }
        
        const accountInfo = data.account.account;
        if (!accountInfo) return;
        
        const dataBuffer = Buffer.from(accountInfo.data);
        const pubkey = typeof accountInfo.pubkey === 'string' 
          ? accountInfo.pubkey 
          : bs58.encode(accountInfo.pubkey);
        
        console.log(chalk.yellow(`\n📦 Pool #${poolCount}: ${pubkey}`));
        console.log(chalk.gray(`Data length: ${dataBuffer.length} bytes`));
        
        // Show discriminator
        const discriminator = dataBuffer.slice(0, 8).toString('hex');
        console.log(chalk.gray(`Discriminator: ${discriminator}`));
        
        // Try to decode using custom decoder
        const decodedPool = decodeAmmPoolAccount(dataBuffer);
        if (decodedPool) {
          console.log(chalk.green('\n✅ Successfully decoded pool account:'));
          const formatted = formatPoolData(decodedPool);
          console.log(chalk.white('  Creator:'), chalk.yellow(formatted.creator));
          console.log(chalk.white('  Base Mint:'), chalk.yellow(formatted.baseMint));
          console.log(chalk.white('  Quote Mint:'), chalk.yellow(formatted.quoteMint));
          console.log(chalk.white('  LP Mint:'), chalk.yellow(formatted.lpMint));
          console.log(chalk.white('  Pool Base Token Account:'), chalk.yellow(formatted.poolBaseTokenAccount));
          console.log(chalk.white('  Pool Quote Token Account:'), chalk.yellow(formatted.poolQuoteTokenAccount));
          console.log(chalk.white('  LP Supply:'), chalk.yellow(formatted.lpSupply));
        } else {
          console.log(chalk.red('\n❌ Failed to decode pool account'));
          
          // Show first 300 bytes in hex for debugging
          console.log(chalk.gray('\nFirst 300 bytes (hex):'));
          console.log(dataBuffer.slice(0, 300).toString('hex').match(/.{1,64}/g)?.join('\n'));
          
          // Try to find pubkeys (32-byte sequences that look valid)
          console.log(chalk.cyan('\nPotential pubkeys found:'));
          for (let i = 8; i < Math.min(dataBuffer.length - 32, 300); i++) {
            const potentialPubkey = dataBuffer.slice(i, i + 32);
            // Check if it could be a pubkey (has non-zero bytes, not all same byte)
            const nonZero = potentialPubkey.some(b => b !== 0);
            const notAllSame = !potentialPubkey.every(b => b === potentialPubkey[0]);
            
            if (nonZero && notAllSame && potentialPubkey[31] !== 0) {
              try {
                const pubkeyStr = bs58.encode(potentialPubkey);
                console.log(`  Offset ${i}: ${pubkeyStr}`);
              } catch {}
            }
          }
          
          // Try to find u64 values
          console.log(chalk.cyan('\nPotential u64 values (as token amounts):'));
          for (let i = 8; i < Math.min(dataBuffer.length - 8, 400); i += 8) {
            const value = dataBuffer.readBigUInt64LE(i);
            if (value > 0n && value < BigInt(1e20)) {
              // Show as both raw and with decimals
              const asTokens6 = Number(value) / 1e6;
              const asTokens9 = Number(value) / 1e9;
              console.log(`  Offset ${i}: ${value} (${asTokens6.toFixed(2)} @ 6 dec, ${asTokens9.toFixed(2)} @ 9 dec)`);
            }
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
      console.log(chalk.green('✅ Subscription active, waiting for AMM pool accounts...'));
    }
  });

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Shutting down...'));
    stream.cancel();
    process.exit(0);
  });
}

debugAmmPool().catch(console.error);