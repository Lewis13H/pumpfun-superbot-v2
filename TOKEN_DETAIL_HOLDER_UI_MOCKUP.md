# Token Detail Page - Holder Analytics UI Mockup

## Overview
This document provides a detailed mockup and implementation guide for integrating holder analytics into the existing token detail page.

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
│  │  🏆 Holder Health Score                                            │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │   │
│  │  245 / 300  Excellent                                             │   │
│  │  ████████████████████████████████░░░░░░░░  82%                  │   │
│  │                                                                   │   │
│  │  Last analyzed: 5 minutes ago            [↻ Refresh Analysis]    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Overview | Price Chart | 📊 Holders | Transactions | Pool Info     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  [HOLDERS TAB CONTENT]                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  ┌─────────────────────┬──────────────────────────────────────┐   │   │
│  │  │ Score Breakdown     │         Holder Distribution          │   │   │
│  │  │                     │                                      │   │   │
│  │  │ Distribution        │      [Donut Chart Visualization]     │   │   │
│  │  │ ████████████ 45/50 │                                      │   │   │
│  │  │                     │      Organic    ████ 65% (850)      │   │   │
│  │  │ Decentralization    │      Snipers    ████ 15% (15)       │   │   │
│  │  │ ████████████ 40/50 │      Bots       ████ 10% (45)       │   │   │
│  │  │                     │      Whales     ████  8% (8)        │   │   │
│  │  │ Organic Growth      │      Developer  ████  2% (3)        │   │   │
│  │  │ ████████████ 25/30 │                                      │   │   │
│  │  │                     │      Total: 1,234 holders           │   │   │
│  │  │ Developer Ethics    │                                      │   │   │
│  │  │ ████████████ 15/20 │                                      │   │   │
│  │  │                     │                                      │   │   │
│  │  │ ─────────────────   │                                      │   │   │
│  │  │ Sniper Risk  -15    │                                      │   │   │
│  │  │ Bot Activity -10    │                                      │   │   │
│  │  │                     │                                      │   │   │
│  │  │ Total Score: 245    │                                      │   │   │
│  │  └─────────────────────┴──────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  Key Metrics                                                        │   │
│  │  ┌─────────────────┬─────────────────┬─────────────────────────┐   │   │
│  │  │ Total Holders   │ Unique Wallets  │ Avg Holding Duration   │   │   │
│  │  │ 1,234 📈 +5.2%  │ 1,180 (95.6%)   │ 18.5 hours            │   │   │
│  │  ├─────────────────┼─────────────────┼─────────────────────────┤   │   │
│  │  │ Top 10 Hold     │ Top 25 Hold     │ Gini Coefficient       │   │   │
│  │  │ 28.5% ✅        │ 42.3% ⚠️        │ 0.72 (High)            │   │   │
│  │  ├─────────────────┼─────────────────┼─────────────────────────┤   │   │
│  │  │ Growth Rate 24h │ Churn Rate 24h  │ Concentration Risk     │   │   │
│  │  │ +12.3% 🚀       │ 3.2% ✅         │ Medium ⚠️              │   │   │
│  │  └─────────────────┴─────────────────┴─────────────────────────┘   │   │
│  │                                                                     │   │
│  │  Holder Classifications & Risk Analysis                             │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │ Type      │ Wallets │ % Holders │ % Supply │ Avg Size │ Risk │ │   │
│  │  │───────────┼─────────┼───────────┼──────────┼──────────┼──────│ │   │
│  │  │ 🌱 Organic│   850   │   68.9%   │  52.3%   │  76.5K   │ ✅   │ │   │
│  │  │ 🎯 Snipers│    15   │    1.2%   │  18.5%   │  1.5M    │ 🔴   │ │   │
│  │  │ 🤖 Bots   │    45   │    3.6%   │   8.2%   │  226K    │ 🟡   │ │   │
│  │  │ 🐋 Whales │     8   │    0.6%   │  15.8%   │  2.5M    │ 🟡   │ │   │
│  │  │ 👨‍💻 Dev    │     3   │    0.2%   │   5.2%   │  2.2M    │ ✅   │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  Holder Growth & Score History (7 Days)                            │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │  1400 ┤                                              Score 280 │ │   │
│  │  │  1200 ┤        Holders ──────                              260 │ │   │
│  │  │  1000 ┤     ╱─────────                  Score ········     240 │ │   │
│  │  │   800 ┤  ╱──                         ···········           220 │ │   │
│  │  │   600 ┤─                      ·······                      200 │ │   │
│  │  │       └─────┬─────┬─────┬─────┬─────┬─────┬─────┬           │ │   │
│  │  │         7d   6d   5d   4d   3d   2d   1d  Now              │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  Top 10 Holders                                              [More] │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │ # │ Address      │ Balance    │ %    │ Type   │ First Buy   │ │   │
│  │  │───┼──────────────┼────────────┼──────┼────────┼─────────────│ │   │
│  │  │ 1 │ 7xKd...3mP  │ 5,234,567  │ 8.5% │ 🐋     │ 2 days ago  │ │   │
│  │  │ 2 │ 9bNf...8kL  │ 3,123,456  │ 5.1% │ 🎯     │ 5 mins      │ │   │
│  │  │ 3 │ 2mXy...4pQ  │ 2,987,654  │ 4.9% │ 🌱     │ 1 day ago   │ │   │
│  │  │ 4 │ 5kLm...7nR  │ 2,456,789  │ 4.0% │ 🤖     │ 3 hours ago │ │   │
│  │  │ 5 │ 8qWe...2mS  │ 2,123,456  │ 3.5% │ 🌱     │ 12 hrs ago  │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  Health Indicators & Alerts                                         │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │ ⚠️  High Sniper Concentration (18.5% of supply)               │ │   │
│  │  │ ✅  Healthy Holder Growth (+12.3% in 24h)                     │ │   │
│  │  │ ✅  Low Developer Holdings (5.2%)                             │ │   │
│  │  │ ⚠️  Increasing Concentration (Top 10: +2.3% in 24h)           │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### HTML Structure Addition
```html
<!-- Add to token-detail.html after existing token header -->
<div class="holder-score-section" id="holderScoreSection">
    <div class="holder-score-badge">
        <div class="score-header">
            <div class="score-title">
                <span class="trophy-icon">🏆</span>
                <h3>Holder Health Score</h3>
            </div>
            <div class="score-value">
                <span id="holderScore">--</span>
                <span class="score-total">/ 300</span>
                <span class="score-rating" id="scoreRating">--</span>
            </div>
        </div>
        <div class="score-progress">
            <div class="progress-bar">
                <div class="progress-fill" id="scoreProgressFill"></div>
            </div>
            <div class="progress-label">
                <span id="scorePercentage">--%</span>
            </div>
        </div>
        <div class="score-footer">
            <span class="last-analyzed">Last analyzed: <span id="lastAnalyzed">--</span></span>
            <button class="refresh-btn" onclick="refreshHolderAnalysis()">
                <span class="refresh-icon">↻</span> Refresh Analysis
            </button>
        </div>
    </div>
</div>

<!-- Add new Holders tab content -->
<div class="tab-content" id="holdersTab" style="display: none;">
    <!-- Score Breakdown and Distribution -->
    <div class="holders-overview">
        <div class="score-breakdown">
            <h3>Score Breakdown</h3>
            <div class="score-components">
                <div class="score-item">
                    <label>Distribution</label>
                    <div class="score-bar-container">
                        <div class="score-bar" data-score="45" data-max="50"></div>
                    </div>
                    <span class="score-value">45/50</span>
                </div>
                <!-- Add other score components -->
            </div>
        </div>
        
        <div class="distribution-chart">
            <h3>Holder Distribution</h3>
            <canvas id="holderDistributionChart"></canvas>
            <div class="distribution-legend" id="distributionLegend"></div>
        </div>
    </div>
    
    <!-- Key Metrics Grid -->
    <div class="metrics-grid">
        <h3>Key Metrics</h3>
        <div class="metrics-container">
            <div class="metric-card">
                <div class="metric-label">Total Holders</div>
                <div class="metric-value" id="totalHolders">--</div>
                <div class="metric-change positive">+5.2%</div>
            </div>
            <!-- Add other metric cards -->
        </div>
    </div>
    
    <!-- Classifications Table -->
    <div class="classifications-section">
        <h3>Holder Classifications & Risk Analysis</h3>
        <table class="classifications-table">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Wallets</th>
                    <th>% Holders</th>
                    <th>% Supply</th>
                    <th>Avg Size</th>
                    <th>Risk</th>
                </tr>
            </thead>
            <tbody id="classificationsBody">
                <!-- Dynamically populated -->
            </tbody>
        </table>
    </div>
    
    <!-- Growth Chart -->
    <div class="growth-chart-section">
        <h3>Holder Growth & Score History (7 Days)</h3>
        <canvas id="holderGrowthChart"></canvas>
    </div>
    
    <!-- Top Holders -->
    <div class="top-holders-section">
        <div class="section-header">
            <h3>Top 10 Holders</h3>
            <a href="#" class="view-more">View All</a>
        </div>
        <table class="holders-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Address</th>
                    <th>Balance</th>
                    <th>%</th>
                    <th>Type</th>
                    <th>First Buy</th>
                </tr>
            </thead>
            <tbody id="topHoldersBody">
                <!-- Dynamically populated -->
            </tbody>
        </table>
    </div>
    
    <!-- Health Indicators -->
    <div class="health-indicators">
        <h3>Health Indicators & Alerts</h3>
        <div class="alerts-container" id="healthAlerts">
            <!-- Dynamically populated alerts -->
        </div>
    </div>
</div>
```

