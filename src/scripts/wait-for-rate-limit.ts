/**
 * Wait for Shyft rate limit to clear
 * Shows countdown timer
 */

async function wait() {
  const waitTime = 5 * 60; // 5 minutes
  
  console.log('⏳ Waiting for Shyft rate limit to clear...\n');
  console.log('The rate limit error occurs when there are too many open connections.');
  console.log('This typically clears after 5-10 minutes.\n');
  
  for (let i = waitTime; i > 0; i--) {
    const minutes = Math.floor(i / 60);
    const seconds = i % 60;
    process.stdout.write(`\r⏱️  Time remaining: ${minutes}:${seconds.toString().padStart(2, '0')}  `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n\n✅ Rate limit should be cleared now!');
  console.log('\nYou can now run:');
  console.log('  npx tsx src/scripts/test-amm-parsing-quick.ts');
  console.log('  npx tsx src/scripts/check-graduated-tokens-simple.ts');
  console.log('  npm run start');
}

wait();