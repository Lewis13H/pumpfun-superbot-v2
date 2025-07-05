import Client from '@triton-one/yellowstone-grpc';

const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP_SWAP_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu'; // Alternative ID mentioned

async function testAMMSubscription() {
  console.log('🔍 Testing AMM Subscription...\n');

  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.shyft.to',
    process.env.SHYFT_GRPC_TOKEN,
    {}
  );

  try {
    // Test subscription to pump.swap AMM
    console.log(`📡 Subscribing to pump.swap AMM: ${PUMP_AMM_PROGRAM}`);
    
    // Subscribe to all transactions (no filter)
    const stream = await client.subscribe();
    
    console.log('✅ Subscription established, waiting for transactions...\n');
    
    let transactionCount = 0;
    const startTime = Date.now();

    stream.on('data', (data: any) => {
      if (data.transaction) {
        transactionCount++;
        const tx = data.transaction.transaction;
        const slot = data.transaction.slot;
        const signature = tx.signature;
        
        console.log(`📦 Transaction #${transactionCount}`);
        console.log(`   Signature: ${signature.slice(0, 20)}...`);
        console.log(`   Slot: ${slot}`);
        console.log(`   Accounts: ${tx.transaction.message.accountKeys?.length || 0}`);
        
        // Check if this is really an AMM transaction
        const hasAmmProgram = tx.transaction.message.accountKeys?.some(
          (key: any) => key.toString() === PUMP_AMM_PROGRAM
        );
        console.log(`   Has AMM Program: ${hasAmmProgram}`);
        console.log('');
      }
    });

    // Also test the alternative program ID
    setTimeout(async () => {
      console.log(`\n📡 Also testing alternative ID: ${PUMP_SWAP_PROGRAM}`);
      
      // Subscribe to all transactions (no filter)
      const stream2 = await client.subscribe();
      
      stream2.on('data', (data: any) => {
        if (data.transaction) {
          console.log(`📦 Transaction from alternative ID!`);
          console.log(`   Signature: ${data.transaction.transaction.signature.slice(0, 20)}...`);
        }
      });
    }, 5000);

    // Run for 30 seconds
    setTimeout(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log('\n📊 Test Results:');
      console.log(`   Duration: ${elapsed.toFixed(1)}s`);
      console.log(`   Transactions received: ${transactionCount}`);
      console.log(`   TPS: ${(transactionCount / elapsed).toFixed(2)}`);
      
      if (transactionCount === 0) {
        console.log('\n❌ No transactions received!');
        console.log('Possible issues:');
        console.log('1. Program ID might be wrong');
        console.log('2. No AMM activity during test period');
        console.log('3. Subscription filter not working');
        console.log('4. Shyft gRPC issues');
      }
      
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error('Subscription error:', error);
    process.exit(1);
  }
}

testAMMSubscription().catch(console.error);