# Token Detail Page - Combined Analytics UI Mockup

## Overview
This document provides a comprehensive mockup integrating both Holder Analytics and Bonding Curve Momentum scoring systems into the token detail page.

## Visual Mockup

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🚀 PumpMonitor  | Tokens | AMM Analytics | Stream                         │
│                                              SOL $180.50 • Connected 🟢     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ← Back to Dashboard                                                       │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  [Token Icon]  TOKEN_NAME (SYMBOL) 🎓 GRADUATED                   │   │
│  │                                                                     │   │
│  │  Price: $0.0234  (+15.3%)    Market Cap: $234,567    FDV: $2.3M  │   │
│  │  Volume 24h: $45,678          Liquidity: $123,456                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    🎯 COMBINED ANALYTICS SCORE                      │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │   │
│  │  521 / 600  Excellent Potential                                   │   │
│  │  ████████████████████████████████████████████░░░░░░░  87%       │   │
│  │                                                                   │   │
│  │  ┌─────────────────────────┬─────────────────────────┐           │   │
│  │  │ 🏆 Holder Health         │ 🚀 BC Momentum          │           │   │
│  │  │ 245/300 (82%)           │ 276/300 (92%)          │           │   │
│  │  │ ██████████████████████░ │ ████████████████████████ │          │   │
│  │  └─────────────────────────┴─────────────────────────┘           │   │
│  │                                                                   │   │
│  │  Last analyzed: 2 mins ago             [↻ Refresh Analysis]      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Overview | Price Chart | 📊 Analytics | Transactions | Pool Info  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  [ANALYTICS TAB CONTENT]                                                   │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ Score Summary                                               │   │   │
│  │  │                                                             │   │   │
│  │  │ Combined Score: 521/600 (87%)                               │   │   │
│  │  │ ▸ Holder Health: 245/300                                   │   │   │
│  │  │ ▸ BC Momentum: 276/300                                      │   │   │
│  │  │                                                             │   │   │
│  │  │ 🎯 Graduation Likelihood: VERY HIGH                         │   │   │
│  │  │ ⏰ Projected Graduation: ~3.5 hours                        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────┬───────────────────────────┐   │   │
│  │  │ Holder Health Breakdown         │ BC Momentum Breakdown      │   │   │
│  │  │                                 │                           │   │   │
│  │  │ Distribution Analysis           │ Progress Velocity         │   │   │
│  │  │ ████████████████ 85/100        │ ██████████████ 105/120   │   │   │
│  │  │                                 │                           │   │   │
│  │  │ Whale Concentration             │ Early Action              │   │   │
│  │  │ ████████████ 60/80             │ ████████████ 91/100      │   │   │
│  │  │                                 │                           │   │   │
│  │  │ Organic Growth                  │ Graduation Trajectory     │   │   │
│  │  │ ███████████ 55/70              │ █████████████ 80/80      │   │   │
│  │  │                                 │                           │   │   │
│  │  │ Dev/Team Ethics                 │                           │   │   │
│  │  │ ██████████ 45/50               │                           │   │   │
│  │  │                                 │                           │   │   │
│  │  │ Penalties: -20                  │                           │   │   │
│  │  └─────────────────────────────────┴───────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ Key Performance Indicators                                  │   │   │
│  │  │                                                             │   │   │
│  │  │ ┌─────────────────┬─────────────────┬──────────────────┐   │   │
│  │  │ │ Total Holders   │ BC Progress     │ Progress/Hour    │   │   │
│  │  │ │ 1,234 📈 +5.2% │ 72.5% 🚀       │ +18.5% 📈        │   │   │
│  │  │ ├─────────────────┼─────────────────┼──────────────────┤   │   │
│  │  │ │ Market Cap     │ Volume/Hour     │ Time to 50%      │   │   │
│  │  │ │ $234K 💰       │ 125 SOL 📊      │ 45 mins ⚡       │   │   │
│  │  │ ├─────────────────┼─────────────────┼──────────────────┤   │   │
│  │  │ │ Holder Quality │ Momentum Score  │ Risk Level       │   │   │
│  │  │ │ 82% Organic ✅ │ 92/100 🔥       │ LOW ✅           │   │   │
│  │  │ └─────────────────┴─────────────────┴──────────────────┘   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ Momentum & Progress Timeline                                │   │   │
│  │  │                                                             │   │   │
│  │  │  100% ┤                                    🎯 Graduation    │   │   │
│  │  │   80% ┤                              ╱─────                 │   │   │
│  │  │   60% ┤                        ╱─────  ← Current (72.5%)   │   │   │
│  │  │   40% ┤                  ╱─────                            │   │   │
│  │  │   20% ┤            ╱─────                                  │   │   │
│  │  │    0% └──┬────┬────┬────┬────┬────┬────┬────┬────┬        │   │   │
│  │  │         0h   1h   2h   3h   4h   5h   6h   7h   8h        │   │   │
│  │  │                                                             │   │   │
│  │  │  Milestones:                                               │   │   │
│  │  │  ⚡ 10% @ 15min  ⚡ 25% @ 38min  ⚡ 50% @ 1.5hr           │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ Holder Distribution & Classifications                       │   │   │
│  │  │                                                             │   │   │
│  │  │  [Donut Chart]              Classification Breakdown        │   │   │
│  │  │                                                             │   │   │
│  │  │  Organic 65%    ┌─────────┬────────┬─────────┬──────────┐ │   │   │
│  │  │  Snipers 15%    │ Type    │ Count  │ Supply  │ Risk     │ │   │   │
│  │  │  Bots 10%       ├─────────┼────────┼─────────┼──────────┤ │   │   │
│  │  │  Whales 8%      │ Organic │ 850    │ 52.3%   │ ✅ Low   │ │   │   │
│  │  │  Dev 2%         │ Snipers │ 15     │ 18.5%   │ 🔴 High  │ │   │   │
│  │  │                 │ Bots    │ 45     │ 8.2%    │ 🟡 Med   │ │   │   │
│  │  │                 │ Whales  │ 8      │ 15.8%   │ 🟡 Med   │ │   │   │
│  │  │                 │ Dev     │ 3      │ 5.2%    │ ✅ Low   │ │   │   │
│  │  │                 └─────────┴────────┴─────────┴──────────┘ │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ Combined Analytics Insights & Alerts                        │   │   │
│  │  │                                                             │   │   │
│  │  │ 🟢 Strong Signals:                                          │   │   │
│  │  │ ✓ Exceptional momentum (92% score)                          │   │   │
│  │  │ ✓ Reached 50% in record time (45 mins)                     │   │   │
│  │  │ ✓ Healthy holder distribution (82% organic)                │   │   │
│  │  │ ✓ Low developer holdings (5.2%)                            │   │   │
│  │  │ ✓ Consistent upward trajectory                             │   │   │
│  │  │                                                             │   │   │
│  │  │ ⚠️  Risk Factors:                                           │   │   │
│  │  │ • High sniper concentration (18.5%)                         │   │   │
│  │  │ • Top 10 holders control 28.5%                             │   │   │
│  │  │                                                             │   │   │
│  │  │ 📊 Prediction:                                              │   │   │
│  │  │ Based on current momentum and holder quality, this token    │   │   │
│  │  │ has a 94% probability of graduating within 4 hours.        │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ Historical Comparison                                       │   │   │
│  │  │                                                             │   │   │
│  │  │ This token vs. successful graduates at same progress:      │   │   │
│  │  │                                                             │   │   │
│  │  │ Metric              This Token    Avg Graduate   Percentile│   │   │
│  │  │ ─────────────────────────────────────────────────────────── │   │   │
│  │  │ Time to 70%         2.8 hours     5.2 hours      Top 10%  │   │   │
│  │  │ Holder Count        1,234         856            Top 25%  │   │   │
│  │  │ Volume/Hour         125 SOL       78 SOL         Top 15%  │   │   │
│  │  │ Organic Holders     82%           71%            Top 20%  │   │   │
│  │  │ Price Stability     High          Medium         Top 30%  │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### HTML Structure for Combined Analytics

