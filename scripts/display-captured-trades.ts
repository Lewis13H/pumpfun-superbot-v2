#!/usr/bin/env tsx
/**
 * Display Captured AMM Trades for Solscan Verification
 */

import chalk from 'chalk';

// Based on the logs, here are the trades we captured:
const trades = {
  sells: [
    {
      signature: "First SELL trade - check logs above",
      mintAddress: "xA8BXaEpPYzbfCNxVWdCQc3jJWN3QLvbAthtka3pump",
      note: "This was the first sell captured"
    },
    {
      signature: "Second SELL trade - check logs above", 
      mintAddress: "xA8BXaEpPYzbfCNxVWdCQc3jJWN3QLvbAthtka3pump",
      note: "This was the second sell captured"
    }
  ],
  buys: [
    {
      signature: "First BUY trade - check logs above",
      mintAddress: "xA8BXaEpPYzbfCNxVWdCQc3jJWN3QLvbAthtka3pump",
      note: "This was the first buy captured"
    },
    {
      signature: "Second BUY trade - check logs above",
      mintAddress: "xA8BXaEpPYzbfCNxVWdCQc3jJWN3QLvbAthtka3pump", 
      note: "This was the second buy captured"
    }
  ]
};

console.log(chalk.cyan('\n=== AMM TRADES CAPTURED FOR VERIFICATION ===\n'));

console.log(chalk.yellow('From the logs, we captured trades for token:'));
console.log('Mint Address: xA8BXaEpPYzbfCNxVWdCQc3jJWN3QLvbAthtka3pump');
console.log('\nThis token was just graduating to AMM during our test, which is why we see:');
console.log('- "Creating new AMM token" messages');
console.log('- "Token graduated" messages');
console.log('- "Token crossed $8888 threshold" messages\n');

console.log(chalk.red('To get the exact trade signatures, we need to:'));
console.log('1. Check the database for recent AMM trades');
console.log('2. Or re-run the monitor with better logging\n');

console.log('Let me query the database for the exact trades...\n');