### CSS Styles for Holder Analytics
```css
/* Holder Score Badge */
.holder-score-section {
    margin: 20px 0;
}

.holder-score-badge {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #0f3460;
    border-radius: 16px;
    padding: 24px;
    position: relative;
    overflow: hidden;
}

.holder-score-badge::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
    animation: shimmer 10s infinite;
}

@keyframes shimmer {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.score-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.score-title {
    display: flex;
    align-items: center;
    gap: 8px;
}

.trophy-icon {
    font-size: 24px;
}

.score-value {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

#holderScore {
    font-size: 36px;
    font-weight: 700;
    color: #4CAF50;
}

.score-total {
    font-size: 18px;
    color: #666;
}

.score-rating {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
}

.score-rating.excellent {
    background: #4CAF50;
    color: white;
}

.score-rating.good {
    background: #2196F3;
    color: white;
}

.score-rating.fair {
    background: #FF9800;
    color: white;
}

.score-rating.poor {
    background: #f44336;
    color: white;
}

/* Progress Bar */
.score-progress {
    position: relative;
    margin-bottom: 16px;
}

.progress-bar {
    width: 100%;
    height: 12px;
    background: rgba(255,255,255,0.1);
    border-radius: 6px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
    transition: width 0.6s ease;
    position: relative;
}

.progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
    animation: progress-shine 2s infinite;
}

@keyframes progress-shine {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

/* Refresh Button */
.refresh-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: #4CAF50;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    gap: 6px;
}

.refresh-btn:hover {
    background: rgba(76,175,80,0.2);
    border-color: #4CAF50;
    transform: translateY(-1px);
}

.refresh-icon {
    display: inline-block;
    transition: transform 0.3s;
}

.refresh-btn:hover .refresh-icon {
    transform: rotate(180deg);
}

/* Holders Tab Content */
.holders-overview {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
}

.score-breakdown {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
}

.score-components {
    margin-top: 20px;
}

.score-item {
    display: grid;
    grid-template-columns: 120px 1fr 60px;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

.score-bar-container {
    height: 8px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    overflow: hidden;
}

.score-bar {
    height: 100%;
    background: #4CAF50;
    transition: width 0.6s ease;
}

/* Distribution Chart */
.distribution-chart {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 24px;
    text-align: center;
}

#holderDistributionChart {
    max-height: 300px;
}

/* Metrics Grid */
.metrics-grid {
    margin-bottom: 32px;
}

.metrics-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-top: 16px;
}

.metric-card {
    background: #1a1a1a;
    border-radius: 8px;
    padding: 20px;
    text-align: center;
}

.metric-label {
    color: #888;
    font-size: 12px;
    text-transform: uppercase;
    margin-bottom: 8px;
}

.metric-value {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
}

.metric-change {
    font-size: 14px;
}

.metric-change.positive {
    color: #4CAF50;
}

.metric-change.negative {
    color: #f44336;
}

/* Classifications Table */
.classifications-table {
    width: 100%;
    background: #1a1a1a;
    border-radius: 8px;
    overflow: hidden;
}

.classifications-table th,
.classifications-table td {
    padding: 12px;
    text-align: left;
}

.classifications-table th {
    background: rgba(255,255,255,0.05);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
}

.classifications-table td {
    border-top: 1px solid rgba(255,255,255,0.1);
}

.risk-indicator {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
}

.risk-low {
    background: rgba(76,175,80,0.2);
    color: #4CAF50;
}

.risk-medium {
    background: rgba(255,193,7,0.2);
    color: #FFC107;
}

.risk-high {
    background: rgba(244,67,54,0.2);
    color: #f44336;
}

/* Health Alerts */
.health-indicators {
    margin-top: 32px;
}

.alerts-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
}

.health-alert {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    font-size: 14px;
}

.alert-warning {
    background: rgba(255,193,7,0.1);
    border: 1px solid rgba(255,193,7,0.3);
    color: #FFC107;
}

.alert-success {
    background: rgba(76,175,80,0.1);
    border: 1px solid rgba(76,175,80,0.3);
    color: #4CAF50;
}

.alert-danger {
    background: rgba(244,67,54,0.1);
    border: 1px solid rgba(244,67,54,0.3);
    color: #f44336;
}

/* Responsive Design */
@media (max-width: 768px) {
    .holders-overview {
        grid-template-columns: 1fr;
    }
    
    .metrics-container {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .classifications-table {
        font-size: 12px;
    }
    
    .classifications-table th,
    .classifications-table td {
        padding: 8px;
    }
}
```