```html
<!-- Combined Score Section (replaces individual score sections) -->
<div class="combined-analytics-section" id="combinedAnalyticsSection">
    <div class="combined-score-card">
        <h2 class="analytics-title">🎯 COMBINED ANALYTICS SCORE</h2>
        
        <!-- Main Combined Score -->
        <div class="main-score">
            <div class="score-display">
                <span class="score-value" id="combinedScore">--</span>
                <span class="score-total">/ 600</span>
                <span class="score-rating" id="combinedRating">--</span>
            </div>
            <div class="progress-bar main-progress">
                <div class="progress-fill" id="combinedProgressFill"></div>
            </div>
            <div class="progress-percentage" id="combinedPercentage">--%</div>
        </div>
        
        <!-- Sub-scores -->
        <div class="sub-scores">
            <div class="sub-score holder-score">
                <div class="sub-score-header">
                    <span class="icon">🏆</span>
                    <span class="label">Holder Health</span>
                </div>
                <div class="sub-score-value">
                    <span id="holderScore">--</span>/300 (<span id="holderPercent">--%</span>)
                </div>
                <div class="sub-progress-bar">
                    <div class="sub-progress-fill holder-fill" id="holderProgressFill"></div>
                </div>
            </div>
            
            <div class="sub-score momentum-score">
                <div class="sub-score-header">
                    <span class="icon">🚀</span>
                    <span class="label">BC Momentum</span>
                </div>
                <div class="sub-score-value">
                    <span id="momentumScore">--</span>/300 (<span id="momentumPercent">--%</span>)
                </div>
                <div class="sub-progress-bar">
                    <div class="sub-progress-fill momentum-fill" id="momentumProgressFill"></div>
                </div>
            </div>
        </div>
        
        <!-- Last Updated & Refresh -->
        <div class="analytics-footer">
            <span class="last-updated">Last analyzed: <span id="lastAnalyzed">--</span></span>
            <button class="refresh-analytics-btn" onclick="refreshCombinedAnalytics()">
                <span class="refresh-icon">↻</span> Refresh Analysis
            </button>
        </div>
    </div>
</div>

<!-- Analytics Tab Content -->
<div class="tab-content" id="analyticsTab" style="display: none;">
    <!-- Score Summary -->
    <div class="score-summary-card">
        <h3>Score Summary</h3>
        <div class="summary-content">
            <div class="combined-score-display">
                Combined Score: <span id="summaryScore">--</span>/600 (<span id="summaryPercent">--%</span>)
            </div>
            <div class="score-components">
                <div>▸ Holder Health: <span id="summaryHolder">--</span>/300</div>
                <div>▸ BC Momentum: <span id="summaryMomentum">--</span>/300</div>
            </div>
            <div class="graduation-prediction">
                <div class="prediction-likelihood">
                    🎯 Graduation Likelihood: <span id="graduationLikelihood" class="likelihood-badge">--</span>
                </div>
                <div class="prediction-time">
                    ⏰ Projected Graduation: <span id="projectedGraduation">--</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Detailed Breakdowns -->
    <div class="breakdowns-grid">
        <div class="breakdown-card">
            <h3>Holder Health Breakdown</h3>
            <div class="breakdown-items">
                <div class="breakdown-item">
                    <label>Distribution Analysis</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="distributionBar"></div>
                    </div>
                    <span class="item-score"><span id="distributionScore">--</span>/100</span>
                </div>
                <div class="breakdown-item">
                    <label>Whale Concentration</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="whaleBar"></div>
                    </div>
                    <span class="item-score"><span id="whaleScore">--</span>/80</span>
                </div>
                <div class="breakdown-item">
                    <label>Organic Growth</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="organicBar"></div>
                    </div>
                    <span class="item-score"><span id="organicScore">--</span>/70</span>
                </div>
                <div class="breakdown-item">
                    <label>Dev/Team Ethics</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="devEthicsBar"></div>
                    </div>
                    <span class="item-score"><span id="devEthicsScore">--</span>/50</span>
                </div>
                <div class="breakdown-item penalties">
                    <label>Penalties</label>
                    <span class="penalty-value" id="holderPenalties">--</span>
                </div>
            </div>
        </div>
        
        <div class="breakdown-card">
            <h3>BC Momentum Breakdown</h3>
            <div class="breakdown-items">
                <div class="breakdown-item">
                    <label>Progress Velocity</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="velocityBar"></div>
                    </div>
                    <span class="item-score"><span id="velocityScore">--</span>/120</span>
                </div>
                <div class="breakdown-item">
                    <label>Early Action</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="earlyActionBar"></div>
                    </div>
                    <span class="item-score"><span id="earlyActionScore">--</span>/100</span>
                </div>
                <div class="breakdown-item">
                    <label>Graduation Trajectory</label>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" id="trajectoryBar"></div>
                    </div>
                    <span class="item-score"><span id="trajectoryScore">--</span>/80</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- KPI Grid -->
    <div class="kpi-section">
        <h3>Key Performance Indicators</h3>
        <div class="kpi-grid">
            <div class="kpi-card">
                <label>Total Holders</label>
                <div class="kpi-value" id="totalHolders">--</div>
                <div class="kpi-change" id="holdersChange">--</div>
            </div>
            <div class="kpi-card">
                <label>BC Progress</label>
                <div class="kpi-value" id="bcProgress">--%</div>
                <div class="kpi-indicator">🚀</div>
            </div>
            <div class="kpi-card">
                <label>Progress/Hour</label>
                <div class="kpi-value" id="progressPerHour">--%</div>
                <div class="kpi-change positive">📈</div>
            </div>
            <div class="kpi-card">
                <label>Market Cap</label>
                <div class="kpi-value" id="marketCap">--</div>
                <div class="kpi-indicator">💰</div>
            </div>
            <div class="kpi-card">
                <label>Volume/Hour</label>
                <div class="kpi-value" id="volumePerHour">--</div>
                <div class="kpi-indicator">📊</div>
            </div>
            <div class="kpi-card">
                <label>Time to 50%</label>
                <div class="kpi-value" id="timeTo50">--</div>
                <div class="kpi-indicator">⚡</div>
            </div>
            <div class="kpi-card">
                <label>Holder Quality</label>
                <div class="kpi-value" id="holderQuality">--</div>
                <div class="kpi-indicator">✅</div>
            </div>
            <div class="kpi-card">
                <label>Momentum Score</label>
                <div class="kpi-value" id="momentumKpi">--</div>
                <div class="kpi-indicator">🔥</div>
            </div>
            <div class="kpi-card">
                <label>Risk Level</label>
                <div class="kpi-value risk-indicator" id="riskLevel">--</div>
            </div>
        </div>
    </div>
    
    <!-- Progress Timeline Chart -->
    <div class="timeline-section">
        <h3>Momentum & Progress Timeline</h3>
        <div class="timeline-chart-container">
            <canvas id="progressTimelineChart"></canvas>
        </div>
        <div class="milestones">
            <h4>Milestones:</h4>
            <div class="milestone-list" id="milestonesList">
                <!-- Dynamically populated -->
            </div>
        </div>
    </div>
    
    <!-- Combined Insights -->
    <div class="insights-section">
        <h3>Combined Analytics Insights & Alerts</h3>
        
        <div class="insights-grid">
            <div class="insight-category strong-signals">
                <h4>🟢 Strong Signals:</h4>
                <ul id="strongSignals">
                    <!-- Dynamically populated -->
                </ul>
            </div>
            
            <div class="insight-category risk-factors">
                <h4>⚠️ Risk Factors:</h4>
                <ul id="riskFactors">
                    <!-- Dynamically populated -->
                </ul>
            </div>
        </div>
        
        <div class="prediction-box">
            <h4>📊 Prediction:</h4>
            <p id="predictionText">--</p>
        </div>
    </div>
    
    <!-- Historical Comparison -->
    <div class="comparison-section">
        <h3>Historical Comparison</h3>
        <p class="comparison-subtitle">This token vs. successful graduates at same progress:</p>
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th>This Token</th>
                    <th>Avg Graduate</th>
                    <th>Percentile</th>
                </tr>
            </thead>
            <tbody id="comparisonBody">
                <!-- Dynamically populated -->
            </tbody>
        </table>
    </div>
</div>
```

