/**
 * Monitor for pump.swap AMM pool creation (graduation events)
 * Based on shyft-code-examples
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { PublicKey } from '@solana/web3.js';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';
import { Pool } from 'pg';

const PUMP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

// Load AMM IDL
const idlPath = path.join(__dirname, '../idls/pump_amm_0.1.0.json');
const pumpAmmIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;

async function monitorPoolCreation() {
  console.log('🔍 Monitoring for AMM Pool Creation (Graduations)\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  let client: Client | null = null;
  let stream: any = null;
  
  const cleanup = async () => {
    try {
      if (stream) {
        stream.end();
        stream.removeAllListeners();
      }
      if (client) {
        client.close();
      }
    } catch (e) {
      // Ignore
    }
  };
  
  try {
    // Initialize parser
    const parser = new SolanaParser([]);
    parser.addParserFromIdl(PUMP_AMM_PROGRAM_ID, pumpAmmIdl);
    
    client = new Client(
      process.env.SHYFT_GRPC_ENDPOINT!,
      process.env.SHYFT_GRPC_TOKEN!,
      undefined
    );
    
    stream = await client.subscribe();
    
    let totalTxns = 0;
    let poolCreations = 0;
    let buyEvents = 0;
    let sellEvents = 0;
    
    stream.on('data', async (data: any) => {
      if (data?.transaction) {
        totalTxns++;
        
        const tx = data.transaction?.transaction || data.transaction;
        const meta = tx?.meta || data.transaction?.meta;
        
        // Get signature
        const signature = data.transaction?.signature || 
                         (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                         (tx?.signatures?.[0] && bs58.encode(tx.signatures[0])) ||
                         'unknown';
        
        // Parse instructions
        try {
          const message = tx?.transaction?.message || tx?.message;
          const loadedAddresses = meta?.loadedAddresses;
          
          if (message) {
            const parsedIxs = parser.parseTransactionData(message, loadedAddresses);
            
            // Look for AMM instructions
            const ammIxs = parsedIxs.filter((ix: any) => 
              ix.programId.equals(new PublicKey(PUMP_AMM_PROGRAM_ID))
            );
            
            for (const ix of ammIxs) {
              if (ix.name === 'create_pool') {
                poolCreations++;
                console.log(`\n🎉 POOL CREATION DETECTED! #${poolCreations}`);
                console.log(`   Signature: ${signature}`);
                console.log(`   Time: ${new Date().toISOString()}`);
                
                // Extract pool details
                const args = ix.args || ix.data || {};
                console.log(`   Arguments:`, JSON.stringify(args, null, 2));
                
                // Extract accounts
                const accounts = ix.accounts || [];
                if (accounts.length > 0) {
                  console.log(`   Key Accounts:`);
                  accounts.slice(0, 10).forEach((acc: any, i: number) => {
                    console.log(`     ${i}: ${acc.pubkey || acc}`);
                  });
                }
                
                // Try to find the mint address (usually in the accounts)
                const mintAddress = accounts[2]?.pubkey || accounts[2]; // Based on IDL structure
                if (mintAddress) {
                  console.log(`   🪙 Mint Address: ${mintAddress}`);
                  
                  // Update database
                  try {
                    await pool.query(`
                      UPDATE tokens_unified
                      SET graduated_to_amm = true,
                          bonding_curve_complete = true,
                          current_program = 'amm_pool',
                          updated_at = NOW()
                      WHERE mint_address = $1
                    `, [mintAddress]);
                    
                    console.log(`   ✅ Marked token as graduated in DB`);
                  } catch (err) {
                    console.error(`   ❌ Failed to update DB:`, err);
                  }
                }
                
                console.log('');
              } else if (ix.name === 'buy') {
                buyEvents++;
                if (buyEvents % 10 === 0) {
                  console.log(`📈 ${buyEvents} buy events detected`);
                }
              } else if (ix.name === 'sell') {
                sellEvents++;
                if (sellEvents % 10 === 0) {
                  console.log(`📉 ${sellEvents} sell events detected`);
                }
              } else {
                console.log(`🔸 Other AMM instruction: ${ix.name}`);
              }
            }
          }
        } catch (error) {
          // Silent parse errors
        }
        
        // Progress
        if (totalTxns % 500 === 0) {
          console.log(`Processed ${totalTxns} transactions...`);
          console.log(`  Pool creations: ${poolCreations}`);
          console.log(`  Buy events: ${buyEvents}`);
          console.log(`  Sell events: ${sellEvents}\n`);
        }
      }
    });
    
    stream.on('error', (error: any) => {
      console.error('Stream error:', error.message || error);
      cleanup();
      process.exit(1);
    });
    
    // Subscribe to AMM transactions
    const request = {
      accounts: {},
      slots: {},
      transactions: {
        pumpAmm: {
          vote: false,
          failed: false,
          accountInclude: [PUMP_AMM_PROGRAM_ID],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED
    };
    
    await new Promise((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Subscribed to AMM transactions\n');
          console.log('Monitoring for create_pool instructions...\n');
          resolve(true);
        }
      });
    });
    
    // Run for 5 minutes
    setTimeout(async () => {
      console.log('\n⏱️  Monitoring complete');
      console.log(`Total transactions: ${totalTxns}`);
      console.log(`Pool creations (graduations): ${poolCreations}`);
      console.log(`Buy events: ${buyEvents}`);
      console.log(`Sell events: ${sellEvents}`);
      
      // Check database for graduated tokens
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM tokens_unified
        WHERE graduated_to_amm = true
      `);
      
      console.log(`\nTokens marked as graduated in DB: ${result.rows[0].count}`);
      
      await cleanup();
      await pool.end();
      process.exit(0);
    }, 300000); // 5 minutes
    
  } catch (error) {
    console.error('Error:', error);
    await cleanup();
    if (pool) await pool.end();
    process.exit(1);
  }
}

monitorPoolCreation().catch(console.error);