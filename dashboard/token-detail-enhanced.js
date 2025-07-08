// Token Detail Enhanced with Holder Analytics
// Global variables
let currentToken = null;
let priceChart = null;
let distributionChart = null;
let growthChart = null;
let refreshInterval = null;
let ws = null;

// Get mint address from URL
const urlParams = new URLSearchParams(window.location.search);
const mintAddress = urlParams.get('mint');

if (!mintAddress) {
    showError('No token address provided');
} else {
    initializePage();
}

// Initialize page
async function initializePage() {
    try {
        // Set up tab navigation
        setupTabNavigation();
        
        // Load initial data
        await loadTokenData();
        
        // Set up auto-refresh
        startAutoRefresh();
        
        // Initialize WebSocket for real-time updates
        initializeWebSocket();
        
        // Load SOL price
        updateSolPrice();
        
    } catch (error) {
        console.error('Failed to initialize page:', error);
        showError('Failed to load token data');
    }
}

// Tab Navigation
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            // Update active button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            // Load tab-specific data
            if (tabName === 'holders' && !document.getElementById('holderScoreBadge').dataset.loaded) {
                loadHolderAnalytics();
            } else if (tabName === 'chart' && !priceChart) {
                initializePriceChart();
            }
        });
    });
}

// Load token data
async function loadTokenData() {
    try {
        const response = await fetch(`/api/tokens/${mintAddress}`);
        if (!response.ok) throw new Error('Failed to fetch token data');
        
        const data = await response.json();
        currentToken = data;
        
        // Update page title
        document.title = `${data.symbol || 'Unknown'} - Token Detail`;
        
        // Hide loading, show content
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        
        // Render token data
        renderTokenHeader(data);
        renderOverview(data);
        renderTransactions(data.recentTransactions || []);
        renderPoolInfo(data);
        
    } catch (error) {
        console.error('Error loading token data:', error);
        showError('Failed to load token data');
    }
}

// Render token header
function renderTokenHeader(data) {
    // Icon
    const iconContainer = document.getElementById('tokenIcon');
    if (data.image_uri) {
        iconContainer.innerHTML = `<img src="${data.image_uri}" alt="${data.symbol}" onerror="this.style.display='none'; document.getElementById('tokenIconPlaceholder').style.display='block';">`;
    } else {
        document.getElementById('tokenIconPlaceholder').textContent = data.symbol ? data.symbol[0] : '?';
    }
    
    // Name and symbol
    document.getElementById('tokenName').textContent = data.name || 'Unknown Token';
    document.getElementById('tokenSymbol').textContent = data.symbol || 'UNKNOWN';
    
    // Stats
    document.getElementById('priceUsd').textContent = `$${formatPrice(data.current_price_usd)}`;
    document.getElementById('marketCap').textContent = `$${formatNumber(data.current_market_cap_usd)}`;
    document.getElementById('volume24h').textContent = `$${formatNumber(data.volume_24h || 0)}`;
    document.getElementById('holderCount').textContent = formatNumber(data.holder_count || 0, 0);
    
    // External links
    document.getElementById('pumpfunLink').href = `https://pump.fun/${mintAddress}`;
    document.getElementById('solscanLink').href = `https://solscan.io/token/${mintAddress}`;
}

// Load holder analytics
async function loadHolderAnalytics() {
    try {
        // Show loading state
        document.getElementById('holderScoreBadge').innerHTML = '<div class="spinner"></div>';
        
        // Fetch holder analysis
        const response = await fetch(`/api/holder-analysis/${mintAddress}`);
        const result = await response.json();
        
        if (result.success) {
            if (result.data) {
                // We have analysis data
                renderHolderAnalysis(result.data);
            } else if (result.jobId) {
                // Analysis is queued, monitor the job
                monitorAnalysisJob(result.jobId);
            }
        } else {
            throw new Error(result.error || 'Failed to load holder analysis');
        }
        
        // Mark as loaded
        document.getElementById('holderScoreBadge').dataset.loaded = 'true';
        
    } catch (error) {
        console.error('Error loading holder analytics:', error);
        document.getElementById('holderScoreBadge').innerHTML = `
            <div class="error">Failed to load holder analysis</div>
            <button class="refresh-btn" onclick="loadHolderAnalytics()">Retry</button>
        `;
    }
}

// Render holder analysis
function renderHolderAnalysis(analysis) {
    // Render score badge
    renderScoreBadge(analysis);
    
    // Render score breakdown
    renderScoreBreakdown(analysis.scoreBreakdown || analysis.score_breakdown);
    
    // Render key metrics
    renderKeyMetrics(analysis);
    
    // Render distribution chart
    renderDistributionChart(analysis);
    
    // Render classifications table
    renderClassificationsTable(analysis);
    
    // Render top holders
    renderTopHolders(analysis.topHolders || analysis.top_holders || []);
    
    // Initialize growth chart
    initializeGrowthChart(analysis);
}

