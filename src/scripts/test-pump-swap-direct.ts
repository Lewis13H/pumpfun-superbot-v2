import Client from '@triton-one/yellowstone-grpc';

async function testPumpSwap() {
  console.log('🔍 Testing pump.swap AMM subscription...\n');

  // const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
  
  const endpoint = process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.us.shyft.to';
  console.log(`Using endpoint: ${endpoint}`);

  const client = new Client(
    endpoint,
    process.env.SHYFT_GRPC_TOKEN,
    {}
  );

  try {
    console.log('Subscribing to pump.swap AMM...');
    // Subscribe to all transactions (no filter)
    const stream = await client.subscribe();
    
    let count = 0;
    let startTime = Date.now();
    
    stream.on('data', (data: any) => {
      if (data.transaction) {
        count++;
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`✅ Transaction #${count} - Slot: ${data.transaction.slot} - TPS: ${(count/elapsed).toFixed(2)}`);
        
        if (count === 1) {
          // Log first transaction details
          const tx = data.transaction.transaction;
          console.log('First transaction details:', {
            signature: tx.signature?.slice(0, 20) + '...',
            accounts: tx.transaction?.message?.accountKeys?.length || 0
          });
        }
      }
    });

    stream.on('error', (error: any) => {
      console.error('Stream error:', error);
    });

    // Run for 30 seconds
    setTimeout(() => {
      console.log(`\n📊 Final: ${count} transactions in 30s = ${(count/30).toFixed(2)} TPS`);
      if (count === 0) {
        console.log('❌ No pump.swap AMM transactions received!');
        console.log('Possible issues:');
        console.log('1. pump.swap might not be active right now');
        console.log('2. Graduated tokens might be using Raydium instead');
        console.log('3. Network/subscription issues');
      }
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testPumpSwap().catch(console.error);