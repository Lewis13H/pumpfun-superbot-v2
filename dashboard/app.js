// Configuration
const API_BASE = '/api';
const UPDATE_INTERVAL = 10000; // 10 seconds

// State
let tokens = [];
let filteredTokens = [];
let sortColumn = 'latest_market_cap_usd';
let sortDirection = 'desc';
let filters = {
    search: '',
    platform: 'all',
    mcapMin: 8888,
    mcapMax: null,
    priceChange: 'all',
    age: 'all',
    liquidityMin: null,
    liquidityMax: null,
    recentlyGraduated: false,
    nearGraduation: false,
    highVolume: false,
    manyHolders: false
};

// DOM Elements
let tokenTableBody;
let loadingSpinner;
let tokenCount;
let totalVolume;
let searchInput;
let mcapMinInput;
let mcapMaxInput;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    tokenTableBody = document.getElementById('tokenTableBody');
    loadingSpinner = document.getElementById('loadingSpinner');
    tokenCount = document.querySelector('.stat-value[data-stat="token-count"]');
    totalVolume = document.querySelector('.stat-value[data-stat="total-volume"]');
    searchInput = document.getElementById('searchInput');
    mcapMinInput = document.getElementById('mcapMin');
    mcapMaxInput = document.getElementById('mcapMax');

    // Restore sidebar state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
    
    // Initial load
    loadTokens();
    loadStatus();
    
    // Set up auto-refresh
    setInterval(loadTokens, UPDATE_INTERVAL);
    setInterval(loadStatus, UPDATE_INTERVAL);
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up navigation
    setupNavigation();
});

// Sidebar toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    
    // Save state to localStorage
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed);
}

// Setup event listeners
function setupEventListeners() {
    // Search
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            filters.search = searchInput.value.toLowerCase();
            applyFilters();
        }, 300));
    }

    // Market cap range
    if (mcapMinInput) {
        mcapMinInput.addEventListener('input', debounce(() => {
            filters.mcapMin = parseFloat(mcapMinInput.value) || 0;
            applyFilters();
        }, 300));
    }

    if (mcapMaxInput) {
        mcapMaxInput.addEventListener('input', debounce(() => {
            filters.mcapMax = parseFloat(mcapMaxInput.value) || null;
            applyFilters();
        }, 300));
    }

    // Platform filters
    document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleFilterChange);
    });

    // Price change pills
    document.querySelectorAll('.filter-pill[data-filter="price-change"]').forEach(pill => {
        pill.addEventListener('click', handlePriceChangePill);
    });

    // Age pills
    document.querySelectorAll('.filter-pill[data-filter="age"]').forEach(pill => {
        pill.addEventListener('click', handleAgePill);
    });

    // Sort headers
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', handleSort);
    });

    // Keyboard shortcut (Ctrl/Cmd + B)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
    });
}

// Load tokens from API
async function loadTokens() {
    try {
        const response = await fetch(`${API_BASE}/tokens`);
        if (!response.ok) throw new Error('Failed to fetch tokens');
        
        const data = await response.json();
        tokens = data;
        applyFilters();
    } catch (error) {
        console.error('Error loading tokens:', error);
        showError('Failed to load tokens');
    }
}

// Load status
async function loadStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        if (!response.ok) throw new Error('Failed to fetch status');
        
        const data = await response.json();
        
        // Update SOL price in header
        const headerSolPrice = document.getElementById('header-sol-price');
        if (headerSolPrice) {
            headerSolPrice.textContent = `$${data.sol_price.price.toFixed(2)}`;
        }
        
        // Update connection status
        updateConnectionStatus(true);
        
        // Also check BC Monitor status if available
        if (window.bcMonitor && window.bcMonitor.isConnected) {
            updateConnectionStatus(true, 'BC Monitor Connected');
        }
    } catch (error) {
        console.error('Error loading status:', error);
        updateConnectionStatus(false);
    }
}

// Update connection status indicator
function updateConnectionStatus(isConnected, text = null) {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    if (statusDot) {
        if (isConnected) {
            statusDot.classList.add('connected');
        } else {
            statusDot.classList.remove('connected');
        }
    }
    
    if (statusText) {
        if (text) {
            statusText.textContent = text;
        } else {
            statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
        }
    }
}