// Render score badge
function renderScoreBadge(analysis) {
    const score = analysis.holderScore || analysis.holder_score || 0;
    const scorePercent = (score / 300) * 100;
    const rating = getScoreRating(score);
    const ratingClass = rating.toLowerCase();
    
    const html = `
        <div class="score-header">
            <h3>Holder Score: ${score}/300</h3>
            <span class="rating ${ratingClass}">${rating}</span>
        </div>
        <div class="score-bar">
            <div class="score-fill" style="width: ${scorePercent}%"></div>
        </div>
        <div class="score-footer">
            <span>Last analyzed: ${formatTimeAgo(analysis.analysisTimestamp || analysis.created_at)}</span>
            <button onclick="refreshHolderAnalysis()" class="refresh-btn">↻ Refresh</button>
        </div>
    `;
    
    document.getElementById('holderScoreBadge').innerHTML = html;
}

// Render score breakdown
function renderScoreBreakdown(breakdown) {
    if (!breakdown) {
        document.getElementById('scoreBreakdown').innerHTML = '<p>Score breakdown not available</p>';
        return;
    }
    
    const html = `
        <h4>Score Breakdown</h4>
        <div class="score-item">
            <span>Base Score</span>
            <span>${breakdown.base || 150}</span>
        </div>
        <div class="score-item">
            <span>Distribution</span>
            <span>+${breakdown.distributionScore || breakdown.distribution_score || 0}</span>
        </div>
        <div class="score-item">
            <span>Decentralization</span>
            <span>+${breakdown.decentralizationScore || breakdown.decentralization_score || 0}</span>
        </div>
        <div class="score-item">
            <span>Organic Growth</span>
            <span>+${breakdown.organicGrowthScore || breakdown.organic_growth_score || 0}</span>
        </div>
        <div class="score-item">
            <span>Developer Ethics</span>
            <span>+${breakdown.developerEthicsScore || breakdown.developer_ethics_score || 0}</span>
        </div>
        <div class="score-divider"></div>
        <div class="score-item penalty">
            <span>Sniper Penalty</span>
            <span>${breakdown.sniperPenalty || breakdown.sniper_penalty || 0}</span>
        </div>
        <div class="score-item penalty">
            <span>Bot Penalty</span>
            <span>${breakdown.botPenalty || breakdown.bot_penalty || 0}</span>
        </div>
        <div class="score-item penalty">
            <span>Concentration Penalty</span>
            <span>${breakdown.concentrationPenalty || breakdown.concentration_penalty || 0}</span>
        </div>
        <div class="score-divider"></div>
        <div class="score-item score-total">
            <span>Total Score</span>
            <span>${breakdown.total}</span>
        </div>
    `;
    
    document.getElementById('scoreBreakdown').innerHTML = html;
}

// Render key metrics
function renderKeyMetrics(analysis) {
    const metrics = [
        {
            label: 'Total Holders',
            value: formatNumber(analysis.holder_count || analysis.holderCounts?.total || 0, 0)
        },
        {
            label: 'Top 10 Hold',
            value: `${(analysis.top_10_percentage || analysis.distributionMetrics?.top10Percentage || 0).toFixed(1)}%`
        },
        {
            label: 'Top 25 Hold',
            value: `${(analysis.top_25_percentage || analysis.distributionMetrics?.top25Percentage || 0).toFixed(1)}%`
        },
        {
            label: 'Gini Coefficient',
            value: (analysis.gini_coefficient || analysis.distributionMetrics?.giniCoefficient || 0).toFixed(3)
        }
    ];
    
    const html = metrics.map(metric => `
        <div class="metric-card">
            <div class="label">${metric.label}</div>
            <div class="value">${metric.value}</div>
        </div>
    `).join('');
    
    document.getElementById('keyMetrics').innerHTML = html;
}

