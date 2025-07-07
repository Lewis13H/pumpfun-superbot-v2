/**
 * Holder Analysis Dashboard JavaScript
 */

// Global variables
let currentToken = null;
let scoreGaugeChart = null;
let distributionChart = null;
let ws = null;
let reconnectInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeSearch();
    initializeCharts();
    loadTopTokens();
    loadJobQueue();
    loadSystemMetrics();
    updateSolPrice();
    connectWebSocket();
    
    // Periodic updates
    setInterval(loadJobQueue, 5000);
    setInterval(loadSystemMetrics, 10000);
    setInterval(updateSolPrice, 30000);
});

// Tab functionality
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            // Update active states
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`${targetTab}-tab`).classList.add('active');
            
            // Load data for specific tabs
            if (targetTab === 'top-tokens') {
                loadTopTokens();
            } else if (targetTab === 'jobs') {
                loadJobQueue();
            } else if (targetTab === 'metrics') {
                loadSystemMetrics();
            }
        });
    });
}

// Search functionality
function initializeSearch() {
    const searchInput = document.getElementById('token-search');
    const analyzeBtn = document.getElementById('analyze-btn');
    
    analyzeBtn.addEventListener('click', () => {
        const mintAddress = searchInput.value.trim();
        if (mintAddress) {
            analyzeToken(mintAddress);
        }
    });
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const mintAddress = searchInput.value.trim();
            if (mintAddress) {
                analyzeToken(mintAddress);
            }
        }
    });
}

