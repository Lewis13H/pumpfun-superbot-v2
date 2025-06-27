#!/usr/bin/env node
import { SubscribeRequest, CommitmentLevel, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PUMP_PROGRAM, PUMP_SWAP_PROGRAM } from '../utils/constants';
import { parseBondingCurveAccountManual, parseAmmPoolAccountManual } from '../utils/manual-account-parsers';
import bs58 from 'bs58';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

async function testAccountParsing() {
  console.log(chalk.cyan('🧪 IDL Parsing Test Monitor'));
  console.log(chalk.gray('=' .repeat(50)));
  
  const client = await StreamClient.getInstance().getClient();
  const stream = await client.subscribe();

  // Request account updates
  const request: SubscribeRequest = {
    slots: {},
    accounts: {
      test_accounts: {
        account: [],
        owner: [PUMP_PROGRAM, PUMP_SWAP_PROGRAM],
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

  stream.on('data', async (data: SubscribeUpdate) => {
    try {
      if (data.account) {
        await handleAccount(data.account);
      } else if (data.ping) {
        const pingId = (data.ping as any).id;
        if (pingId) {
          const pongMsg = { pong: { id: pingId } } as any;
        await stream.write(pongMsg);
        }
      }
    } catch (error) {
      console.error(chalk.red('Stream error:'), error);
    }
  });

  stream.write(request, (err: any) => {
    if (err) {
      console.error(chalk.red('Failed to subscribe:'), err);
    } else {
      console.log(chalk.green('✅ Subscription active, waiting for account updates...'));
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Shutting down...'));
    stream.cancel();
    process.exit(0);
  });
}

async function handleAccount(accountUpdate: any) {
  const accountInfo = accountUpdate.account;
  if (!accountInfo) return;

  const owner = accountInfo.owner;
  const data = accountInfo.data;
  const pubkey = accountInfo.pubkey;

  if (!owner || !data) return;

  const ownerStr = typeof owner === 'string' 
    ? owner 
    : bs58.encode(owner as unknown as Uint8Array);

  const pubkeyStr = typeof pubkey === 'string'
    ? pubkey
    : bs58.encode(pubkey as unknown as Uint8Array);

  console.log(chalk.yellow('\n📦 New Account Update'));
  console.log(chalk.gray(`Owner: ${ownerStr}`));
  console.log(chalk.gray(`Pubkey: ${pubkeyStr}`));
  console.log(chalk.gray(`Data length: ${data.length} bytes`));

  // Try different parsing approaches
  console.log(chalk.cyan('\n1. Testing Manual Account Parsers:'));
  
  try {
    const dataBuffer = Buffer.from(data);
    
    if (ownerStr === PUMP_PROGRAM) {
      console.log(chalk.blue('  Using pump.fun manual parser...'));
      const parsed = parseBondingCurveAccountManual(dataBuffer);
      
      if (parsed) {
        console.log(chalk.green('  ✅ Successfully parsed bonding curve:'));
        console.log(JSON.stringify(parsed, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value
        , 2));
      } else {
        console.log(chalk.red('  ❌ Failed to parse bonding curve'));
      }
    } else if (ownerStr === PUMP_SWAP_PROGRAM) {
      console.log(chalk.blue('  Using pump.swap manual parser...'));
      const parsed = parseAmmPoolAccountManual(dataBuffer);
      
      if (parsed) {
        console.log(chalk.green('  ✅ Successfully parsed AMM pool:'));
        console.log(JSON.stringify(parsed, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value
        , 2));
      } else {
        console.log(chalk.red('  ❌ Failed to parse AMM pool'));
      }
    }
  } catch (error) {
    console.log(chalk.red(`  ❌ Manual parsing error: ${error instanceof Error ? error.message : String(error)}`));
  }


  // Show raw data sample
  console.log(chalk.cyan('\n3. Raw data (first 100 bytes in hex):'));
  const dataBuffer = Buffer.from(data);
  console.log(chalk.gray(dataBuffer.slice(0, 100).toString('hex')));
  
  // Check discriminator
  if (dataBuffer.length >= 8) {
    const discriminator = dataBuffer.slice(0, 8);
    console.log(chalk.cyan('\n4. Discriminator:'));
    console.log(chalk.gray(`  Hex: ${discriminator.toString('hex')}`));
    console.log(chalk.gray(`  Decimal: [${Array.from(discriminator).join(', ')}]`));
  }
}

testAccountParsing().catch(console.error);