// Render distribution chart
function renderDistributionChart(analysis) {
    const ctx = document.getElementById('distributionChart').getContext('2d');
    
    // Destroy existing chart if any
    if (distributionChart) {
        distributionChart.destroy();
    }
    
    // Get holder percentages
    const holdingPercentages = analysis.holdingPercentages || {
        organic: analysis.organic_percentage || 0,
        snipers: analysis.sniper_percentage || 0,
        bots: analysis.bot_percentage || 0,
        whales: analysis.whale_percentage || 0,
        developers: analysis.developer_percentage || 0
    };
    
    distributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Organic', 'Snipers', 'Bots', 'Whales', 'Developer'],
            datasets: [{
                data: [
                    holdingPercentages.organic,
                    holdingPercentages.snipers,
                    holdingPercentages.bots,
                    holdingPercentages.whales,
                    holdingPercentages.developers
                ],
                backgroundColor: [
                    '#4CAF50', // Green for organic
                    '#FF5252', // Red for snipers
                    '#FF9800', // Orange for bots
                    '#2196F3', // Blue for whales
                    '#9C27B0'  // Purple for developers
                ]
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
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            return `${label}: ${value.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}

// Render classifications table
function renderClassificationsTable(analysis) {
    const classifications = [
        {
            type: 'Organic',
            count: analysis.organic_count || analysis.holderCounts?.organic || 0,
            holdersPercent: calculatePercent(analysis.organic_count, analysis.holder_count),
            supplyPercent: analysis.organic_percentage || analysis.holdingPercentages?.organic || 0,
            risk: 'low'
        },
        {
            type: 'Snipers',
            count: analysis.sniper_count || analysis.holderCounts?.snipers || 0,
            holdersPercent: calculatePercent(analysis.sniper_count, analysis.holder_count),
            supplyPercent: analysis.sniper_percentage || analysis.holdingPercentages?.snipers || 0,
            risk: 'high'
        },
        {
            type: 'Bots',
            count: analysis.bot_count || analysis.holderCounts?.bots || 0,
            holdersPercent: calculatePercent(analysis.bot_count, analysis.holder_count),
            supplyPercent: analysis.bot_percentage || analysis.holdingPercentages?.bots || 0,
            risk: 'medium'
        },
        {
            type: 'Whales',
            count: analysis.whale_count || analysis.holderCounts?.whales || 0,
            holdersPercent: calculatePercent(analysis.whale_count, analysis.holder_count),
            supplyPercent: analysis.whale_percentage || analysis.holdingPercentages?.whales || 0,
            risk: 'medium'
        },
        {
            type: 'Developer',
            count: analysis.developer_count || analysis.holderCounts?.developers || 0,
            holdersPercent: calculatePercent(analysis.developer_count, analysis.holder_count),
            supplyPercent: analysis.developer_percentage || analysis.holdingPercentages?.developers || 0,
            risk: 'low'
        }
    ];
    
    const html = classifications.map(c => `
        <tr>
            <td>${c.type}</td>
            <td>${formatNumber(c.count, 0)}</td>
            <td>${c.holdersPercent.toFixed(1)}%</td>
            <td>${c.supplyPercent.toFixed(1)}%</td>
            <td><span class="risk-badge ${c.risk}">${c.risk.toUpperCase()}</span></td>
        </tr>
    `).join('');
    
    document.getElementById('classificationsBody').innerHTML = html;
}

// Render top holders
function renderTopHolders(holders) {
    if (!holders || holders.length === 0) {
        document.getElementById('topHoldersBody').innerHTML = '<tr><td colspan="6" style="text-align: center;">No holder data available</td></tr>';
        return;
    }
    
    const html = holders.slice(0, 20).map((holder, index) => `
        <tr>
            <td>${holder.rank || index + 1}</td>
            <td>
                <a href="https://solscan.io/account/${holder.wallet_address || holder.walletAddress}" 
                   target="_blank" class="address-link">
                    ${formatAddress(holder.wallet_address || holder.walletAddress)}
                </a>
            </td>
            <td>${formatNumber(holder.balance || 0, 0)}</td>
            <td>${(holder.percentage || holder.percentageHeld || 0).toFixed(2)}%</td>
            <td>
                <span class="type-badge ${getWalletTypeClass(holder.classification)}">
                    ${holder.classification || 'Unknown'}
                </span>
            </td>
            <td>${holder.first_acquired ? formatTimeAgo(holder.first_acquired) : '-'}</td>
        </tr>
    `).join('');
    
    document.getElementById('topHoldersBody').innerHTML = html;
}

// Initialize growth chart
function initializeGrowthChart(analysis) {
    const ctx = document.getElementById('growthChart').getContext('2d');
    
    // For now, show a placeholder
    // In a real implementation, this would fetch historical data
    if (growthChart) {
        growthChart.destroy();
    }
    
    growthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['7d ago', '6d ago', '5d ago', '4d ago', '3d ago', '2d ago', '1d ago', 'Today'],
            datasets: [{
                label: 'Holder Count',
                data: [100, 120, 150, 180, 220, 280, 350, analysis.holder_count || 0],
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0, 255, 136, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    grid: {
                        color: '#333'
                    },
                    ticks: {
                        color: '#888'
                    }
                },
                y: {
                    grid: {
                        color: '#333'
                    },
                    ticks: {
                        color: '#888'
                    }
                }
            }
        }
    });
}

// Monitor analysis job
async function monitorAnalysisJob(jobId) {
    const checkJob = async () => {
        try {
            const response = await fetch(`/api/holder-analysis/jobs/${jobId}`);
            const result = await response.json();
            
            if (result.success && result.job) {
                const job = result.job;
                
                if (job.status === 'completed') {
                    // Job completed, load the analysis
                    loadHolderAnalytics();
                } else if (job.status === 'failed') {
                    // Job failed
                    document.getElementById('holderScoreBadge').innerHTML = `
                        <div class="error">Analysis failed: ${job.error || 'Unknown error'}</div>
                        <button class="refresh-btn" onclick="loadHolderAnalytics()">Retry</button>
                    `;
                } else {
                    // Still processing, check again
                    document.getElementById('holderScoreBadge').innerHTML = `
                        <div class="spinner"></div>
                        <p>Analyzing holders... ${job.progress || 0}%</p>
                    `;
                    setTimeout(checkJob, 2000);
                }
            }
        } catch (error) {
            console.error('Error checking job status:', error);
        }
    };
    
    checkJob();
}

// Refresh holder analysis
async function refreshHolderAnalysis() {
    try {
        const response = await fetch('/api/holder-analysis/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mintAddress: mintAddress,
                priority: 'high'
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.jobId) {
            monitorAnalysisJob(result.jobId);
        }
    } catch (error) {
        console.error('Error refreshing analysis:', error);
    }
}

// Initialize WebSocket
function initializeWebSocket() {
    if (ws) {
        ws.close();
    }
    
    ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
        
        // Subscribe to token updates
        ws.send(JSON.stringify({
            type: 'subscribe',
            channel: 'token_analysis',
            mintAddress: mintAddress
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false);
        // Reconnect after 5 seconds
        setTimeout(initializeWebSocket, 5000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'analysis_complete':
            if (data.mintAddress === mintAddress) {
                // Reload holder analysis
                loadHolderAnalytics();
            }
            break;
        case 'price_update':
            if (data.mintAddress === mintAddress) {
                // Update price
                document.getElementById('priceUsd').textContent = `$${formatPrice(data.price)}`;
            }
            break;
        case 'sol_price':
            document.getElementById('solPrice').textContent = `SOL: $${data.price.toFixed(2)}`;
            break;
    }
}

// Utility functions
function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined) return '0';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '0';
    
    if (n >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
    return n.toFixed(decimals);
}

function formatPrice(price) {
    if (!price) return '0.00';
    const num = typeof price === 'string' ? parseFloat(price) : price;
    
    if (num < 0.00001) return num.toExponential(2);
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    return num.toFixed(2);
}

function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function calculatePercent(part, total) {
    if (!total || total === 0) return 0;
    return (part / total) * 100;
}

function getScoreRating(score) {
    if (score >= 250) return 'Excellent';
    if (score >= 200) return 'Good';
    if (score >= 150) return 'Fair';
    if (score >= 100) return 'Poor';
    return 'Critical';
}

function getWalletTypeClass(type) {
    const typeMap = {
        'organic': 'organic',
        'normal': 'organic',
        'sniper': 'sniper',
        'bot': 'bot',
        'whale': 'whale',
        'developer': 'developer'
    };
    return typeMap[type?.toLowerCase()] || 'organic';
}

function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
}

function updateConnectionStatus(isConnected) {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    if (isConnected) {
        statusDot.style.backgroundColor = '#4CAF50';
        statusText.textContent = 'Connected';
    } else {
        statusDot.style.backgroundColor = '#f44336';
        statusText.textContent = 'Disconnected';
    }
}

async function updateSolPrice() {
    try {
        const response = await fetch('/api/sol-price');
        const data = await response.json();
        document.getElementById('solPrice').textContent = `SOL: $${data.price.toFixed(2)}`;
    } catch (error) {
        console.error('Error fetching SOL price:', error);
    }
}

// Auto-refresh
function startAutoRefresh() {
    // Refresh every 30 seconds
    refreshInterval = setInterval(async () => {
        await loadTokenData();
        updateSolPrice();
    }, 30000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (ws) {
        ws.close();
    }
});

// Placeholder functions for other tabs
function renderOverview(data) {
    // TODO: Implement overview rendering
}

function renderTransactions(transactions) {
    // TODO: Implement transactions rendering
}

function renderPoolInfo(data) {
    // TODO: Implement pool info rendering
}

function initializePriceChart() {
    // TODO: Implement price chart
}