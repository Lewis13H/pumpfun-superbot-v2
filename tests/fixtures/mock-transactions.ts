/**
 * Mock Transaction Fixtures
 * Provides realistic transaction data for testing
 */

import bs58 from 'bs58';
import { PUMP_PROGRAM, PUMP_SWAP_PROGRAM } from '../../src/utils/constants';

export interface MockTransaction {
  signature: string;
  slot: bigint;
  blockTime: number;
  meta: {
    err: any;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    logMessages: string[];
    preTokenBalances: any[];
    postTokenBalances: any[];
    innerInstructions: any[];
  };
  transaction: {
    message: {
      accountKeys: Buffer[];
      header: {
        numRequiredSignatures: number;
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
      };
      instructions: any[];
      recentBlockhash: string;
    };
  };
}

function createMockAccountKey(address: string): Buffer {
  try {
    return Buffer.from(bs58.decode(address));
  } catch {
    // If not valid base58, create a mock buffer
    return Buffer.from(address.padEnd(32, '0'));
  }
}

export const mockTransactions = {
  // BC Buy Transaction
  bcBuy: {
    signature: 'buyTx123456789',
    slot: 1000n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 2000000000, 3000000000],
      postBalances: [900000000, 2100000000, 3000000000],
      logMessages: [
        'Program pumpProgramId invoke [1]',
        'Program log: Instruction: Buy',
        'Program log: SOL amount: 1000000000',
        'Program log: Token amount: 5000000000',
        'Program log: Virtual SOL reserves: 30000000000',
        'Program log: Virtual token reserves: 150000000000000',
        'Program pumpProgramId consumed 50000 of 200000 compute units',
        'Program pumpProgramId success'
      ],
      preTokenBalances: [],
      postTokenBalances: [{
        accountIndex: 1,
        mint: 'tokenMint123',
        uiTokenAmount: {
          amount: '5000000000',
          decimals: 6,
          uiAmount: 5000
        }
      }],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('userWallet123'),
          createMockAccountKey('tokenAccount123'),
          createMockAccountKey('bondingCurve123'),
          createMockAccountKey(PUMP_PROGRAM)
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 3,
          accounts: [0, 1, 2],
          data: Buffer.from('buy_instruction_data')
        }],
        recentBlockhash: 'blockhash123'
      }
    }
  } as MockTransaction,

  // BC Sell Transaction
  bcSell: {
    signature: 'sellTx123456789',
    slot: 1001n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [900000000, 2100000000, 3000000000],
      postBalances: [950000000, 2050000000, 3000000000],
      logMessages: [
        'Program pumpProgramId invoke [1]',
        'Program log: Instruction: Sell',
        'Program log: SOL amount: 500000000',
        'Program log: Token amount: 2500000000',
        'Program log: Virtual SOL reserves: 29500000000',
        'Program log: Virtual token reserves: 152500000000000',
        'Program pumpProgramId success'
      ],
      preTokenBalances: [{
        accountIndex: 1,
        mint: 'tokenMint123',
        uiTokenAmount: {
          amount: '5000000000',
          decimals: 6,
          uiAmount: 5000
        }
      }],
      postTokenBalances: [{
        accountIndex: 1,
        mint: 'tokenMint123',
        uiTokenAmount: {
          amount: '2500000000',
          decimals: 6,
          uiAmount: 2500
        }
      }],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('userWallet123'),
          createMockAccountKey('tokenAccount123'),
          createMockAccountKey('bondingCurve123'),
          createMockAccountKey(PUMP_PROGRAM)
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 3,
          accounts: [0, 1, 2],
          data: Buffer.from('sell_instruction_data')
        }],
        recentBlockhash: 'blockhash124'
      }
    }
  } as MockTransaction,

  // AMM Swap Transaction
  ammSwap: {
    signature: 'swapTx123456789',
    slot: 2000n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 2000000000, 3000000000, 4000000000],
      postBalances: [900000000, 2000000000, 3100000000, 4000000000],
      logMessages: [
        'Program ammProgramId invoke [1]',
        'Program log: Instruction: Swap',
        'Program log: Amount in: 1000000000',
        'Program log: Minimum amount out: 4900000000',
        'Program log: Post swap base: 3100000000',
        'Program log: Post swap quote: 15100000000000',
        'Program ammProgramId success'
      ],
      preTokenBalances: [],
      postTokenBalances: [{
        accountIndex: 1,
        mint: 'tokenMint456',
        uiTokenAmount: {
          amount: '5000000000',
          decimals: 6,
          uiAmount: 5000
        }
      }],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('userWallet456'),
          createMockAccountKey('userTokenAccount456'),
          createMockAccountKey('poolAccount456'),
          createMockAccountKey('poolTokenAccount456'),
          createMockAccountKey(PUMP_SWAP_PROGRAM)
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 4,
          accounts: [0, 1, 2, 3],
          data: Buffer.from('swap_instruction_data')
        }],
        recentBlockhash: 'blockhash200'
      }
    }
  } as MockTransaction,

  // BC Buy with Bonding Curve Key
  bcBuyWithCurveKey: {
    ...({} as any), // Spread base transaction
    signature: 'buyWithCurve123',
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 2000000000, 3000000000],
      postBalances: [900000000, 2100000000, 3000000000],
      logMessages: [
        'Program pumpProgramId invoke [1]',
        'Program log: Instruction: Buy',
        'Program log: Bonding curve: bondingCurveKey789',
        'Program log: SOL amount: 1000000000',
        'Program log: Token amount: 5000000000',
        'Program log: Virtual SOL reserves: 30000000000',
        'Program log: Virtual token reserves: 150000000000000',
        'Program pumpProgramId success'
      ],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('userWallet123'),
          createMockAccountKey('bondingCurveKey789'),
          createMockAccountKey(PUMP_PROGRAM)
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 2,
          accounts: [0, 1],
          data: Buffer.from('buy_with_curve')
        }],
        recentBlockhash: 'blockhash125'
      }
    }
  } as MockTransaction,

  // Graduation Transaction
  graduationTransaction: {
    signature: 'graduationTx123',
    slot: 5000n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 2000000000, 85000000000],
      postBalances: [1000000000, 2000000000, 0],
      logMessages: [
        'Program pumpProgramId invoke [1]',
        'Program log: Instruction: Withdraw',
        'Program log: Bonding curve complete: true',
        'Program log: Migrating to AMM',
        'Program log: Token graduated: tokenMint123',
        'Program log: Migration authority: migrationAuth123',
        'Program pumpProgramId success'
      ],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('migrationAuth123'),
          createMockAccountKey('bondingCurve123'),
          createMockAccountKey('tokenMint123'),
          createMockAccountKey(PUMP_PROGRAM)
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 3,
          accounts: [0, 1, 2],
          data: Buffer.from('withdraw_for_migration')
        }],
        recentBlockhash: 'blockhash500'
      }
    }
  } as MockTransaction,

  // Transaction with no logs
  noLogs: {
    signature: 'noLogsTx123',
    slot: 1002n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000],
      postBalances: [999995000],
      logMessages: [],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [createMockAccountKey('userWallet123')],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 0
        },
        instructions: [],
        recentBlockhash: 'blockhash126'
      }
    }
  } as MockTransaction,

  // Invalid transaction
  invalidTransaction: null as any,

  // ComputeBudget transaction (should be ignored)
  computeBudgetTransaction: {
    signature: 'computeBudget123',
    slot: 1003n,
    blockTime: Date.now() / 1000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000],
      postBalances: [999995000],
      logMessages: [
        'Program ComputeBudget111111111111111111111111111111 invoke [1]',
        'Program ComputeBudget111111111111111111111111111111 success'
      ],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: []
    },
    transaction: {
      message: {
        accountKeys: [
          createMockAccountKey('userWallet123'),
          createMockAccountKey('ComputeBudget111111111111111111111111111111')
        ],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1
        },
        instructions: [{
          programIdIndex: 1,
          accounts: [],
          data: Buffer.from('compute_budget_data')
        }],
        recentBlockhash: 'blockhash127'
      }
    }
  } as MockTransaction
};

// Helper function to generate multiple transactions
export function generateMockTransactions(
  type: 'bc_buy' | 'bc_sell' | 'amm_swap',
  count: number,
  options?: {
    startSlot?: bigint;
    mintAddress?: string;
    userAddress?: string;
  }
): MockTransaction[] {
  const transactions: MockTransaction[] = [];
  const baseTransaction = type === 'bc_buy' ? mockTransactions.bcBuy :
                         type === 'bc_sell' ? mockTransactions.bcSell :
                         mockTransactions.ammSwap;

  for (let i = 0; i < count; i++) {
    const tx = JSON.parse(JSON.stringify(baseTransaction));
    tx.signature = `${type}_${i}_${Date.now()}`;
    tx.slot = (options?.startSlot || 1000n) + BigInt(i);
    tx.blockTime = Date.now() / 1000 + i;
    
    if (options?.mintAddress) {
      // Update mint address in logs and token balances
      tx.meta.logMessages = tx.meta.logMessages.map((log: string) =>
        log.replace(/tokenMint\d+/, options.mintAddress)
      );
    }
    
    transactions.push(tx);
  }
  
  return transactions;
}