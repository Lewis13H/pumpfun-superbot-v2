import 'dotenv/config';
import Client, { SubscribeRequest, CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { AMM_PROGRAM_ID } from '../utils/config/constants';
import * as borsh from '@coral-xyz/borsh';
import bs58 from 'bs58';

// Layout for AMM trade instruction data
const TRADE_LAYOUT = borsh.struct([
  borsh.u8('instruction'),
  borsh.u64('amount'),
  borsh.u64('expectedOut'),
  borsh.u64('maxSlippage'),
  borsh.u64('platformFeeBasisPoints'),
  borsh.publicKey('referral'),
  borsh.publicKey('referralAuthority'),
  borsh.u8('resourceMint')
]);

async function debugAMMReserves() {
  console.log('🔍 Starting AMM Reserve Debug Script...');
  console.log('📊 Will capture AMM transactions for 20 seconds');
  console.log('🎯 Looking for reserve information in transaction data\n');

  const endpoint = process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.shyft.to';
  const token = process.env.SHYFT_GRPC_TOKEN;

  if (!token) {
    throw new Error('SHYFT_GRPC_TOKEN environment variable is required');
  }

  // Ensure endpoint is a valid URL
  let formattedEndpoint = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    formattedEndpoint = `https://${endpoint}`;
  }

  const client = new Client(formattedEndpoint, token, undefined);

  let transactionCount = 0;
  const capturedTransactions: any[] = [];

  // Handle AMM transactions
  const handleAMMTransaction = async (data: any) => {
    try {
      // Check if this is an AMM transaction
      const transaction = data?.transaction?.transaction?.transaction;
      if (!transaction?.signatures?.[0]) return;

      const accounts = transaction.transaction?.message?.accountKeys || [];
      const accountsStr = accounts.map((acc: any) => {
        if (typeof acc === 'string') return acc;
        if (Buffer.isBuffer(acc)) {
          // Convert buffer to base58 string
          return bs58.encode(acc);
        }
        if (acc && typeof acc === 'object' && acc.length === 32) {
          // Likely a byte array
          return bs58.encode(Buffer.from(acc));
        }
        return acc.toString();
      });

      // Check if AMM program is involved
      if (!accountsStr.includes(AMM_PROGRAM_ID)) return;

      transactionCount++;
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📦 AMM Transaction #${transactionCount}`);
      console.log(`🔑 Signature: ${transaction.signatures[0]}`);
      console.log(`⏰ Slot: ${transaction.slot || 'N/A'}`);
      console.log(`${'='.repeat(80)}`);

      // Log account keys
      console.log('\n📋 Account Keys:');
      accountsStr.forEach((acc: string, i: number) => {
        console.log(`  [${i}] ${acc}`);
      });

      // Log instructions
      const instructions = transaction.transaction?.message?.instructions || [];
      console.log(`\n📝 Instructions (${instructions.length} total):`);
      
      instructions.forEach((ix: any, i: number) => {
        const programIdIndex = ix.programIdIndex;
        const programId = accountsStr[programIdIndex] || 'Unknown';
        
        console.log(`\n  Instruction ${i}:`);
        console.log(`    Program: ${programId}`);
        console.log(`    Accounts: [${ix.accounts?.join(', ') || 'None'}]`);
        
        if (ix.data) {
          console.log(`    Data (hex): ${ix.data}`);
          console.log(`    Data (base64): ${Buffer.from(ix.data, 'hex').toString('base64')}`);
          
          // Try to decode as AMM trade if it's the AMM program
          if (programId.includes(AMM_PROGRAM_ID)) {
            try {
              const dataBuffer = Buffer.from(ix.data, 'hex');
              const decoded = TRADE_LAYOUT.decode(dataBuffer);
              console.log('    Decoded Trade Data:', {
                instruction: decoded.instruction,
                amount: decoded.amount.toString(),
                expectedOut: decoded.expectedOut.toString(),
                maxSlippage: decoded.maxSlippage.toString(),
                platformFeeBasisPoints: decoded.platformFeeBasisPoints.toString()
              });
            } catch (e) {
              console.log('    Could not decode as trade instruction');
            }
          }
        }
      });

      // Log inner instructions
      const innerInstructions = transaction.meta?.innerInstructions || [];
      if (innerInstructions.length > 0) {
        console.log(`\n📂 Inner Instructions (${innerInstructions.length} groups):`);
        innerInstructions.forEach((group: any, groupIndex: number) => {
          console.log(`\n  Group ${groupIndex} (from instruction ${group.index}):`);
          group.instructions?.forEach((inner: any, i: number) => {
            const programIdIndex = inner.programIdIndex;
            const programId = accountsStr[programIdIndex] || 'Unknown';
            console.log(`    Inner ${i}: ${programId}`);
            if (inner.data) {
              console.log(`      Data: ${inner.data}`);
            }
          });
        });
      }

      // Log account balances (pre/post)
      const preBalances = transaction.meta?.preBalances || [];
      const postBalances = transaction.meta?.postBalances || [];
      const preTokenBalances = transaction.meta?.preTokenBalances || [];
      const postTokenBalances = transaction.meta?.postTokenBalances || [];

      console.log('\n💰 Balance Changes:');
      console.log('  SOL Balances:');
      preBalances.forEach((pre: any, i: number) => {
        const post = postBalances[i] || 0;
        const preNum = typeof pre === 'string' ? parseInt(pre) : pre;
        const postNum = typeof post === 'string' ? parseInt(post) : post;
        const change = postNum - preNum;
        if (change !== 0) {
          console.log(`    [${i}] ${accountsStr[i]?.substring(0, 8)}... : ${preNum / 1e9} → ${postNum / 1e9} SOL (${change > 0 ? '+' : ''}${change / 1e9})`);
        }
      });

      console.log('\n  Token Balances:');
      const tokenBalanceMap = new Map<string, { pre: any, post: any }>();
      
      // Map pre-balances
      preTokenBalances.forEach((balance: any) => {
        const key = `${balance.accountIndex}-${balance.mint}`;
        tokenBalanceMap.set(key, { pre: balance, post: null });
      });
      
      // Map post-balances
      postTokenBalances.forEach((balance: any) => {
        const key = `${balance.accountIndex}-${balance.mint}`;
        const existing = tokenBalanceMap.get(key) || { pre: null, post: null };
        existing.post = balance;
        tokenBalanceMap.set(key, existing);
      });

      tokenBalanceMap.forEach((balances, key) => {
        const { pre, post } = balances;
        if (pre || post) {
          const preAmount = pre?.uiTokenAmount?.uiAmount || pre?.uiTokenAmount?.amount || 0;
          const postAmount = post?.uiTokenAmount?.uiAmount || post?.uiTokenAmount?.amount || 0;
          const change = postAmount - preAmount;
          const accountIndex = pre?.accountIndex || post?.accountIndex;
          const mint = pre?.mint || post?.mint;
          
          if (change !== 0) {
            console.log(`    [${accountIndex}] ${accountsStr[accountIndex]?.substring(0, 8)}... Token ${mint.substring(0, 8)}...:`);
            console.log(`      ${preAmount} → ${postAmount} (${change > 0 ? '+' : ''}${change})`);
          }
        }
      });

      // Log logs if any
      const logs = transaction.meta?.logMessages || [];
      if (logs.length > 0) {
        console.log('\n📜 Logs:');
        logs.forEach((log: string) => {
          // Look for reserve-related logs
          if (log.includes('reserve') || log.includes('liquidity') || log.includes('pool')) {
            console.log(`  🔍 ${log}`);
          } else {
            console.log(`  ${log}`);
          }
        });
      }

      // Look for account data in meta
      if (transaction.meta?.loadedAddresses) {
        console.log('\n📍 Loaded Addresses:', transaction.meta.loadedAddresses);
      }

      // Capture for later analysis
      capturedTransactions.push({
        signature: transaction.signatures[0],
        slot: transaction.slot,
        accounts: accountsStr,
        instructions,
        innerInstructions,
        preBalances,
        postBalances,
        preTokenBalances,
        postTokenBalances,
        logs
      });

    } catch (error) {
      console.error('Error processing transaction:', error);
    }
  };

  try {
    console.log('🚀 Connecting to Shyft gRPC...\n');
    
    // Create subscription request
    const request = {
      slots: {},
      accounts: {},
      transactions: {
        ammTrades: {
          vote: false,
          failed: false,
          accountInclude: [AMM_PROGRAM_ID],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined
    };

    const stream = await client.subscribe();
    
    // Handle incoming messages
    stream.on('data', (data: any) => {
      if (data.transaction) {
        handleAMMTransaction(data);
      }
    });

    // Send subscription request with callback
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    console.log('✅ Subscribed to AMM transactions\n');

    // Run for 20 seconds
    await new Promise(resolve => setTimeout(resolve, 20000));

    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 Debug Summary:');
    console.log(`${'='.repeat(80)}`);
    console.log(`Total AMM transactions captured: ${transactionCount}`);
    console.log(`\n🔍 Analysis:`);
    
    if (capturedTransactions.length > 0) {
      console.log('\n1. Account patterns observed:');
      const accountPatterns = new Set<string>();
      capturedTransactions.forEach(tx => {
        tx.accounts.forEach((acc: string, i: number) => {
          if (i < 10) { // Look at first 10 accounts
            accountPatterns.add(`Position ${i}: ${acc.substring(0, 8)}...`);
          }
        });
      });
      accountPatterns.forEach(pattern => console.log(`   ${pattern}`));

      console.log('\n2. Common log patterns:');
      const logPatterns = new Map<string, number>();
      capturedTransactions.forEach(tx => {
        tx.logs?.forEach((log: string) => {
          if (log.includes('reserve') || log.includes('liquidity') || log.includes('pool')) {
            const count = logPatterns.get(log) || 0;
            logPatterns.set(log, count + 1);
          }
        });
      });
      
      if (logPatterns.size > 0) {
        logPatterns.forEach((count, log) => {
          console.log(`   "${log}" (seen ${count} times)`);
        });
      } else {
        console.log('   No reserve/liquidity/pool related logs found');
      }

      console.log('\n3. Token balance changes:');
      console.log('   Most transactions show token swaps with balance changes');
      console.log('   Reserve information might be in account state, not transaction data');
      
      console.log('\n💡 Recommendations:');
      console.log('   1. Reserve values are likely stored in AMM pool account state');
      console.log('   2. Need to fetch account data for the pool accounts');
      console.log('   3. Consider monitoring account updates for pool state changes');
      console.log('   4. The instruction data contains trade amounts but not reserves');
    }

  } catch (error) {
    console.error('Error in debug script:', error);
  } finally {
    console.log('\n🛑 Closing connection...');
    console.log('✅ Debug script completed');
    process.exit(0);
  }
}

// Run the debug script
debugAMMReserves().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});