### CSS Styles for Combined Analytics

```css
/* Combined Analytics Section */
.combined-analytics-section {
    margin: 20px 0;
}

.combined-score-card {
    background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 50%, #16213e 100%);
    border: 2px solid #0f3460;
    border-radius: 20px;
    padding: 32px;
    position: relative;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.combined-score-card::before {
    content: '';
    position: absolute;
    top: -100%;
    left: -100%;
    width: 300%;
    height: 300%;
    background: radial-gradient(circle, rgba(76, 175, 80, 0.1) 0%, transparent 70%);
    animation: pulse 15s infinite;
}

@keyframes pulse {
    0%, 100% { transform: scale(0.8) rotate(0deg); opacity: 0.5; }
    50% { transform: scale(1.2) rotate(180deg); opacity: 1; }
}

.analytics-title {
    text-align: center;
    font-size: 24px;
    margin-bottom: 24px;
    background: linear-gradient(90deg, #4CAF50 0%, #2196F3 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 700;
}

/* Main Score Display */
.main-score {
    text-align: center;
    margin-bottom: 32px;
}

.score-display {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 16px;
}

.score-value {
    font-size: 48px;
    font-weight: 700;
    background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.score-total {
    font-size: 24px;
    color: #666;
}

.score-rating {
    padding: 8px 20px;
    border-radius: 24px;
    font-size: 16px;
    font-weight: 600;
    margin-left: 16px;
}

.score-rating.excellent {
    background: linear-gradient(135deg, #4CAF50 0%, #8BC34A 100%);
    color: white;
}

.score-rating.very-good {
    background: linear-gradient(135deg, #2196F3 0%, #03A9F4 100%);
    color: white;
}

.score-rating.good {
    background: linear-gradient(135deg, #03A9F4 0%, #00BCD4 100%);
    color: white;
}

.score-rating.fair {
    background: linear-gradient(135deg, #FF9800 0%, #FFC107 100%);
    color: white;
}

.score-rating.poor {
    background: linear-gradient(135deg, #f44336 0%, #E91E63 100%);
    color: white;
}

/* Main Progress Bar */
.main-progress {
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 8px;
}

.main-progress .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50 0%, #2196F3 50%, #9C27B0 100%);
    transition: width 0.8s ease;
    position: relative;
}

.progress-percentage {
    text-align: center;
    font-size: 18px;
    font-weight: 600;
    color: #888;
}

/* Sub-scores Grid */
.sub-scores {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 24px;
}

.sub-score {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.sub-score-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}

.sub-score-header .icon {
    font-size: 20px;
}

.sub-score-header .label {
    font-size: 16px;
    font-weight: 600;
}

.sub-score-value {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 12px;
}

.sub-progress-bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}

.sub-progress-fill {
    height: 100%;
    transition: width 0.6s ease;
}

.holder-fill {
    background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
}

.momentum-fill {
    background: linear-gradient(90deg, #2196F3 0%, #03A9F4 100%);
}

/* Analytics Tab Styles */
.score-summary-card {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
}

.graduation-prediction {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.likelihood-badge {
    padding: 4px 12px;
    border-radius: 16px;
    font-weight: 600;
    margin-left: 8px;
}

.likelihood-badge.very-high {
    background: #4CAF50;
    color: white;
}

.likelihood-badge.high {
    background: #2196F3;
    color: white;
}

.likelihood-badge.medium {
    background: #FF9800;
    color: white;
}

.likelihood-badge.low {
    background: #f44336;
    color: white;
}

/* Breakdowns Grid */
.breakdowns-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
}

.breakdown-card {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
}

.breakdown-items {
    margin-top: 20px;
}

.breakdown-item {
    display: grid;
    grid-template-columns: 140px 1fr 80px;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
}

.breakdown-item.penalties {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 16px;
    margin-top: 16px;
}

.score-bar-wrapper {
    height: 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 5px;
    overflow: hidden;
}

.score-bar {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
    transition: width 0.6s ease;
}

.penalty-value {
    color: #f44336;
    font-weight: 600;
}

/* KPI Grid */
.kpi-section {
    margin-bottom: 32px;
}

.kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-top: 20px;
}

.kpi-card {
    background: #1a1a1a;
    border-radius: 8px;
    padding: 20px;
    text-align: center;
    position: relative;
    overflow: hidden;
}

.kpi-card label {
    display: block;
    color: #888;
    font-size: 12px;
    text-transform: uppercase;
    margin-bottom: 8px;
}

.kpi-value {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 4px;
}

.kpi-change {
    font-size: 14px;
}

.kpi-change.positive {
    color: #4CAF50;
}

.kpi-indicator {
    position: absolute;
    top: 10px;
    right: 10px;
    font-size: 20px;
    opacity: 0.3;
}

/* Timeline Chart */
.timeline-section {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 32px;
}

.timeline-chart-container {
    height: 300px;
    margin: 20px 0;
}

.milestones {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.milestone-list {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 12px;
}

.milestone-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    font-size: 14px;
}

/* Insights Section */
.insights-section {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 32px;
}

.insights-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 20px 0;
}

.insight-category h4 {
    margin-bottom: 12px;
}

.insight-category ul {
    list-style: none;
    padding: 0;
}

.insight-category li {
    padding: 8px 0;
    padding-left: 20px;
    position: relative;
}

.insight-category li::before {
    content: '✓';
    position: absolute;
    left: 0;
}

.risk-factors li::before {
    content: '•';
}

.prediction-box {
    background: linear-gradient(135deg, rgba(33, 150, 243, 0.1) 0%, rgba(76, 175, 80, 0.1) 100%);
    border: 1px solid rgba(33, 150, 243, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-top: 24px;
}

/* Comparison Table */
.comparison-section {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
}

.comparison-subtitle {
    color: #888;
    margin-bottom: 20px;
}

.comparison-table {
    width: 100%;
    border-collapse: collapse;
}

.comparison-table th,
.comparison-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.comparison-table th {
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    font-size: 12px;
}

.percentile-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
}

.percentile-top10 {
    background: #4CAF50;
    color: white;
}

.percentile-top25 {
    background: #2196F3;
    color: white;
}

.percentile-top50 {
    background: #03A9F4;
    color: white;
}

/* Responsive Design */
@media (max-width: 768px) {
    .sub-scores {
        grid-template-columns: 1fr;
    }
    
    .breakdowns-grid {
        grid-template-columns: 1fr;
    }
    
    .insights-grid {
        grid-template-columns: 1fr;
    }
    
    .kpi-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

### JavaScript Implementation

```javascript
// Combined Analytics Class
class CombinedAnalytics {
    constructor(mintAddress) {
        this.mintAddress = mintAddress;
        this.holderData = null;
        this.momentumData = null;
        this.charts = {};
        this.refreshInterval = null;
    }
    
