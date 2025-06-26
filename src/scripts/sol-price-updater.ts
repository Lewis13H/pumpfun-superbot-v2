import { SolPriceUpdater } from '../services/sol-price-updater';

async function main() {
  console.log('🚀 Starting SOL Price Updater Service');
  
  const updater = SolPriceUpdater.getInstance();
  
  try {
    await updater.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down SOL price updater...');
      updater.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n🛑 Shutting down SOL price updater...');
      updater.stop();
      process.exit(0);
    });
    
    // Clean up old prices every hour
    setInterval(async () => {
      try {
        await updater.cleanup();
        console.log('🧹 Cleaned up old price data');
      } catch (error) {
        console.error('Error cleaning up prices:', error);
      }
    }, 3600000); // 1 hour
    
    // Keep the process running
    console.log('✅ SOL price updater is running');
    console.log('📊 Press Ctrl+C to stop');
    
  } catch (error) {
    console.error('❌ Failed to start price updater:', error);
    process.exit(1);
  }
}

main();