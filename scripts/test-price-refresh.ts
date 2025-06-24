// scripts/test-price-refresh.ts

import 'dotenv/config';
import { BondingCurveFetcher } from '../src/monitor/services/bonding-curve-fetcher';
import { getRpcUrl } from '.src/monitor/utils/rpc';
import { config } from '../src/config';

async function testBondingCurveFetch() {
  const rpcUrl = getRpcUrl(config);
  console.log(`Using RPC: ${rpcUrl}`);
  
  const fetcher = new BondingCurveFetcher(rpcUrl);
  
  // Test with a known bonding curve address
  const testAddress = process.argv[2] || 'YOUR_TEST_BONDING_CURVE_ADDRESS';
  
  console.log(`\nFetching bonding curve: ${testAddress}`);
  const data = await fetcher.getBondingCurveData(testAddress);
  
  if (data) {
    console.log('\n✅ Bonding Curve Data:');
    console.log(`  SOL Balance: ${data.solBalance.toFixed(4)} SOL`);
    console.log(`  Progress: ${data.progress.toFixed(2)}%`);
    console.log(`  Virtual SOL: ${data.virtualSolReserves.toFixed(4)}`);
    console.log(`  Virtual Tokens: ${data.virtualTokenReserves.toFixed(0)}`);
    console.log(`  Price: ${(data.virtualSolReserves / data.virtualTokenReserves).toFixed(10)} SOL`);
    console.log(`  Complete: ${data.complete}`);
  } else {
    console.log('❌ Failed to fetch bonding curve data');
  }
}

testBondingCurveFetch().catch(console.error);