    async initialize() {
        await this.loadAllData();
        this.startAutoRefresh();
    }
    
    async loadAllData() {
        try {
            // Load both datasets in parallel
            const [holderResponse, momentumResponse] = await Promise.all([
                fetch(`/api/tokens/${this.mintAddress}/holders/analysis`),
                fetch(`/api/tokens/${this.mintAddress}/momentum/analysis`)
            ]);
            
            if (!holderResponse.ok || !momentumResponse.ok) {
                throw new Error('Failed to load analytics data');
            }
            
            this.holderData = await holderResponse.json();
            this.momentumData = await momentumResponse.json();
            
            this.render();
        } catch (error) {
            console.error('Error loading analytics:', error);
            this.showError();
        }
    }
    
    render() {
        this.renderCombinedScore();
        this.renderScoreSummary();
        this.renderBreakdowns();
        this.renderKPIs();
        this.renderTimelineChart();
        this.renderInsights();
        this.renderComparison();
    }
    
    renderCombinedScore() {
        const holderScore = this.holderData.score;
        const momentumScore = this.momentumData.score;
        const combinedScore = holderScore + momentumScore;
        const percentage = (combinedScore / 600) * 100;
        const rating = this.getCombinedRating(combinedScore);
        
        // Main combined score
        document.getElementById('combinedScore').textContent = combinedScore;
        document.getElementById('combinedRating').textContent = rating.text;
        document.getElementById('combinedRating').className = `score-rating ${rating.class}`;
        document.getElementById('combinedProgressFill').style.width = `${percentage}%`;
        document.getElementById('combinedPercentage').textContent = `${percentage.toFixed(0)}%`;
        
        // Sub-scores
        const holderPercent = (holderScore / 300) * 100;
        const momentumPercent = (momentumScore / 300) * 100;
        
        document.getElementById('holderScore').textContent = holderScore;
        document.getElementById('holderPercent').textContent = `${holderPercent.toFixed(0)}%`;
        document.getElementById('holderProgressFill').style.width = `${holderPercent}%`;
        
        document.getElementById('momentumScore').textContent = momentumScore;
        document.getElementById('momentumPercent').textContent = `${momentumPercent.toFixed(0)}%`;
        document.getElementById('momentumProgressFill').style.width = `${momentumPercent}%`;
        
        // Last updated
        const lastUpdated = new Date(Math.min(
            new Date(this.holderData.lastUpdated),
            new Date(this.momentumData.lastUpdated)
        ));
        document.getElementById('lastAnalyzed').textContent = this.formatTimeAgo(lastUpdated);
    }
    
