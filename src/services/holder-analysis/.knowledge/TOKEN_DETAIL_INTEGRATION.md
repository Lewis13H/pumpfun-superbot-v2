# Token Detail Page Integration

## Overview
Session 6 implements a comprehensive redesign of the token detail page to include holder analytics as a dedicated tab.

## Architecture

### Frontend Components
1. **Tab Navigation System**
   - Overview, Holders, Price Chart, Transactions, Pool Info
   - Lazy loading for performance
   - Active state management

2. **Holder Analytics Tab**
   - Score Badge with visual progress bar
   - Score Breakdown showing all factors
   - Distribution Chart (doughnut)
   - Key Metrics Grid
   - Classifications Table
   - Growth Chart
   - Top Holders Table

### API Integration
```javascript
// Fetch holder analysis
GET /api/holder-analysis/:mintAddress

// Queue new analysis
POST /api/holder-analysis/analyze
{
  "mintAddress": "...",
  "priority": "high"
}

// Monitor job progress
GET /api/holder-analysis/jobs/:jobId
```

### WebSocket Events
```javascript
// Subscribe to updates
ws.send({
  type: 'subscribe',
  channel: 'token_analysis',
  mintAddress: 'token123'
});

// Receive updates
{
  type: 'analysis_complete',
  mintAddress: 'token123'
}
```

## Visual Design

### Score Rating Colors
- Excellent (250+): `#00ff88` (neon green)
- Good (200-249): `#88ff00` (lime)
- Fair (150-199): `#ffff00` (yellow)
- Poor (100-149): `#ff8800` (orange)
- Critical (<100): `#ff0088` (pink)

### Wallet Type Colors
- Organic: `#4CAF50` (green)
- Snipers: `#FF5252` (red)
- Bots: `#FF9800` (orange)
- Whales: `#2196F3` (blue)
- Developer: `#9C27B0` (purple)

### Risk Badges
- Low: Green background with transparency
- Medium: Orange background with transparency
- High: Red background with transparency

## Implementation Details

### Score Badge Component
```javascript
renderScoreBadge(analysis) {
  const score = analysis.holderScore;
  const scorePercent = (score / 300) * 100;
  const rating = getScoreRating(score);
  
  // Visual progress bar
  // Color-coded rating badge
  // Last analyzed timestamp
  // Refresh button
}
```

### Distribution Chart
- Chart.js doughnut chart
- Shows percentage of supply held by each wallet type
- Interactive tooltips
- Bottom legend

### Key Metrics
- Total Holders
- Top 10 Holdings %
- Top 25 Holdings %
- Gini Coefficient

### Classifications Table
Shows breakdown of holder types with:
- Count
- % of total holders
- % of supply held
- Risk level

### Growth Chart
- Line chart showing holder count over time
- 7-day default view
- Placeholder data until historical tracking

### Top Holders Table
- Top 20 holders by default
- Clickable addresses (Solscan links)
- Wallet type badges
- First buy timing

## Performance Optimizations

### Lazy Loading
- Charts only initialize when tab is viewed
- Holder data fetched on demand
- WebSocket subscription per tab

### Caching
- Analysis results cached in browser
- Auto-refresh every 30 seconds
- Manual refresh available

### Job Queue Integration
- Shows loading spinner during analysis
- Progress percentage updates
- Error handling with retry

## Usage

### Access Enhanced Page
```
http://localhost:3001/token-detail-enhanced.html?mint=TOKEN_ADDRESS
```

### Integration Steps
1. Replace existing token-detail.html
2. Update dashboard navigation
3. Test with various tokens
4. Monitor performance

## Testing

### Manual Testing
1. Load page with valid token
2. Click Holders tab
3. Verify all components render
4. Test refresh functionality
5. Check WebSocket updates

### Test Tokens
- USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
- SOL: So11111111111111111111111111111111111111112
- Any pump.fun token from dashboard

## Future Enhancements

### Planned Features
1. Historical holder data charts
2. Holder alerts and notifications
3. Comparison with similar tokens
4. Export functionality
5. Advanced filtering

### Performance Improvements
1. Virtual scrolling for large holder lists
2. Service Worker caching
3. Optimistic UI updates
4. Batch API requests

## Troubleshooting

### Common Issues
1. **No holder data**: Check if analysis exists
2. **Charts not rendering**: Verify Chart.js loaded
3. **WebSocket disconnected**: Check server running
4. **Slow loading**: Consider pagination

### Debug Mode
Add `?debug=true` to URL for verbose logging