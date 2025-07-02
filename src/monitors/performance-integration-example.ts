/**
 * Example of how to integrate performance monitoring into any monitor
 * 
 * This file shows the key integration points for adding performance
 * monitoring to existing monitors.
 */

import { performanceMonitor } from '../services/performance-monitor';

// Example monitor class
export class ExampleMonitor {
  private monitorName = 'ExampleMonitor';

  // 1. Record when messages are received
  onMessageReceived(data: any) {
    const messageSize = JSON.stringify(data).length;
    performanceMonitor.recordMessage(this.monitorName, messageSize);
  }

  // 2. Record parse results
  async parseMessage(data: any) {
    const startTime = Date.now();
    
    try {
      // Your parsing logic here
      const result = await this.doActualParsing(data);
      
      // Record successful parse
      const parseTime = Date.now() - startTime;
      performanceMonitor.recordParse(this.monitorName, true, parseTime);
      
      return result;
    } catch (error) {
      // Record failed parse
      const parseTime = Date.now() - startTime;
      performanceMonitor.recordParse(this.monitorName, false, parseTime);
      
      // Record error to dashboard
      performanceMonitor.recordError(this.monitorName, error as Error);
      
      throw error;
    }
  }

  // 3. Record reconnection events
  onReconnect() {
    performanceMonitor.recordReconnect(this.monitorName);
  }

  // 4. Record stream lag (if available)
  onSlotUpdate(currentSlot: number, latestSlot: number) {
    const lag = (latestSlot - currentSlot) * 400; // Assume 400ms per slot
    performanceMonitor.recordStreamLag(this.monitorName, lag);
  }

  // 5. Record warnings (non-critical errors)
  onWarning(message: string, details?: any) {
    const warning = new Error(message);
    (warning as any).details = details;
    performanceMonitor.recordError(this.monitorName, warning, 'warn');
  }

  private async doActualParsing(data: any): Promise<any> {
    // Actual parsing logic would go here
    return data;
  }
}

// Integration checklist:
// 
// 1. Import performance monitor:
//    import { performanceMonitor } from '../services/performance-monitor';
//
// 2. Add to message processing:
//    - Call recordMessage() when receiving data
//    - Call recordParse() after parsing (with success flag and latency)
//
// 3. Add to error handling:
//    - Call recordError() for any errors you want to track
//
// 4. Add to connection handling:
//    - Call recordReconnect() when reconnecting
//
// 5. Optional enhancements:
//    - Call recordStreamLag() if you can calculate lag
//    - Use different error levels ('error', 'warn', 'info')
//
// The performance monitor will automatically:
// - Track system metrics (CPU, memory)
// - Calculate health scores
// - Generate alerts based on thresholds
// - Broadcast updates to the dashboard