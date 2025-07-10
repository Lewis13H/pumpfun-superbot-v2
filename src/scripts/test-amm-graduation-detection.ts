/**
 * Test AMM Graduation Detection
 * Runs the system briefly to detect and mark graduated tokens
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import { Pool } from 'pg';

async function checkGraduatedTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_program
      FROM tokens_unified
    `);
    
    const stats = result.rows[0];
    console.log(`\n📊 Token Stats:`);
    console.log(`Total: ${stats.total}`);
    console.log(`Graduated: ${stats.graduated} (${(stats.graduated / stats.total * 100).toFixed(1)}%)`);
    console.log(`AMM Program: ${stats.amm_program}`);
    
    // Get recent graduations
    const recent = await pool.query(`
      SELECT mint_address, symbol, name, updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    
    if (recent.rows.length > 0) {
      console.log('\nRecent Graduations:');
      recent.rows.forEach((token, i) => {
        console.log(`${i + 1}. ${token.symbol || 'N/A'} - ${token.mint_address.slice(0, 8)}... (${token.updated_at.toISOString()})`);
      });
    }
    
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Starting monitor to detect AMM graduations...\n');
  console.log('⏱️  Will run for 2 minutes to detect graduated tokens\n');
  
  // Check initial state
  console.log('Initial state:');
  await checkGraduatedTokens();
  
  // Start the monitor
  const monitor = spawn('npm', ['run', 'start'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let graduationCount = 0;
  
  // Capture output
  monitor.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Look for graduation detection logs
    if (output.includes('Token graduation to AMM detected')) {
      graduationCount++;
      const lines = output.split('\n');
      lines.forEach(line => {
        if (line.includes('Token graduation')) {
          console.log(`\n🎓 ${line.trim()}`);
        }
      });
    }
    
    // Also log AMM trades to show parsing is working
    if (output.includes('AMM trade')) {
      const match = output.match(/AMM trade.*mint: ([A-Za-z0-9]+)/);
      if (match) {
        console.log(`  📈 AMM trade detected: ${match[1].slice(0, 8)}...`);
      }
    }
  });
  
  monitor.stderr.on('data', (data) => {
    const error = data.toString();
    if (!error.includes('DeprecationWarning') && !error.includes('punycode')) {
      console.error('Error:', error);
    }
  });
  
  // Run for 2 minutes
  setTimeout(async () => {
    console.log('\n\n⏹️  Stopping monitor...\n');
    monitor.kill();
    
    // Check final state
    console.log('Final state:');
    await checkGraduatedTokens();
    
    console.log(`\n✅ Test complete! Detected ${graduationCount} graduations during this run.`);
    
    if (graduationCount > 0) {
      console.log('\n🎉 SUCCESS: Graduation detection is working!');
    } else {
      console.log('\n⚠️  No graduations detected during this run. This could be normal if no tokens graduated in this time window.');
      console.log('   Try running the monitor for longer or during more active trading periods.');
    }
    
    process.exit(0);
  }, 120000); // 2 minutes
}

main().catch(console.error);