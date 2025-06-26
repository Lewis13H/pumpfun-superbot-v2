// Dashboard JavaScript
const API_ENDPOINT = 'http://localhost:3001/api/tokens';
const STATUS_ENDPOINT = 'http://localhost:3001/api/status';
const REFRESH_INTERVAL = 3000; // 3 seconds
const STATUS_INTERVAL = 5000; // 5 seconds
const TOKENS_PER_PAGE = 100;

let refreshTimer;
let statusTimer;
let currentFilter = '24h';
let currentPage = 1;
let allTokens = [];
let totalPages = 1;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    loadTokens();
    loadStatus();
    setupEventListeners();
    startAutoRefresh();
    startStatusRefresh();
});

// Setup event listeners
function setupEventListeners() {
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            loadTokens();
        });
    });
}

// Start auto-refresh
function startAutoRefresh() {
    refreshTimer = setInterval(() => {
        loadTokens();
    }, REFRESH_INTERVAL);
}

// Start status refresh
function startStatusRefresh() {
    statusTimer = setInterval(() => {
        loadStatus();
    }, STATUS_INTERVAL);
}

// Load system status
async function loadStatus() {
    try {
        const response = await fetch(STATUS_ENDPOINT);
        const data = await response.json();
        
        if (data.success) {
            // Update SOL price
            const solPriceEl = document.getElementById('sol-price');
            const priceSourceEl = document.getElementById('price-source');
            if (solPriceEl) {
                solPriceEl.textContent = `$${data.sol_price.price.toFixed(2)}`;
                if (priceSourceEl) {
                    priceSourceEl.textContent = `(${data.sol_price.source})`;
                }
            }
            
            // Update connection status
            const connectionDot = document.getElementById('connection-dot');
            const connectionStatus = document.getElementById('connection-status');
            if (connectionDot && connectionStatus) {
                if (data.connection.status === 'connected') {
                    connectionDot.classList.remove('disconnected');
                    connectionDot.classList.add('connected');
                    connectionStatus.textContent = 'Connected';
                } else {
                    connectionDot.classList.remove('connected');
                    connectionDot.classList.add('disconnected');
                    connectionStatus.textContent = 'Disconnected';
                }
            }
            
            // Update stats
            const totalTokensEl = document.getElementById('total-tokens');
            const hourlyUpdatesEl = document.getElementById('hourly-updates');
            if (totalTokensEl) {
                totalTokensEl.textContent = data.stats.total_tokens.toLocaleString();
            }
            if (hourlyUpdatesEl) {
                hourlyUpdatesEl.textContent = data.stats.hourly_updates.toLocaleString();
            }
        }
    } catch (error) {
        console.error('Error loading status:', error);
        // Update connection status to error
        const connectionDot = document.getElementById('connection-dot');
        const connectionStatus = document.getElementById('connection-status');
        if (connectionDot && connectionStatus) {
            connectionDot.classList.remove('connected');
            connectionDot.classList.add('disconnected');
            connectionStatus.textContent = 'Error';
        }
    }
}

