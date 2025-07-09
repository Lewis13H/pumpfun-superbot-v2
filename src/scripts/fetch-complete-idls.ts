/**
 * Fetch Complete IDLs Script
 * Fetches IDL files with complete event field definitions from various sources
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Program, Provider, AnchorProvider, Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as chalk from 'chalk';

// Program addresses
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_AMM_PROGRAM = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

interface FetchOptions {
  outputDir: string;
  rpcUrl: string;
  checkExisting: boolean;
}

class IDLFetcher {
  private connection: Connection;
  private provider: Provider;
  
  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    // Create a dummy provider for fetchIdl
    this.provider = new AnchorProvider(
      this.connection,
      {} as any, // Dummy wallet
      { commitment: 'confirmed' }
    );
  }
  
  /**
   * Fetch IDL from on-chain if published
   */
  async fetchFromChain(programId: string): Promise<Idl | null> {
    try {
      console.log(chalk.blue(`Fetching IDL from chain for ${programId}...`));
      const idl = await Program.fetchIdl(programId, this.provider);
      
      if (idl) {
        console.log(chalk.green('✅ Successfully fetched IDL from chain'));
        return idl;
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  IDL not found on-chain'));
    }
    return null;
  }
  
  /**
   * Fetch IDL from Anchor's registry
   */
  async fetchFromAnchorRegistry(programId: string): Promise<Idl | null> {
    try {
      console.log(chalk.blue(`Fetching IDL from Anchor registry...`));
      const response = await axios.get(
        `https://anchor.projectserum.com/api/v0/idls/${programId}`,
        { timeout: 10000 }
      );
      
      if (response.data && response.data.idl) {
        console.log(chalk.green('✅ Successfully fetched IDL from Anchor registry'));
        return response.data.idl;
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  IDL not found in Anchor registry'));
    }
    return null;
  }
  
  /**
   * Attempt to enhance existing IDL with event field definitions
   */
  enhanceIDLWithEventFields(idl: any): any {
    // If the IDL already has complete event definitions, return as is
    if (idl.events && idl.events.length > 0 && idl.events[0].fields) {
      return idl;
    }
    
    // Map known event discriminators to field definitions
    const eventFieldMap = {
      'CreateEvent': {
        fields: [
          { name: 'mint', type: 'publicKey' },
          { name: 'bondingCurve', type: 'publicKey' },
          { name: 'creator', type: 'publicKey' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'uri', type: 'string' },
          { name: 'decimals', type: 'u8' },
          { name: 'bondingCurveType', type: 'u8' }
        ]
      },
      'TradeEvent': {
        fields: [
          { name: 'mint', type: 'publicKey' },
          { name: 'trader', type: 'publicKey' },
          { name: 'tokenAmount', type: 'u64' },
          { name: 'solAmount', type: 'u64' },
          { name: 'isBuy', type: 'bool' },
          { name: 'virtualSolReserves', type: 'u64' },
          { name: 'virtualTokenReserves', type: 'u64' },
          { name: 'realSolReserves', type: 'u64' },
          { name: 'realTokenReserves', type: 'u64' },
          { name: 'bondingCurve', type: 'publicKey' }
        ]
      },
      'CompleteEvent': {
        fields: [
          { name: 'mint', type: 'publicKey' },
          { name: 'bondingCurve', type: 'publicKey' },
          { name: 'virtualSolReserves', type: 'u64' },
          { name: 'virtualTokenReserves', type: 'u64' },
          { name: 'realSolReserves', type: 'u64' },
          { name: 'realTokenReserves', type: 'u64' },
          { name: 'timestamp', type: 'i64' }
        ]
      },
      'SetParamsEvent': {
        fields: [
          { name: 'bondingCurve', type: 'publicKey' },
          { name: 'buyFeeBps', type: 'u16' },
          { name: 'sellFeeBps', type: 'u16' },
          { name: 'targetSol', type: 'u64' }
        ]
      }
    };
    
    // Enhance events with field definitions
    if (idl.events) {
      idl.events = idl.events.map((event: any) => {
        if (eventFieldMap[event.name] && !event.fields) {
          return {
            ...event,
            fields: eventFieldMap[event.name].fields
          };
        }
        return event;
      });
    }
    
    return idl;
  }
  
  /**
   * Validate IDL structure
   */
  validateIDL(idl: any): boolean {
    if (!idl) return false;
    
    // Check basic structure
    const hasName = idl.name || idl.metadata?.name;
    const hasVersion = idl.version || idl.metadata?.version;
    const hasInstructions = idl.instructions && idl.instructions.length > 0;
    
    // Check if events have field definitions
    let hasCompleteEvents = false;
    if (idl.events && idl.events.length > 0) {
      hasCompleteEvents = idl.events.every((event: any) => 
        event.fields && event.fields.length > 0
      );
    }
    
    console.log(chalk.cyan('\nIDL Validation:'));
    console.log(`  Name: ${hasName ? '✅' : '❌'} ${hasName || 'Missing'}`);
    console.log(`  Version: ${hasVersion ? '✅' : '❌'} ${hasVersion || 'Missing'}`);
    console.log(`  Instructions: ${hasInstructions ? '✅' : '❌'} ${idl.instructions?.length || 0} found`);
    console.log(`  Events: ${idl.events?.length || 0} found`);
    console.log(`  Complete Event Fields: ${hasCompleteEvents ? '✅' : '❌'}`);
    
    return hasName && hasVersion && hasInstructions;
  }
  
  /**
   * Save IDL to file
   */
  saveIDL(idl: any, programId: string, outputDir: string): void {
    const programName = programId === PUMP_FUN_PROGRAM ? 'pump_fun' : 'pump_amm';
    const filename = `${programName}_complete.json`;
    const filepath = path.join(outputDir, filename);
    
    // Add metadata if missing
    if (!idl.metadata) {
      idl.metadata = {
        name: programName,
        version: '0.1.0',
        spec: '0.1.0',
        description: `Complete IDL for ${programName} program`,
        address: programId,
        updatedAt: new Date().toISOString()
      };
    }
    
    fs.writeFileSync(filepath, JSON.stringify(idl, null, 2));
    console.log(chalk.green(`✅ Saved IDL to ${filepath}`));
  }
}

async function main() {
  const options: FetchOptions = {
    outputDir: path.join(process.cwd(), 'src', 'idls'),
    rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    checkExisting: true
  };
  
  console.log(chalk.bold.cyan('\n🚀 Fetching Complete IDLs\n'));
  
  const fetcher = new IDLFetcher(options.rpcUrl);
  const programs = [
    { id: PUMP_FUN_PROGRAM, name: 'Pump.fun' },
    { id: PUMP_AMM_PROGRAM, name: 'Pump AMM' }
  ];
  
  for (const program of programs) {
    console.log(chalk.bold(`\n📋 Processing ${program.name} (${program.id})\n`));
    
    // Check existing IDL
    if (options.checkExisting) {
      const existingPath = path.join(options.outputDir, `${program.name.toLowerCase().replace('.', '_')}_complete.json`);
      if (fs.existsSync(existingPath)) {
        console.log(chalk.yellow('ℹ️  Existing IDL found, checking for completeness...'));
        const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
        if (fetcher.validateIDL(existing)) {
          console.log(chalk.green('✅ Existing IDL is valid and complete'));
          continue;
        }
      }
    }
    
    // Try fetching from multiple sources
    let idl = null;
    
    // 1. Try on-chain
    idl = await fetcher.fetchFromChain(program.id);
    
    // 2. Try Anchor registry
    if (!idl) {
      idl = await fetcher.fetchFromAnchorRegistry(program.id);
    }
    
    // 3. Try loading and enhancing existing
    if (!idl) {
      console.log(chalk.blue('Attempting to enhance existing IDL...'));
      const existingFiles = fs.readdirSync(options.outputDir)
        .filter(f => f.includes(program.name.toLowerCase().replace('.', '_')));
      
      for (const file of existingFiles) {
        try {
          const existing = JSON.parse(fs.readFileSync(path.join(options.outputDir, file), 'utf-8'));
          idl = fetcher.enhanceIDLWithEventFields(existing);
          if (idl) {
            console.log(chalk.green('✅ Enhanced existing IDL with event fields'));
            break;
          }
        } catch (error) {
          // Continue to next file
        }
      }
    }
    
    // Validate and save
    if (idl) {
      if (fetcher.validateIDL(idl)) {
        fetcher.saveIDL(idl, program.id, options.outputDir);
      } else {
        console.log(chalk.red('❌ IDL validation failed'));
      }
    } else {
      console.log(chalk.red('❌ Could not fetch or create complete IDL'));
    }
  }
  
  console.log(chalk.bold.cyan('\n📚 Additional Resources:\n'));
  console.log('1. Solscan: https://solscan.io/account/' + PUMP_FUN_PROGRAM);
  console.log('2. SolanaFM: https://solana.fm/address/' + PUMP_FUN_PROGRAM);
  console.log('3. GitHub: https://github.com/s6nqou/pump-anchor');
  console.log('4. Anchor Docs: https://www.anchor-lang.com/docs/idl');
}

main().catch(console.error);