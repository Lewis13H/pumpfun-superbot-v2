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

// Simple transaction interface to avoid import issues
interface SimpleTransaction {
  getTransaction: () => any;
  getSignature: () => Uint8Array;
  getSlot: () => string;
  getBlockTime: () => string;
}

// Buy instruction discriminator from IDL
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
// Sell instruction discriminator from IDL
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

export class SimpleAmmEventParser {
  /**
   * Parse AMM swap events without using BorshCoder
   * This avoids the IDL parsing issues
   */
  parseTransaction(transaction: SimpleTransaction): AmmSwapEvent | null {
    try {
      const tx = transaction.getTransaction();
      if (!tx) return null;

      // Handle direct transaction format (not wrapped)
      const meta = tx.meta || tx.getMeta?.();
      if (!meta || (meta.err || meta.getErr?.())) return null;

      const message = tx.message || tx.getMessage?.();
      if (!message) return null;

      const instructions = message.instructions || message.getInstructionsList?.();
      if (!instructions) return null;

      const accountKeys = message.accountKeys || message.getAccountKeysList?.();
      if (!accountKeys) return null;

      // Find pump AMM instruction
      for (const ix of instructions) {
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
        const accountIndexes = ix.accounts || ix.getAccountsList?.();
        if (!accountIndexes || accountIndexes.length < 4) continue;

        const accounts = accountIndexes.map((idx: number) => {
          const accountKey = accountKeys[idx];
          return typeof accountKey === 'string' 
            ? accountKey 
            : bs58.encode(accountKey as unknown as Uint8Array);
        });

        // Account layout for both buy and sell:
        // 0: pool
        // 1: user (signer)
        // 2: user_token_account or user_sol_account
        // 3: pool_token_account or pool_sol_account
        // 4+: various other accounts

        const poolAccount = accounts[0];
        const user = accounts[1];

        // Parse instruction data
        // After discriminator (8 bytes), the data layout varies
        // For now, we'll extract what we can from logs
        let solAmount = BigInt(0);
        let tokenAmount = BigInt(0);
        let tokenMint = '';

        // Try to find token mint from accounts
        if (accounts.length > 5) {
          tokenMint = accounts[5]; // This might be the token mint
        }

        // Look for swap amounts in logs
        const logs = meta.logMessages || meta.getLogMessagesList?.() || [];
        for (const log of logs) {
          // Look for common log patterns
          if (log.includes('Transfer') && log.includes('amount:')) {
            const amountMatch = log.match(/amount:\s*(\d+)/);
            if (amountMatch) {
              const amount = BigInt(amountMatch[1]);
              // Heuristic: larger amounts are usually token amounts
              if (amount > BigInt(1000000000)) {
                tokenAmount = amount;
              } else {
                solAmount = amount;
              }
            }
          }
        }

        // If we couldn't parse amounts from logs, use defaults
        if (solAmount === BigInt(0) && tokenAmount === BigInt(0)) {
          // Try to decode basic amounts from instruction data
          if (ixData.length >= 16) {
            // Skip discriminator and try to read uint64 values
            try {
              const dataView = new DataView(ixData.buffer, ixData.byteOffset + 8);
              const amount1 = dataView.getBigUint64(0, true); // little-endian
              if (isBuy) {
                solAmount = amount1; // For buy, first amount is usually SOL
              } else {
                tokenAmount = amount1; // For sell, first amount is usually tokens
              }
            } catch (e) {
              // Ignore parsing errors
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
          signature: bs58.encode(transaction.getSignature()),
          slot: BigInt(transaction.getSlot()),
          timestamp: new Date(Number(transaction.getBlockTime()) * 1000),
          instructionName,
          poolAccount,
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing AMM transaction:', error);
      return null;
    }
  }
}