### JavaScript Implementation
```javascript
// Add to token-detail.html script section
class HolderAnalytics {
    constructor(mintAddress) {
        this.mintAddress = mintAddress;
        this.charts = {};
        this.analysisData = null;
    }
    
    async loadAnalysis() {
        try {
            const response = await fetch(`/api/tokens/${this.mintAddress}/holders/analysis`);
            if (!response.ok) throw new Error('Failed to load holder analysis');
            
            this.analysisData = await response.json();
            this.render();
        } catch (error) {
            console.error('Error loading holder analysis:', error);
            this.showError();
        }
    }
    
    render() {
        this.renderScoreBadge();
        this.renderScoreBreakdown();
        this.renderDistributionChart();
        this.renderMetrics();
        this.renderClassifications();
        this.renderGrowthChart();
        this.renderTopHolders();
        this.renderHealthAlerts();
    }
    
    renderScoreBadge() {
        const score = this.analysisData.score;
        const percentage = (score / 300) * 100;
        const rating = this.getScoreRating(score);
        
        document.getElementById('holderScore').textContent = score;
        document.getElementById('scoreRating').textContent = rating.text;
        document.getElementById('scoreRating').className = `score-rating ${rating.class}`;
        document.getElementById('scoreProgressFill').style.width = `${percentage}%`;
        document.getElementById('scorePercentage').textContent = `${percentage.toFixed(0)}%`;
        document.getElementById('lastAnalyzed').textContent = this.formatTimeAgo(this.analysisData.lastUpdated);
    }
    
    renderDistributionChart() {
        const ctx = document.getElementById('holderDistributionChart').getContext('2d');
        
        if (this.charts.distribution) {
            this.charts.distribution.destroy();
        }
        
        const data = this.analysisData.metrics.classifications;
        
        this.charts.distribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Organic', 'Snipers', 'Bots', 'Whales', 'Developer'],
                datasets: [{
                    data: [
                        data.organic,
                        data.snipers,
                        data.bots,
                        data.whales,
                        data.developers
                    ],
                    backgroundColor: [
                        '#4CAF50',
                        '#f44336',
                        '#FF9800',
                        '#2196F3',
                        '#9C27B0'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#888',
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
    
    renderHealthAlerts() {
        const alerts = [];
        const metrics = this.analysisData.metrics;
        
        // Generate alerts based on metrics
        if (metrics.holdings.snipers > 15) {
            alerts.push({
                type: 'warning',
                icon: '⚠️',
                text: `High Sniper Concentration (${metrics.holdings.snipers.toFixed(1)}% of supply)`
            });
        }
        
        if (this.analysisData.trends?.holderGrowth > 10) {
            alerts.push({
                type: 'success',
                icon: '✅',
                text: `Healthy Holder Growth (+${this.analysisData.trends.holderGrowth.toFixed(1)}% in 24h)`
            });
        }
        
        if (metrics.holdings.developers < 10) {
            alerts.push({
                type: 'success',
                icon: '✅',
                text: `Low Developer Holdings (${metrics.holdings.developers.toFixed(1)}%)`
            });
        }
        
        const alertsHtml = alerts.map(alert => `
            <div class="health-alert alert-${alert.type}">
                <span>${alert.icon}</span>
                <span>${alert.text}</span>
            </div>
        `).join('');
        
        document.getElementById('healthAlerts').innerHTML = alertsHtml || 
            '<div class="health-alert alert-success">✅ No significant issues detected</div>';
    }
    
    getScoreRating(score) {
        if (score >= 250) return { text: 'Excellent', class: 'excellent' };
        if (score >= 200) return { text: 'Good', class: 'good' };
        if (score >= 150) return { text: 'Fair', class: 'fair' };
        return { text: 'Poor', class: 'poor' };
    }
    
    formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
}

// Initialize when holders tab is clicked
function showHoldersTab() {
    if (!window.holderAnalytics) {
        window.holderAnalytics = new HolderAnalytics(mintAddress);
        window.holderAnalytics.loadAnalysis();
    }
}

// Refresh function
async function refreshHolderAnalysis() {
    const btn = event.target.closest('.refresh-btn');
    btn.disabled = true;
    btn.querySelector('.refresh-icon').style.animation = 'spin 1s linear infinite';
    
    await window.holderAnalytics.loadAnalysis();
    
    btn.disabled = false;
    btn.querySelector('.refresh-icon').style.animation = '';
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

## Integration Points

1. **Tab Navigation**: Add "Holders" tab to existing tab system
2. **API Integration**: Connect to new holder analysis endpoints
3. **Real-time Updates**: Use existing WebSocket infrastructure for live updates
4. **Score Badge**: Display prominently below token header, visible on all tabs
5. **Performance**: Lazy load holder data only when tab is selected
6. **Caching**: Use existing caching strategy for holder data

## Mobile Responsiveness

- Stack score breakdown and distribution chart vertically on mobile
- Use horizontal scrolling for tables
- Collapse metric cards to 2x2 grid on small screens
- Hide less critical columns in tables on mobile

## Accessibility

- Use semantic HTML for better screen reader support
- Add ARIA labels for charts and progress bars
- Ensure color contrast meets WCAG guidelines
- Provide text alternatives for visual indicators

## Performance Considerations

- Load holder data only when tab is accessed
- Use virtual scrolling for large holder lists
- Implement pagination for top holders table
- Cache chart instances to avoid recreation
- Debounce refresh requests