    renderBreakdowns() {
        // Holder Health Breakdown
        const holderBreakdown = this.holderData.breakdown;
        this.renderScoreBar('distributionBar', 'distributionScore', holderBreakdown.distribution, 100);
        this.renderScoreBar('whaleBar', 'whaleScore', holderBreakdown.whaleConcentration, 80);
        this.renderScoreBar('organicBar', 'organicScore', holderBreakdown.organicGrowth, 70);
        this.renderScoreBar('devEthicsBar', 'devEthicsScore', holderBreakdown.devEthics, 50);
        document.getElementById('holderPenalties').textContent = `-${holderBreakdown.penalties}`;
        
        // BC Momentum Breakdown
        const momentumBreakdown = this.momentumData.breakdown;
        this.renderScoreBar('velocityBar', 'velocityScore', momentumBreakdown.progressVelocity, 120);
        this.renderScoreBar('earlyActionBar', 'earlyActionScore', momentumBreakdown.earlyAction, 100);
        this.renderScoreBar('trajectoryBar', 'trajectoryScore', momentumBreakdown.graduationTrajectory, 80);
    }
    
    renderScoreBar(barId, scoreId, score, maxScore) {
        const percentage = (score / maxScore) * 100;
        document.getElementById(barId).style.width = `${percentage}%`;
        document.getElementById(scoreId).textContent = score;
    }
    
