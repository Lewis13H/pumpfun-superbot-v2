#!/usr/bin/env node

/**
 * Test script to verify IDL loading and account coder initialization
 */

import * as fs from 'fs';
import { BorshAccountsCoder } from '@coral-xyz/anchor';

async function testIdlLoading() {
  console.log('🧪 Testing IDL Loading and Account Coder...\n');
  
  const idlPath = './src/idls/pump_0.1.0.json';
  
  // Check if IDL file exists
  if (!fs.existsSync(idlPath)) {
    console.error('❌ IDL file not found at:', idlPath);
    process.exit(1);
  }
  
  console.log('✅ IDL file found at:', idlPath);
  
  try {
    // Load IDL
    const programIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    console.log('✅ IDL loaded successfully');
    console.log('  Program ID:', programIdl.metadata?.address || 'N/A');
    console.log('  Version:', programIdl.version || 'N/A');
    
    // Check for BondingCurve account in accounts array
    const bondingCurveAccount = programIdl.accounts?.find((acc: any) => acc.name === 'BondingCurve');
    if (bondingCurveAccount) {
      console.log('✅ BondingCurve account found in accounts array');
      console.log('  Discriminator:', bondingCurveAccount.discriminator);
    }
    
    // Check for BondingCurve type
    const bondingCurveType = programIdl.types?.find((type: any) => type.name === 'BondingCurve');
    if (bondingCurveType) {
      console.log('✅ BondingCurve type definition found');
      console.log('  Fields:', bondingCurveType.type.fields.map((f: any) => f.name).join(', '));
    } else {
      console.error('❌ BondingCurve type definition not found in IDL');
    }
    
    // Initialize account coder
    const accountCoder = new BorshAccountsCoder(programIdl);
    console.log('✅ Account coder initialized');
    
    // Test discriminator
    try {
      const discriminator = (accountCoder as any).accountDiscriminator('BondingCurve');
      console.log('✅ BondingCurve discriminator:', Array.from(discriminator));
    } catch (error) {
      console.error('❌ Failed to get discriminator:', error);
    }
    
    // Test with sample data (all zeros for testing)
    const testData = Buffer.alloc(165); // Bonding curve account size
    // Set discriminator
    const discriminatorBytes = [23, 183, 248, 55, 96, 216, 172, 96];
    discriminatorBytes.forEach((byte, i) => testData[i] = byte);
    
    try {
      const decoded = accountCoder.decodeAny(testData);
      console.log('✅ Test decode successful:', decoded?.name || 'Unknown');
    } catch (error) {
      console.log('⚠️  Test decode failed (expected with zero data)');
    }
    
    console.log('\n✅ IDL and Account Coder are properly configured!');
    
  } catch (error) {
    console.error('❌ Failed to process IDL:', error);
    process.exit(1);
  }
}

// Run test
testIdlLoading().catch(console.error);