// Load tokens from API
async function loadTokens() {
    const spinner = document.getElementById('spinner');
    spinner.classList.add('active');
    
    try {
        const response = await fetch(API_ENDPOINT);
        const data = await response.json();
        
        allTokens = data.tokens || [];
        totalPages = Math.ceil(allTokens.length / TOKENS_PER_PAGE);
        
        // Reset to page 1 if current page is out of bounds
        if (currentPage > totalPages) {
            currentPage = 1;
        }
        
        displayTokens();
        updateStats(data);
        updatePagination();
        
        document.getElementById('last-update').textContent = 
            `Last update: ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error('Error loading tokens:', error);
        displayError('Failed to load tokens. Please check if the server is running.');
    } finally {
        spinner.classList.remove('active');
    }
}

// Display tokens in table
function displayTokens() {
    const tbody = document.getElementById('token-list');
    
    if (!allTokens || allTokens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="loading">No tokens found</td></tr>';
        return;
    }
    
    // Calculate pagination
    const startIndex = (currentPage - 1) * TOKENS_PER_PAGE;
    const endIndex = startIndex + TOKENS_PER_PAGE;
    const tokens = allTokens.slice(startIndex, endIndex);
    
    tbody.innerHTML = tokens.map((token, index) => `
        <tr onclick="window.open('https://pump.fun/${token.address}', '_blank')" style="cursor: pointer;" title="${token.address}">
            <td>
                <div class="token-info">
                    <div class="token-icon">${getTokenIcon(token)}</div>
                    <div class="token-details">
                        <div class="symbol">${token.symbol || 'Unknown'}</div>
                        <div class="name">${token.name || 'Unnamed Token'}</div>
                    </div>
                </div>
            </td>
            <td class="price">$${formatPrice(token.price_usd)}</td>
            <td class="age">${formatAge(token.age)}</td>
            <td class="holder-count">${token.holder_count || '-'}</td>
            <td class="top-holder ${getTopHolderClass(token.top_holder_percentage)}">${token.top_holder_percentage ? token.top_holder_percentage.toFixed(1) + '%' : '-'}</td>
            <td>${token.volume_24h ? formatVolume(token.volume_24h) : '-'}</td>
            <td class="change ${getChangeClass(token.change_5m)}">${formatChange(token.change_5m)}</td>
            <td class="change ${getChangeClass(token.change_1h)}">${formatChange(token.change_1h)}</td>
            <td class="change ${getChangeClass(token.change_6h)}">${formatChange(token.change_6h)}</td>
            <td class="change ${getChangeClass(token.change_24h)}">${formatChange(token.change_24h)}</td>
            <td>${token.liquidity ? formatLiquidity(token.liquidity) : '-'}</td>
            <td>
                $${formatMarketCap(token.market_cap_usd)}
                ${token.progress ? getProgressBar(token.progress) : ''}
            </td>
        </tr>
    `).join('');
}

// Helper functions
function getTokenIcon(token) {
    if (token.symbol) {
        return token.symbol.substring(0, 2).toUpperCase();
    }
    return '?';
}

function formatPrice(price) {
    if (!price) return '0.00';
    if (price < 0.00001) return price.toExponential(2);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
}

function formatAge(ageInSeconds) {
    if (!ageInSeconds) return '-';
    
    const seconds = Math.floor(ageInSeconds);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

function formatVolume(volume) {
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(1)}K`;
    return `$${volume.toFixed(0)}`;
}

function formatChange(change) {
    if (change === null || change === undefined) return '-';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
}

function getChangeClass(change) {
    if (change === null || change === undefined) return 'neutral';
    if (change > 0) return 'positive';
    if (change < 0) return 'negative';
    return 'neutral';
}

function getTopHolderClass(percentage) {
    if (!percentage) return '';
    if (percentage > 50) return 'high';  // Red - high concentration
    if (percentage > 25) return 'medium'; // Yellow - medium concentration
    return 'low'; // Green - good distribution
}

function formatLiquidity(liquidity) {
    if (liquidity >= 1000) return `$${(liquidity / 1000).toFixed(0)}K`;
    return `$${liquidity.toFixed(0)}`;
}

function formatMarketCap(mcap) {
    if (!mcap) return '0';
    if (mcap >= 1000000) return `${(mcap / 1000000).toFixed(1)}M`;
    if (mcap >= 1000) return `${(mcap / 1000).toFixed(0)}K`;
    return mcap.toFixed(0);
}

function getProgressBar(progress) {
    return `
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
        </div>
    `;
}

function updateStats(data) {
    document.getElementById('token-count').textContent = data.tokens?.length || 0;
}

function displayError(message) {
    const tbody = document.getElementById('token-list');
    tbody.innerHTML = `<tr><td colspan="12" class="error">${message}</td></tr>`;
}

// Update pagination controls
function updatePagination() {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;
    
    let paginationHTML = '<div class="pagination-controls">';
    
    // Previous button
    if (currentPage > 1) {
        paginationHTML += `<button class="page-btn" onclick="changePage(${currentPage - 1})">← Previous</button>`;
    } else {
        paginationHTML += `<button class="page-btn disabled" disabled>← Previous</button>`;
    }
    
    // Page numbers
    paginationHTML += '<div class="page-numbers">';
    
    // Show first page
    if (currentPage > 3) {
        paginationHTML += `<button class="page-btn" onclick="changePage(1)">1</button>`;
        if (currentPage > 4) {
            paginationHTML += `<span class="page-dots">...</span>`;
        }
    }
    
    // Show nearby pages
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        if (i === currentPage) {
            paginationHTML += `<button class="page-btn active">${i}</button>`;
        } else {
            paginationHTML += `<button class="page-btn" onclick="changePage(${i})">${i}</button>`;
        }
    }
    
    // Show last page
    if (currentPage < totalPages - 2) {
        if (currentPage < totalPages - 3) {
            paginationHTML += `<span class="page-dots">...</span>`;
        }
        paginationHTML += `<button class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
    }
    
    paginationHTML += '</div>';
    
    // Next button
    if (currentPage < totalPages) {
        paginationHTML += `<button class="page-btn" onclick="changePage(${currentPage + 1})">Next →</button>`;
    } else {
        paginationHTML += `<button class="page-btn disabled" disabled>Next →</button>`;
    }
    
    // Page info
    paginationHTML += `<div class="page-info">Page ${currentPage} of ${totalPages}</div>`;
    
    paginationHTML += '</div>';
    
    paginationContainer.innerHTML = paginationHTML;
}

// Change page
function changePage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    displayTokens();
    updatePagination();
    
    // Scroll to top of table
    document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth' });
}