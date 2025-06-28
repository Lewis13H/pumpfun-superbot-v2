import bs58 from 'bs58';

export interface AmmSwapEvent {
  type: 'Buy' | 'Sell';
  programId: string;
  user: string;
  tokenMint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  signature: string;
  slot: bigint;
  timestamp: Date;
  instructionName: string;
  poolAccount?: string;
}


// Buy instruction discriminator from IDL
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
// Sell instruction discriminator from IDL
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

export class AmmSwapParser {
  parseTransaction(txInfo: any, signature: string, slot: string, blockTime: string): AmmSwapEvent | null {
    try {
      // txInfo contains the transaction data - handle different structures
      let tx = txInfo.transaction || txInfo;
      
      // If we have nested transaction structure (from gRPC stream)
      if (tx.transaction) {
        tx = tx.transaction;
      }
      
      // Get transaction details
      const message = tx.message || tx.getMessage?.();
      if (!message) {
        // Don't log for every transaction, it's too noisy
        return null;
      }

      // Meta might be at different levels depending on structure
      const meta = txInfo.transaction?.meta || txInfo.meta || tx.meta || txInfo.getMeta?.() || tx.getMeta?.();
      if (!meta || (meta.err || meta.getErr?.())) {
        return null;
      }

      const instructions = message.instructions || message.getInstructionsList?.();
      if (!instructions) {
        return null;
      }

      const accountKeys = message.accountKeys || message.getAccountKeysList?.();
      if (!accountKeys) {
        return null;
      }

      // console.log(`      Found ${instructions.length} instructions to check`);

      // Find pump AMM instruction
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programIdIndex = ix.programIdIndex || ix.getProgramIdIndex?.();
        const programKey = accountKeys[programIdIndex];
        const programIdStr = typeof programKey === 'string' 
          ? programKey 
          : bs58.encode(programKey as unknown as Uint8Array);

        // Check if this is a pump AMM instruction
        if (programIdStr !== 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') continue;

        const ixData = (ix.data || ix.getData?.()) as unknown as Uint8Array;
        if (!ixData || ixData.length < 8) continue;

        // Check discriminator
        const discriminator = Buffer.from(ixData.slice(0, 8));
        let isBuy = false;
        let instructionName = '';

        if (discriminator.equals(BUY_DISCRIMINATOR)) {
          isBuy = true;
          instructionName = 'buy';
        } else if (discriminator.equals(SELL_DISCRIMINATOR)) {
          isBuy = false;
          instructionName = 'sell';
        } else {
          continue;
        }

        // Extract accounts
        const accountIndexesRaw = ix.accounts || ix.getAccountsList?.();
        if (!accountIndexesRaw || accountIndexesRaw.length < 6) continue;

        // Convert Buffer to array of numbers if needed
        let accountIndexes: number[];
        if (Buffer.isBuffer(accountIndexesRaw)) {
          accountIndexes = Array.from(accountIndexesRaw);
        } else if (Array.isArray(accountIndexesRaw)) {
          accountIndexes = accountIndexesRaw;
        } else {
          continue;
        }

        // The accountIndexes are indices into the accountKeys array
        const accounts = accountIndexes.map((idx: number) => {
          if (idx >= accountKeys.length) {
            console.log(`      Warning: account index ${idx} out of bounds (${accountKeys.length} keys)`);
            return null;
          }
          const accountKey = accountKeys[idx];
          return typeof accountKey === 'string' 
            ? accountKey 
            : bs58.encode(accountKey as unknown as Uint8Array);
        });
        

        // Account layout for pump AMM:
        // 0: pool
        // 1: user (signer)
        // 2: user_quote_token_account (user's SOL or token account)
        // 3: pool_quote_token_account (pool's SOL account)
        // 4: pool_base_token_account (pool's token account)
        // 5: base_mint (token mint)
        // 6: quote_mint (SOL mint usually)

        const poolAccount = accounts[0] || 'Unknown';
        const user = accounts[1] || 'Unknown';
        const tokenMint = accounts[5] || 'Unknown'; // base mint (the token being traded)
        
        // Additional check - if we have more accounts, try different positions
        if (user === null || user === 'Unknown') {
          // Try to find the signer (user) in the accounts
          for (let k = 0; k < Math.min(accounts.length, 10); k++) {
            if (accounts[k] && accounts[k] !== null && accounts[k] !== '11111111111111111111111111111111') {
              console.log(`      Checking if account[${k}] could be user: ${accounts[k]}`);
            }
          }
        }

        // Parse amounts from instruction data or logs
        let solAmount = BigInt(0);
        let tokenAmount = BigInt(0);

        // Look in inner instructions for token transfers
        if (meta.innerInstructions || meta.getInnerInstructionsList?.()) {
          const innerIxs = meta.innerInstructions || meta.getInnerInstructionsList?.();
          
          // Find the inner instructions for this instruction index
          const thisInnerIxs = innerIxs.find((inner: any) => 
            inner.index === i || inner.getIndex?.() === i
          );
          
          if (thisInnerIxs) {
            const innerInstructions = thisInnerIxs.instructions || thisInnerIxs.getInstructionsList?.();
            
            // Track transfers to determine amounts
            const transfers: { amount: bigint, isSOL: boolean }[] = [];
            
            // Look for token transfers
            for (const innerIx of innerInstructions || []) {
              const innerProgramIdIndex = innerIx.programIdIndex || innerIx.getProgramIdIndex?.();
              const innerProgramKey = accountKeys[innerProgramIdIndex];
              const innerProgramId = typeof innerProgramKey === 'string' 
                ? innerProgramKey 
                : bs58.encode(innerProgramKey as unknown as Uint8Array);
              
              // Token program transfers
              if (innerProgramId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
                  innerProgramId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
                const innerData = (innerIx.data || innerIx.getData?.()) as unknown as Uint8Array;
                
                // Token transfer instruction (3 = transfer, 12 = transferChecked)
                if (innerData && innerData.length >= 9 && (innerData[0] === 3 || innerData[0] === 12)) {
                  let amount: bigint;
                  
                  if (innerData[0] === 3) {
                    // Regular transfer: amount at byte 1-9
                    amount = Buffer.from(innerData.slice(1, 9)).readBigUInt64LE();
                  } else {
                    // TransferChecked: amount at byte 1-9, decimals at byte 9
                    amount = Buffer.from(innerData.slice(1, 9)).readBigUInt64LE();
                  }
                  
                  // Get the destination account to determine if it's SOL or token
                  const innerAccounts = innerIx.accounts || innerIx.getAccountsList?.();
                  if (innerAccounts && innerAccounts.length >= 2) {
                    
                    // Check if this is a native SOL transfer (wrapped SOL)
                    // Native SOL transfers typically have smaller amounts (in lamports)
                    // Token transfers have larger amounts due to 6 decimal places
                    const isSOL = amount < BigInt(10000000000); // Less than 10 SOL worth of lamports
                    
                    transfers.push({ amount, isSOL });
                  }
                }
              }
            }
            
            // Analyze transfers to determine swap amounts
            if (transfers.length >= 2) {
              // For a swap, we expect at least 2 transfers
              // Sort by amount to help identify which is which
              transfers.sort((a, b) => Number(a.amount - b.amount));
              
              // Usually the smaller amount is SOL (in lamports)
              // and the larger amount is tokens (with 6 decimals)
              for (const transfer of transfers) {
                if (transfer.isSOL && solAmount === BigInt(0)) {
                  solAmount = transfer.amount;
                } else if (!transfer.isSOL && tokenAmount === BigInt(0)) {
                  tokenAmount = transfer.amount;
                }
              }
              
              // If we still don't have both amounts, use heuristics
              if (solAmount === BigInt(0) || tokenAmount === BigInt(0)) {
                for (const transfer of transfers) {
                  if (transfer.amount < BigInt(10000000000) && solAmount === BigInt(0)) {
                    solAmount = transfer.amount;
                  } else if (transfer.amount >= BigInt(10000000000) && tokenAmount === BigInt(0)) {
                    tokenAmount = transfer.amount;
                  }
                }
              }
            }
          }
        }

        // Fallback: parse from logs
        if (solAmount === BigInt(0) && tokenAmount === BigInt(0)) {
          const logs = meta.logMessages || meta.getLogMessagesList?.() || [];
          for (const log of logs) {
            if (log.includes('Transfer') && log.includes('amount:')) {
              const amountMatch = log.match(/amount:\s*(\d+)/);
              if (amountMatch) {
                const amount = BigInt(amountMatch[1]);
                if (amount > BigInt(1000000000)) {
                  tokenAmount = amount;
                } else {
                  solAmount = amount;
                }
              }
            }
          }
        }

        
        return {
          type: isBuy ? 'Buy' : 'Sell',
          programId: programIdStr,
          user,
          tokenMint,
          solAmount,
          tokenAmount,
          signature,
          slot: BigInt(slot),
          timestamp: new Date(Number(blockTime) * 1000),
          instructionName,
          poolAccount,
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing AMM swap:', error);
      return null;
    }
  }
}