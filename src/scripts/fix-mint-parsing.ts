import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Test if a string might be base64-encoded Program data
function testBase64Theory() {
  console.log('Testing if corrupted mints are actually base64 data...\n');
  
  const corruptedMints = [
    'Pi83CqUD3Cp5kV5oAAAAAB6tgCoAAAAAwFgaghoAAAAe',
    'RSHyz1d3d5kV5oAAAAAEoDAAAAAAAABtPwAAAAAAAAAA',
    '5oAAAAANJQd4YAAAAABFCySqgBAAAAAAAAAAAAANJKsZ'
  ];
  
  for (const mint of corruptedMints) {
    console.log(`\nTesting: ${mint}`);
    
    // Try as base64
    try {
      const base64Decoded = Buffer.from(mint, 'base64');
      console.log(`Base64 decode successful: ${base64Decoded.length} bytes`);
      
      if (base64Decoded.length >= 40) {
        // Try to extract mint at offset 8
        const discriminator = base64Decoded.slice(0, 8);
        const mintBytes = base64Decoded.slice(8, 40);
        
        console.log(`Discriminator: ${discriminator.toString('hex')}`);
        console.log(`Mint bytes: ${mintBytes.toString('hex')}`);
        
        try {
          const extractedMint = new PublicKey(mintBytes);
          console.log(`Extracted mint: ${extractedMint.toString()}`);
          
          // Check if it ends with 'pump'
          if (extractedMint.toString().endsWith('pump')) {
            console.log('✓ Valid pump.fun mint extracted!');
          }
        } catch (e) {
          console.log('✗ Failed to create valid PublicKey');
        }
      }
    } catch (e) {
      console.log('✗ Not valid base64');
    }
    
    // Also try as base58
    try {
      const base58Decoded = bs58.decode(mint);
      console.log(`Base58 decode: ${base58Decoded.length} bytes`);
    } catch (e) {
      console.log('✗ Not valid base58');
    }
  }
}

// Show the fix for the parser
function showParserFix() {
  console.log('\n\nSUGGESTED FIX FOR PARSER:\n');
  console.log(`
The issue appears to be that in some cases, the mint address itself is being 
saved instead of being extracted from Program data.

In unified-parser.ts, the detectAmmTradeFromLogs function is extracting 
addresses directly from logs using regex, but some of these "addresses" are 
actually base64-encoded Program data.

The fix would be:

1. In detectAmmTradeFromLogs, validate extracted addresses:
   - Check if they decode to exactly 32 bytes
   - Optionally check if they end with 'pump' for pump.fun tokens

2. Add validation before saving to database:
   
   function isValidSolanaAddress(address: string): boolean {
     try {
       const decoded = bs58.decode(address);
       return decoded.length === 32;
     } catch {
       return false;
     }
   }

3. If an extracted "address" is actually base64 Program data, parse it properly:
   
   if (!isValidSolanaAddress(candidateMint) && candidateMint.length > 40) {
     // Might be base64 Program data
     try {
       const data = Buffer.from(candidateMint, 'base64');
       if (data.length >= 40) {
         const mint = new PublicKey(data.slice(8, 40)).toString();
         if (isValidSolanaAddress(mint)) {
           candidateMint = mint;
         }
       }
     } catch {
       // Skip this candidate
     }
   }
`);
}

testBase64Theory();
showParserFix();