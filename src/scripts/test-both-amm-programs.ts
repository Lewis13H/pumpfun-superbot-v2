import Client from '@triton-one/yellowstone-grpc';

const CURRENT_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const ALTERNATIVE_AMM_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu';

async function testBothPrograms() {
  console.log('🔍 Testing Both AMM Program IDs...\n');

  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.shyft.to',
    process.env.SHYFT_GRPC_TOKEN,
    {}
  );

  try {
    // Test current program ID
    console.log(`📡 Testing current program: ${CURRENT_AMM_PROGRAM}`);
    
    // Subscribe to all transactions (no filter)
    const stream1 = await client.subscribe();
    let count1 = 0;
    
    stream1.on('data', (data: any) => {
      if (data.transaction) {
        count1++;
        console.log(`✅ Current program - Transaction #${count1} at slot ${data.transaction.slot}`);
      }
    });

    // Wait 15 seconds then test alternative
    setTimeout(async () => {
      console.log(`\n📡 Testing alternative program: ${ALTERNATIVE_AMM_PROGRAM}`);
      
      // Subscribe to all transactions (no filter)
      const stream2 = await client.subscribe();
      let count2 = 0;
      
      stream2.on('data', (data: any) => {
        if (data.transaction) {
          count2++;
          console.log(`✅ Alternative program - Transaction #${count2} at slot ${data.transaction.slot}`);
        }
      });

      // Print results after 30 seconds total
      setTimeout(() => {
        console.log('\n📊 Results:');
        console.log(`Current program (${CURRENT_AMM_PROGRAM}): ${count1} transactions`);
        console.log(`Alternative program (${ALTERNATIVE_AMM_PROGRAM}): ${count2} transactions`);
        
        if (count1 === 0 && count2 > 0) {
          console.log('\n❗ The AMM program ID has changed! Update to use the alternative ID.');
        } else if (count1 > 0 && count2 === 0) {
          console.log('\n✅ Current program ID is correct.');
        } else if (count1 === 0 && count2 === 0) {
          console.log('\n❌ No transactions received for either program. Check Shyft connection.');
        }
        
        process.exit(0);
      }, 15000);
    }, 15000);

  } catch (error) {
    console.error('Subscription error:', error);
    process.exit(1);
  }
}

testBothPrograms().catch(console.error);