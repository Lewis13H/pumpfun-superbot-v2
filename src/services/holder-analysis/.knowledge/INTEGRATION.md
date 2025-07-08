# Holder Analysis Integration

## Overview
The holder analysis system is fully integrated into the main application, providing automatic analysis for high-value tokens.

## Integration Points

### 1. Main Application (index.ts)
- HolderAnalysisIntegration starts automatically with the main app
- Integrated into the system statistics display
- Graceful shutdown handling

### 2. Event Bus Integration
The system listens to these events:
- **TOKEN_DISCOVERED**: Analyzes new tokens meeting thresholds
- **TOKEN_GRADUATED**: High-priority analysis for graduated tokens
- **PRICE_UPDATE**: Monitors for tokens crossing market cap thresholds

### 3. Thresholds
Default thresholds for automatic analysis:
- Market Cap USD: $18,888
- Market Cap SOL: 125 SOL

### 4. Statistics Display
Added to main dashboard stats:
- Analyses completed count
- Current queue size
- Average holder score across all analyzed tokens

### 5. Configuration
```typescript
{
  marketCapThreshold: 18888,
  solThreshold: 125,
  enableAutoAnalysis: true,
  maxConcurrentAnalyses: 3,
  analysisIntervalHours: 6
}
```

### 6. Scheduled Jobs
- **Top tokens analysis**: Every 6 hours for top 20 tokens
- **Poor scores re-analysis**: Every 12 hours for tokens with score < 150

### 7. Priority System
- **critical**: Graduated tokens
- **high**: Token discoveries, top tokens
- **normal**: Price threshold crossings
- **low**: Re-analysis of poor scores

## Dashboard Integration

### Main Dashboard Changes
- Added 4th row showing holder analysis stats
- Updated stats display to 8 lines (was 7)
- Shows real-time queue size and average score

### Token Detail Page
Enhanced token detail page (`token-detail-enhanced.html`) includes:
- Holders tab with full analysis
- Score badge and distribution charts
- Wallet classifications table
- Real-time analysis status

## Performance Considerations

### Resource Usage
- Max 3 concurrent analyses by default
- API rate limiting handled internally
- Caches analysis results to prevent duplicates

### Database Load
- Batch queries for existing tokens on startup
- Efficient snapshot storage with change detection
- Indexed queries for performance

## Monitoring

### Events Emitted
- `analysis:queued`: When analysis is added to queue
- `analysis:completed`: When analysis finishes successfully
- `analysis:failed`: When analysis encounters error

### Health Monitoring
- Queue stats available via `getQueueStats()`
- Integration stats via `getStats()`
- Job monitor tracks performance metrics

## Testing

Test the integration:
```bash
npx tsx src/scripts/test-holder-analysis-integration.ts
```

This will:
1. Start the integration
2. Simulate token events
3. Monitor queue processing
4. Display statistics

## Troubleshooting

### Common Issues

1. **No analyses starting**
   - Check market cap thresholds
   - Verify enableAutoAnalysis is true
   - Check API keys are set

2. **Queue backing up**
   - Increase maxConcurrentAnalyses
   - Check for API rate limiting
   - Monitor failed job reasons

3. **Missing statistics**
   - Ensure event listeners are registered
   - Check database connectivity
   - Verify integration started successfully