// Apply filters
function applyFilters() {
    filteredTokens = tokens.filter(token => {
        // Search filter
        if (filters.search) {
            const searchTerm = filters.search.toLowerCase();
            if (!token.symbol?.toLowerCase().includes(searchTerm) &&
                !token.name?.toLowerCase().includes(searchTerm) &&
                !token.mint_address?.toLowerCase().includes(searchTerm)) {
                return false;
            }
        }
        
        // Market cap filter
        const mcap = parseFloat(token.latest_market_cap_usd) || 0;
        if (mcap < filters.mcapMin || (filters.mcapMax && mcap > filters.mcapMax)) {
            return false;
        }
        
        // Platform filter
        if (filters.platform !== 'all') {
            if (filters.platform === 'pump' && token.graduated_to_amm) return false;
            if (filters.platform === 'amm' && !token.graduated_to_amm) return false;
        }
        
        // Quick filters
        if (filters.recentlyGraduated && !token.graduated_to_amm) return false;
        if (filters.nearGraduation && (token.graduated_to_amm || token.latest_bonding_curve_progress < 90)) return false;
        if (filters.highVolume && token.volume_24h_usd < 100000) return false;
        if (filters.manyHolders && token.holder_count < 1000) return false;
        
        return true;
    });
    
    sortTokens();
    renderTokens();
    updateStats();
}

// Sort tokens
function sortTokens() {
    filteredTokens.sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];
        
        // Handle numeric values
        if (typeof aVal === 'string' && !isNaN(parseFloat(aVal))) {
            aVal = parseFloat(aVal);
            bVal = parseFloat(bVal);
        }
        
        // Handle null/undefined
        if (aVal == null) aVal = 0;
        if (bVal == null) bVal = 0;
        
        if (sortDirection === 'desc') {
            return aVal > bVal ? -1 : 1;
        } else {
            return aVal < bVal ? -1 : 1;
        }
    });
}