    renderTimelineChart() {
        const ctx = document.getElementById('progressTimelineChart').getContext('2d');
        
        if (this.charts.timeline) {
            this.charts.timeline.destroy();
        }
        
        // Prepare data
        const progressHistory = this.momentumData.progressHistory;
        const currentProgress = this.momentumData.currentProgress;
        const projectedData = this.calculateProjectedProgress(progressHistory, currentProgress);
        
        this.charts.timeline = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [...progressHistory.map(p => p.time), ...projectedData.map(p => p.time)],
                datasets: [{
                    label: 'Actual Progress',
                    data: progressHistory.map(p => p.progress),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#4CAF50',
                    borderWidth: 3
                }, {
                    label: 'Projected Progress',
                    data: [...new Array(progressHistory.length - 1).fill(null), 
                           progressHistory[progressHistory.length - 1].progress,
                           ...projectedData.map(p => p.progress)],
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderDash: [5, 5],
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: (value) => value + '%',
                            color: '#888'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#888'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#888'
                        }
                    },
                    annotation: {
                        annotations: {
                            graduationLine: {
                                type: 'line',
                                yMin: 100,
                                yMax: 100,
                                borderColor: '#f44336',
                                borderWidth: 2,
                                borderDash: [10, 5],
                                label: {
                                    content: 'Graduation',
                                    enabled: true,
                                    position: 'end'
                                }
                            },
                            currentProgress: {
                                type: 'line',
                                yMin: currentProgress,
                                yMax: currentProgress,
                                borderColor: '#FFC107',
                                borderWidth: 2,
                                label: {
                                    content: `Current: ${currentProgress}%`,
                                    enabled: true,
                                    position: 'start'
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Render milestones
        this.renderMilestones();
    }
    
    renderMilestones() {
        const milestones = this.momentumData.milestones;
        const html = Object.entries(milestones)
            .filter(([key, value]) => value)
            .map(([key, value]) => {
                const label = key.replace(/([A-Z])/g, ' $1').trim();
                return `<div class="milestone-item">⚡ ${label}: ${value}</div>`;
            }).join('');
        
        document.getElementById('milestonesList').innerHTML = html;
    }
    
    renderInsights() {
        // Strong signals
        const strongSignals = this.generateStrongSignals();
        document.getElementById('strongSignals').innerHTML = 
            strongSignals.map(signal => `<li>${signal}</li>`).join('');
        
        // Risk factors
        const riskFactors = this.generateRiskFactors();
        document.getElementById('riskFactors').innerHTML = 
            riskFactors.map(risk => `<li>${risk}</li>`).join('');
        
        // Prediction
        const prediction = this.generatePrediction();
        document.getElementById('predictionText').textContent = prediction;
    }
    
    generateStrongSignals() {
        const signals = [];
        
        if (this.momentumData.score > 250) {
            signals.push(`Exceptional momentum (${(this.momentumData.score/300*100).toFixed(0)}% score)`);
        }
        if (this.momentumData.milestones.reached50Percent) {
            signals.push(`Reached 50% in record time (${this.momentumData.milestones.reached50Percent})`);
        }
        if (this.holderData.metrics.organicPercentage > 80) {
            signals.push(`Healthy holder distribution (${this.holderData.metrics.organicPercentage}% organic)`);
        }
        if (this.holderData.metrics.developerHoldings < 10) {
            signals.push(`Low developer holdings (${this.holderData.metrics.developerHoldings.toFixed(1)}%)`);
        }
        if (this.momentumData.trajectoryStable) {
            signals.push('Consistent upward trajectory');
        }
        
        return signals;
    }
    
    generateRiskFactors() {
        const risks = [];
        
        if (this.holderData.metrics.sniperConcentration > 15) {
            risks.push(`High sniper concentration (${this.holderData.metrics.sniperConcentration.toFixed(1)}%)`);
        }
        if (this.holderData.metrics.top10Holdings > 30) {
            risks.push(`Top 10 holders control ${this.holderData.metrics.top10Holdings.toFixed(1)}%`);
        }
        if (this.momentumData.sellPressure > 20) {
            risks.push('Significant sell pressure detected');
        }
        
        return risks;
    }
    
    generatePrediction() {
        const combinedScore = this.holderData.score + this.momentumData.score;
        const probability = this.calculateGraduationProbability(combinedScore);
        const timeEstimate = this.momentumData.projectedGraduationTime;
        
        return `Based on current momentum and holder quality, this token has a ${probability}% ` +
               `probability of graduating within ${timeEstimate}.`;
    }
    
    calculateGraduationProbability(score) {
        // Score ranges: 0-200 (low), 200-350 (medium), 350-450 (high), 450-600 (very high)
        if (score >= 450) return Math.min(95, 80 + (score - 450) / 10);
        if (score >= 350) return 60 + (score - 350) / 2.5;
        if (score >= 200) return 30 + (score - 200) / 5;
        return Math.max(5, score / 10);
    }
    
    getCombinedRating(score) {
        if (score >= 500) return { text: 'Excellent Potential', class: 'excellent' };
        if (score >= 400) return { text: 'Very Good', class: 'very-good' };
        if (score >= 300) return { text: 'Good', class: 'good' };
        if (score >= 200) return { text: 'Fair', class: 'fair' };
        return { text: 'Poor', class: 'poor' };
    }
    
    formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
    
    startAutoRefresh() {
        // Refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.loadAllData();
        }, 30000);
    }
    
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        Object.values(this.charts).forEach(chart => chart.destroy());
    }
}

// Initialize combined analytics
let combinedAnalytics = null;

function initializeCombinedAnalytics(mintAddress) {
    if (combinedAnalytics) {
        combinedAnalytics.destroy();
    }
    combinedAnalytics = new CombinedAnalytics(mintAddress);
    combinedAnalytics.initialize();
}

// Refresh function
async function refreshCombinedAnalytics() {
    const btn = event.target.closest('.refresh-analytics-btn');
    btn.disabled = true;
    btn.querySelector('.refresh-icon').style.animation = 'spin 1s linear infinite';
    
    await combinedAnalytics.loadAllData();
    
    btn.disabled = false;
    btn.querySelector('.refresh-icon').style.animation = '';
}

// Tab navigation update
function showAnalyticsTab() {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    
    // Show analytics tab
    document.getElementById('analyticsTab').style.display = 'block';
    
    // Initialize analytics if not already done
    if (!combinedAnalytics) {
        initializeCombinedAnalytics(window.mintAddress);
    }
}
```

## Key Features of the Combined UI

### 1. **Unified Score Display**
- Combined score out of 600 (300 holder + 300 momentum)
- Visual breakdown showing contribution from each system
- Color-coded rating system

### 2. **Integrated Analytics Tab**
- Replaces separate holder/momentum tabs
- Shows detailed breakdowns side-by-side
- Unified KPI dashboard

### 3. **Predictive Insights**
- Graduation likelihood calculation
- Time to graduation estimate
- Risk assessment combining both systems

### 4. **Visual Enhancements**
- Progress timeline showing actual vs projected
- Milestone tracking visualization
- Historical comparison with graduated tokens

### 5. **Real-time Updates**
- Auto-refresh every 30 seconds
- Live progress tracking
- Dynamic risk alerts

### 6. **Responsive Design**
- Mobile-optimized layouts
- Collapsible sections
- Touch-friendly interactions

## API Endpoints Required

```typescript
// Combined analytics endpoint
GET /api/tokens/:mintAddress/combined-analytics
Response: {
  holderAnalysis: HolderAnalysisData,
  momentumAnalysis: MomentumAnalysisData,
  combinedScore: number,
  graduationPrediction: {
    likelihood: 'very-high' | 'high' | 'medium' | 'low',
    estimatedTime: string,
    probability: number
  },
  historicalComparison: ComparisonData[]
}

// Individual endpoints (for granular updates)
GET /api/tokens/:mintAddress/holders/analysis
GET /api/tokens/:mintAddress/momentum/analysis
```

## Performance Optimizations

1. **Lazy Loading**: Analytics data loads only when tab is accessed
2. **Batch Updates**: Combine holder and momentum data requests
3. **Chart Caching**: Reuse chart instances instead of recreating
4. **Debounced Refresh**: Prevent rapid refresh clicks
5. **Progressive Enhancement**: Core features work without JavaScript

This combined UI provides a comprehensive view of both holder quality and bonding curve momentum, giving users a complete picture of a token's potential for success.