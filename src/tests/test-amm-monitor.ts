#!/usr/bin/env tsx

/**
 * Test AMM Monitor Setup
 * Verifies that the AMM monitor is properly configured
 */

import 'dotenv/config';
import chalk from 'chalk';
import { PublicKey } from '@solana/web3.js';
import { AmmSwapParser } from '../parsers/amm-swap-parser';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';

async function testAmmMonitorSetup() {
  console.log(chalk.cyan.bold('\n🧪 Testing AMM Monitor Setup\n'));
  
  try {
    // Test 1: Check IDL is loaded
    console.log(chalk.blue('1️⃣ Checking AMM IDL...'));
    console.log(chalk.gray(`  Name: ${pumpAmmIdl.metadata.name}`));
    console.log(chalk.gray(`  Version: ${pumpAmmIdl.metadata.version}`));
    console.log(chalk.gray(`  Address: ${pumpAmmIdl.address}`));
    console.log(chalk.gray(`  Instructions: ${pumpAmmIdl.instructions.length}`));
    
    // Find buy/sell instructions
    const buyIx = pumpAmmIdl.instructions.find((ix: any) => ix.name === 'buy');
    const sellIx = pumpAmmIdl.instructions.find((ix: any) => ix.name === 'sell');
    
    if (buyIx && sellIx) {
      console.log(chalk.green('  ✅ Buy/Sell instructions found'));
      console.log(chalk.gray(`     Buy discriminator: [${buyIx.discriminator.join(', ')}]`));
      console.log(chalk.gray(`     Sell discriminator: [${sellIx.discriminator.join(', ')}]`));
    } else {
      console.log(chalk.red('  ❌ Buy/Sell instructions not found'));
    }
    
    // Test 2: Check parser initialization
    console.log(chalk.blue('\n2️⃣ Checking AMM Swap Parser...'));
    const parser = new AmmSwapParser();
    console.log(chalk.green('  ✅ Parser initialized successfully'));
    
    // Test 3: Check program ID
    console.log(chalk.blue('\n3️⃣ Checking Program ID...'));
    const programId = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
    console.log(chalk.gray(`  Program: ${programId.toBase58()}`));
    console.log(chalk.gray(`  Matches IDL: ${programId.toBase58() === pumpAmmIdl.address}`));
    
    // Test 4: Environment check
    console.log(chalk.blue('\n4️⃣ Checking Environment...'));
    const hasGrpcEndpoint = !!process.env.SHYFT_GRPC_ENDPOINT;
    const hasGrpcToken = !!process.env.SHYFT_GRPC_TOKEN;
    const hasDatabase = !!process.env.DATABASE_URL;
    
    console.log(chalk.gray(`  SHYFT_GRPC_ENDPOINT: ${hasGrpcEndpoint ? '✅' : '❌'}`));
    console.log(chalk.gray(`  SHYFT_GRPC_TOKEN: ${hasGrpcToken ? '✅' : '❌'}`));
    console.log(chalk.gray(`  DATABASE_URL: ${hasDatabase ? '✅' : '❌'}`));
    
    // Summary
    console.log(chalk.cyan.bold('\n📊 Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    
    const allGood = buyIx && sellIx && hasGrpcEndpoint && hasGrpcToken && hasDatabase;
    
    if (allGood) {
      console.log(chalk.green('✅ AMM Monitor is properly configured!'));
      console.log(chalk.gray('\nYou can now run:'));
      console.log(chalk.cyan('  npm run amm-monitor'));
      console.log(chalk.gray('\nTo monitor both programs simultaneously:'));
      console.log(chalk.cyan('  npm run bc-monitor   # In terminal 1'));
      console.log(chalk.cyan('  npm run amm-monitor  # In terminal 2'));
    } else {
      console.log(chalk.red('❌ Some configuration issues found'));
      console.log(chalk.yellow('\nPlease check the items marked with ❌ above'));
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  }
}

// Run the test
testAmmMonitorSetup()
  .then(() => {
    console.log(chalk.green('\n✅ Test completed'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  });