// Render tokens
function renderTokens() {
    if (!tokenTableBody) return;
    
    if (filteredTokens.length === 0) {
        tokenTableBody.innerHTML = '<tr><td colspan="10" class="no-data">No tokens found</td></tr>';
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        return;
    }
    
    tokenTableBody.innerHTML = filteredTokens.map((token, index) => {
        const priceUsd = parseFloat(token.latest_price_usd) || 0;
        const marketCap = parseFloat(token.latest_market_cap_usd) || 0;
        const volume24h = parseFloat(token.volume_24h_usd) || 0;
        const priceChange = calculatePriceChange(token);
        const age = formatAge(token.first_seen_at);
        const progress = parseFloat(token.latest_bonding_curve_progress) || 0;
        const isGraduated = token.graduated_to_amm;
        const program = isGraduated ? 'amm_pool' : 'bonding_curve';
        
        // Get token icon - use image_uri if available, otherwise first letter
        const iconContent = token.image_uri 
            ? `<img src="${token.image_uri}" alt="${token.symbol}" onerror="this.style.display='none'; this.parentElement.textContent='${token.symbol?.charAt(0) || '?'}';">`
            : (token.symbol?.charAt(0) || '?');
        
        return `
            <tr data-mint="${token.mint_address}">
                <td>${index + 1}</td>
                <td>
                    <div class="token-info">
                        <div class="token-icon">${iconContent}</div>
                        <div class="token-details">
                            <div class="token-symbol">${token.symbol || 'Unknown'}</div>
                            <div class="token-meta">
                                <span>${token.name || 'No name'}</span>
                                <span class="pair-badge">${token.symbol || '???'}/SOL</span>
                                <span style="color: ${isGraduated ? 'var(--purple)' : 'var(--yellow)'};">
                                    ${isGraduated ? 'AMM' : `PUMP ${progress.toFixed(0)}%`}
                                </span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="mcap-cell">
                    <div>$${formatNumber(marketCap)}</div>
                    <div class="fdv-label">FDV $${formatNumber(marketCap * 10)}</div>
                </td>
                <td class="price-cell">
                    <div class="price-value">$${formatPrice(priceUsd)}</div>
                </td>
                <td class="price-cell">
                    <div class="price-change ${priceChange >= 0 ? 'change-positive' : 'change-negative'}">
                        <span>${priceChange >= 0 ? '↑' : '↓'}</span>
                        <span>${Math.abs(priceChange).toFixed(2)}%</span>
                    </div>
                </td>
                <td class="age-cell">${age}</td>
                <td class="liquidity-cell">$${formatNumber(marketCap * 0.1)}</td>
                <td class="volume-cell">
                    <div class="volume-value">$${formatNumber(volume24h)}</div>
                    <div class="volume-bar">
                        <div class="volume-fill" style="width: ${Math.min(100, volume24h / 1000000 * 100)}%;"></div>
                    </div>
                </td>
                <td>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${isGraduated ? 'complete' : ''}" 
                                 style="width: ${isGraduated ? 100 : progress}%;"></div>
                        </div>
                        <span class="progress-text">${isGraduated ? 'GRAD' : `${progress.toFixed(0)}%`}</span>
                    </div>
                </td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        <span class="holder-count">${token.holder_count || '-'}</span>
                        <a href="https://pump.fun/coin/${token.mint_address}" 
                           target="_blank" 
                           rel="noopener noreferrer" 
                           class="pump-link"
                           title="View on pump.fun">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (loadingSpinner) loadingSpinner.style.display = 'none';
}

// Update stats
function updateStats() {
    if (tokenCount) {
        tokenCount.textContent = `${filteredTokens.length} tokens`;
    }
    
    if (totalVolume) {
        const totalVol = filteredTokens.reduce((sum, token) => 
            sum + (parseFloat(token.volume_24h_usd) || 0), 0
        );
        totalVolume.textContent = `$${formatNumber(totalVol)}`;
    }
}

// Event Handlers
function handleFilterChange(e) {
    const checkbox = e.target;
    const filterName = checkbox.getAttribute('data-filter');
    
    if (filterName === 'platform-all') {
        filters.platform = checkbox.checked ? 'all' : filters.platform;
    } else if (filterName === 'platform-pump') {
        filters.platform = checkbox.checked ? 'pump' : 'all';
    } else if (filterName === 'platform-amm') {
        filters.platform = checkbox.checked ? 'amm' : 'all';
    } else if (filterName === 'recently-graduated') {
        filters.recentlyGraduated = checkbox.checked;
    } else if (filterName === 'near-graduation') {
        filters.nearGraduation = checkbox.checked;
    } else if (filterName === 'high-volume') {
        filters.highVolume = checkbox.checked;
    } else if (filterName === 'many-holders') {
        filters.manyHolders = checkbox.checked;
    }
    
    applyFilters();
}

function handlePriceChangePill(e) {
    const pill = e.target;
    const value = pill.getAttribute('data-value');
    
    // Remove active from all price pills
    document.querySelectorAll('.filter-pill[data-filter="price-change"]').forEach(p => 
        p.classList.remove('active')
    );
    
    pill.classList.add('active');
    filters.priceChange = value;
    applyFilters();
}

function handleAgePill(e) {
    const pill = e.target;
    const value = pill.getAttribute('data-value');
    
    // Remove active from all age pills
    document.querySelectorAll('.filter-pill[data-filter="age"]').forEach(p => 
        p.classList.remove('active')
    );
    
    pill.classList.add('active');
    filters.age = value;
    applyFilters();
}

function handleSort(e) {
    const th = e.target;
    const column = th.getAttribute('data-sort');
    
    if (!column) return;
    
    if (sortColumn === column) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
        sortColumn = column;
        sortDirection = 'desc';
    }
    
    // Update UI
    document.querySelectorAll('.sortable').forEach(el => {
        el.classList.remove('sorted-desc', 'sorted-asc');
    });
    th.classList.add(`sorted-${sortDirection}`);
    
    sortTokens();
    renderTokens();
}

// Helper functions
function formatPrice(price) {
    if (price >= 1) return price.toFixed(2);
    if (price >= 0.01) return price.toFixed(4);
    if (price >= 0.0001) return price.toFixed(6);
    if (price >= 0.000001) return price.toFixed(8);
    if (price >= 0.00000001) return price.toFixed(10);
    // For extremely small numbers, show up to 12 decimal places
    return price.toFixed(12);
}

function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

function formatAge(timestamp) {
    const now = Date.now();
    const age = now - new Date(timestamp).getTime();
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}

function calculatePriceChange(token) {
    // Use first price vs current price for now
    const firstPrice = parseFloat(token.first_price_usd) || 0;
    const currentPrice = parseFloat(token.latest_price_usd) || 0;
    
    if (firstPrice === 0) return 0;
    return ((currentPrice - firstPrice) / firstPrice) * 100;
}

function showError(message) {
    if (tokenTableBody) {
        tokenTableBody.innerHTML = `<tr><td colspan="10" class="no-data" style="color: var(--red);">${message}</td></tr>`;
    }
    if (loadingSpinner) loadingSpinner.style.display = 'none';
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Navigation setup
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-view]');
    const tokenListContainer = document.querySelector('.token-list-container');
    const bcMonitorSection = document.getElementById('bc-monitor-section');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Get view name
            const view = link.getAttribute('data-view');
            
            // Show/hide appropriate sections
            if (view === 'bc-monitor') {
                // Show BC Monitor section
                tokenListContainer.style.display = 'none';
                if (document.getElementById('sidebar')) {
                    document.getElementById('sidebar').style.display = 'none';
                }
                bcMonitorSection.style.display = 'block';
                
                // Initialize BC Monitor client if not already done
                if (!window.bcMonitor) {
                    window.bcMonitor = new BCMonitorClient();
                }
            } else {
                // Show tokens view
                tokenListContainer.style.display = 'flex';
                if (document.getElementById('sidebar')) {
                    document.getElementById('sidebar').style.display = 'block';
                }
                bcMonitorSection.style.display = 'none';
            }
        });
    });
}