// Initialize Chart.js charts
function initializeCharts() {
    // Score gauge chart
    const scoreCtx = document.getElementById('score-gauge').getContext('2d');
    scoreGaugeChart = new Chart(scoreCtx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, 300],
                backgroundColor: ['#00ff88', '#333'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            circumference: 180,
            rotation: -90,
            cutout: '80%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
    
    // Distribution chart
    const distCtx = document.getElementById('distribution-chart').getContext('2d');
    distributionChart = new Chart(distCtx, {
        type: 'bar',
        data: {
            labels: ['Top 10', 'Top 25', 'Top 50', 'Top 100', 'Others'],
            datasets: [{
                label: 'Percentage of Supply',
                data: [0, 0, 0, 0, 0],
                backgroundColor: '#00ff88',
                borderColor: '#00ff88',
                borderWidth: 1
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
                        callback: value => value + '%',
                        color: '#888'
                    },
                    grid: { color: '#333' }
                },
                x: {
                    ticks: { color: '#888' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Analyze token
async function analyzeToken(mintAddress) {
    const analyzeBtn = document.getElementById('analyze-btn');
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="loading-spinner"></span> Analyzing...';
    
    try {
        // Check if analysis exists
        const response = await fetch(`/api/holder-analysis/${mintAddress}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.data) {
                // Display existing analysis
                displayAnalysis(data.data);
            } else if (data.jobId) {
                // Monitor job progress
                monitorJob(data.jobId);
            }
        } else {
            showError('Failed to analyze token: ' + data.error);
        }
    } catch (error) {
        showError('Error analyzing token: ' + error.message);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze Token';
    }
}

// Display analysis results
function displayAnalysis(analysis) {
    currentToken = analysis;
    
    // Show analysis section
    document.getElementById('analysis-result').style.display = 'block';
    document.getElementById('analysis-empty').style.display = 'none';
    
    // Update token info
    document.getElementById('token-name').textContent = 
        `${analysis.symbol || 'Unknown'} - ${analysis.name || 'Token Analysis'}`;
    
    // Update score
    const score = analysis.holder_score || 0;
    updateScoreGauge(score);
    
    // Update metrics
    document.getElementById('holder-count').textContent = 
        analysis.holder_count?.toLocaleString() || '--';
    document.getElementById('top-10-percentage').textContent = 
        (analysis.top_10_percentage || 0).toFixed(1) + '%';
    document.getElementById('bot-percentage').textContent = 
        (analysis.bot_percentage || 0).toFixed(1) + '%';
    document.getElementById('sniper-percentage').textContent = 
        (analysis.sniper_percentage || 0).toFixed(1) + '%';
    document.getElementById('developer-percentage').textContent = 
        (analysis.developer_percentage || 0).toFixed(1) + '%';
    document.getElementById('gini-coefficient').textContent = 
        (analysis.gini_coefficient || 0).toFixed(3);
    
    // Update distribution chart
    updateDistributionChart(analysis);
    
    // Load top holders
    loadTopHolders(analysis.mint_address);
}

// Update score gauge
function updateScoreGauge(score) {
    document.getElementById('score-value').textContent = Math.round(score);
    
    // Update rating
    let rating, ratingClass;
    if (score >= 250) {
        rating = 'Excellent';
        ratingClass = 'excellent';
    } else if (score >= 200) {
        rating = 'Good';
        ratingClass = 'good';
    } else if (score >= 150) {
        rating = 'Fair';
        ratingClass = 'fair';
    } else if (score >= 100) {
        rating = 'Poor';
        ratingClass = 'poor';
    } else {
        rating = 'Critical';
        ratingClass = 'critical';
    }
    
    const ratingEl = document.getElementById('score-rating');
    ratingEl.textContent = rating;
    ratingEl.className = `score-rating ${ratingClass}`;
    
    // Update gauge chart
    scoreGaugeChart.data.datasets[0].data = [score, 300 - score];
    scoreGaugeChart.data.datasets[0].backgroundColor = [
        getScoreColor(score),
        '#333'
    ];
    scoreGaugeChart.update();
}

// Get color based on score
function getScoreColor(score) {
    if (score >= 250) return '#00ff88';
    if (score >= 200) return '#88ff00';
    if (score >= 150) return '#ffff00';
    if (score >= 100) return '#ff8800';
    return '#ff0088';
}

// Update distribution chart
function updateDistributionChart(analysis) {
    const top10 = analysis.top_10_percentage || 0;
    const top25 = analysis.top_25_percentage || 0;
    const top50 = analysis.top_50_percentage || 0;
    const top100 = analysis.top_100_percentage || 0;
    
    distributionChart.data.datasets[0].data = [
        top10,
        top25 - top10,
        top50 - top25,
        top100 - top50,
        100 - top100
    ];
    distributionChart.update();
}

// Load top holders
async function loadTopHolders(mintAddress) {
    try {
        const response = await fetch(`/api/holder-analysis/distribution/${mintAddress}`);
        const data = await response.json();
        
        if (data.success) {
            displayTopHolders(data.holders);
        }
    } catch (error) {
        console.error('Error loading holders:', error);
    }
}

// Display top holders
function displayTopHolders(holders) {
    const tbody = document.getElementById('holders-tbody');
    tbody.innerHTML = '';
    
    holders.slice(0, 20).forEach(holder => {
        const tr = document.createElement('tr');
        
        const walletShort = holder.wallet_address.substring(0, 6) + '...' + 
                          holder.wallet_address.substring(holder.wallet_address.length - 4);
        
        const walletType = holder.classification?.classification || 'unknown';
        const confidence = holder.classification?.confidence_score || 0;
        
        tr.innerHTML = `
            <td>${holder.rank}</td>
            <td>
                <a href="https://solscan.io/account/${holder.wallet_address}" 
                   target="_blank" 
                   style="color: #00ff88;">
                    ${walletShort}
                </a>
            </td>
            <td>${parseFloat(holder.balance).toLocaleString()}</td>
            <td>${parseFloat(holder.percentage).toFixed(2)}%</td>
            <td>
                <span class="wallet-type ${walletType.toLowerCase()}" 
                      title="Confidence: ${(confidence * 100).toFixed(0)}%">
                    ${walletType}
                </span>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Load top tokens
async function loadTopTokens() {
    try {
        const response = await fetch('/api/holder-analysis/top-tokens?limit=20');
        const data = await response.json();
        
        if (data.success) {
            displayTopTokens(data.tokens);
        }
    } catch (error) {
        console.error('Error loading top tokens:', error);
    }
}

// Display top tokens
function displayTopTokens(tokens) {
    const grid = document.getElementById('top-tokens-grid');
    grid.innerHTML = '';
    
    tokens.forEach(token => {
        const card = document.createElement('div');
        card.className = 'token-card';
        card.onclick = () => {
            document.getElementById('token-search').value = token.mint_address;
            analyzeToken(token.mint_address);
            document.querySelector('[data-tab="analysis"]').click();
        };
        
        const scoreClass = getScoreClass(token.holder_score);
        
        card.innerHTML = `
            <div class="token-header">
                <img src="${token.image_uri || 'placeholder.png'}" 
                     alt="${token.symbol}" 
                     class="token-icon"
                     onerror="this.src='placeholder.png'">
                <div class="token-info">
                    <h4>${token.symbol || 'Unknown'}</h4>
                    <span>${token.name || 'Unknown Token'}</span>
                </div>
            </div>
            <div class="metric-row">
                <span class="metric-label">Holder Score</span>
                <span class="metric-value ${scoreClass}">${Math.round(token.holder_score)}/300</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Holders</span>
                <span class="metric-value">${token.holder_count?.toLocaleString() || '--'}</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Top 10</span>
                <span class="metric-value">${(token.top_10_percentage || 0).toFixed(1)}%</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Market Cap</span>
                <span class="metric-value">$${formatNumber(token.current_market_cap_usd)}</span>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

// Get score class
function getScoreClass(score) {
    if (score >= 250) return 'excellent';
    if (score >= 200) return 'good';
    if (score >= 150) return 'fair';
    if (score >= 100) return 'poor';
    return 'critical';
}

// Load job queue
async function loadJobQueue() {
    try {
        const response = await fetch('/api/holder-analysis/jobs');
        const data = await response.json();
        
        if (data.success) {
            updateJobStats(data.stats);
            displayJobs(data.jobs);
        }
    } catch (error) {
        console.error('Error loading jobs:', error);
    }
}

// Update job stats
function updateJobStats(stats) {
    document.getElementById('queue-depth').textContent = stats.waiting || 0;
    document.getElementById('jobs-waiting').textContent = stats.waiting || 0;
    document.getElementById('jobs-active').textContent = stats.active || 0;
    document.getElementById('jobs-completed').textContent = stats.completed || 0;
    document.getElementById('jobs-failed').textContent = stats.failed || 0;
}

// Display jobs
function displayJobs(jobs) {
    const container = document.getElementById('jobs-list');
    container.innerHTML = '';
    
    jobs.slice(0, 10).forEach(job => {
        const item = document.createElement('div');
        item.className = 'job-item';
        
        const typeLabel = job.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const createdAt = new Date(job.createdAt).toLocaleTimeString();
        
        item.innerHTML = `
            <div>
                <strong>${typeLabel}</strong>
                <div style="color: #888; font-size: 12px;">
                    ID: ${job.id.substring(0, 8)}... | Created: ${createdAt}
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="job-status ${job.status}">${job.status}</span>
                ${job.progress ? `<span>${job.progress}%</span>` : ''}
            </div>
        `;
        
        container.appendChild(item);
    });
}

// Load system metrics
async function loadSystemMetrics() {
    try {
        const response = await fetch('/api/holder-analysis/metrics');
        const data = await response.json();
        
        if (data.success) {
            updateSystemMetrics(data);
        }
    } catch (error) {
        console.error('Error loading metrics:', error);
    }
}

// Update system metrics
function updateSystemMetrics(data) {
    // Update health score
    const healthScore = data.summary?.healthScore || 0;
    const healthEl = document.getElementById('health-score');
    healthEl.textContent = healthScore + '/100';
    healthEl.className = `stat-value ${getScoreClass(healthScore * 3)}`; // Scale to 300
    
    // Performance metrics
    const perfEl = document.getElementById('performance-metrics');
    perfEl.innerHTML = `
        <div class="metric-row">
            <span class="metric-label">Throughput</span>
            <span class="metric-value">${(data.current?.performance?.throughput || 0).toFixed(1)} jobs/min</span>
        </div>
        <div class="metric-row">
            <span class="metric-label">Avg Processing Time</span>
            <span class="metric-value">${formatDuration(data.current?.queue?.averageProcessingTime || 0)}</span>
        </div>
        <div class="metric-row">
            <span class="metric-label">Success Rate</span>
            <span class="metric-value">${(data.current?.performance?.successRate || 0).toFixed(1)}%</span>
        </div>
        <div class="metric-row">
            <span class="metric-label">Uptime</span>
            <span class="metric-value">${formatDuration(data.summary?.uptime || 0)}</span>
        </div>
    `;
    
    // Worker status
    const workerEl = document.getElementById('worker-status');
    workerEl.innerHTML = '';
    
    (data.current?.workers || []).forEach(worker => {
        workerEl.innerHTML += `
            <div class="metric-row">
                <span class="metric-label">${worker.id}</span>
                <span class="metric-value ${worker.status === 'busy' ? 'busy' : 'idle'}">
                    ${worker.status} | ${worker.jobsProcessed} jobs | ${worker.errors} errors
                </span>
            </div>
        `;
    });
}

// Monitor job progress
async function monitorJob(jobId) {
    const checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/holder-analysis/jobs/${jobId}`);
            const data = await response.json();
            
            if (data.success && data.job) {
                if (data.job.status === 'completed') {
                    clearInterval(checkInterval);
                    if (data.job.result) {
                        displayAnalysis(data.job.result);
                    }
                } else if (data.job.status === 'failed') {
                    clearInterval(checkInterval);
                    showError('Analysis failed: ' + data.job.error);
                }
            }
        } catch (error) {
            clearInterval(checkInterval);
            showError('Error monitoring job: ' + error.message);
        }
    }, 2000);
}

// WebSocket connection
function connectWebSocket() {
    const wsUrl = window.location.protocol === 'https:' 
        ? `wss://${window.location.host}/ws`
        : `ws://${window.location.host}/ws`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            updateConnectionStatus(true);
            
            // Subscribe to holder analysis events
            ws.send(JSON.stringify({
                type: 'subscribe',
                channel: 'holder_analysis'
            }));
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            updateConnectionStatus(false);
            scheduleReconnect();
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };
    } catch (error) {
        console.error('Failed to connect WebSocket:', error);
        updateConnectionStatus(false);
        scheduleReconnect();
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'job_update':
            if (currentToken && data.mintAddress === currentToken.mint_address) {
                updateAnalysisProgress(data);
            }
            break;
        
        case 'analysis_complete':
            if (currentToken && data.mintAddress === currentToken.mint_address) {
                displayAnalysis(data.analysis);
            }
            break;
        
        case 'metrics_update':
            updateSystemMetrics(data.metrics);
            break;
    }
}

// Schedule reconnect
function scheduleReconnect() {
    if (reconnectInterval) return;
    
    reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
    }, 5000);
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');
    
    if (connected) {
        dot.style.background = '#00ff88';
        text.textContent = 'Connected';
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    } else {
        dot.style.background = '#ff0088';
        text.textContent = 'Disconnected';
    }
}

// Update SOL price
async function updateSolPrice() {
    try {
        const response = await fetch('/api/tokens/sol-price');
        const data = await response.json();
        
        if (data.price) {
            document.getElementById('sol-price').textContent = `$${data.price.toFixed(2)}`;
        }
    } catch (error) {
        console.error('Error fetching SOL price:', error);
    }
}

// Utility functions
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
    return (ms / 3600000).toFixed(1) + 'h';
}

function showError(message) {
    // You could implement a toast notification here
    console.error(message);
    alert(message);
}