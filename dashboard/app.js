// Configuration
const API_BASE = '/api';
const UPDATE_INTERVAL = 3000; // 3 seconds for more responsive updates
const USE_REALTIME_PRICES = true; // Toggle to use real-time price endpoint

// State
let tokens = [];
let filteredTokens = [];
let sortColumn = 'latest_market_cap_usd';
let sortDirection = 'desc';
let tokenView = 'new'; // 'new' or 'graduated'
let currentSolPrice = 0; // Store current SOL price
let filters = {
    search: '',
    platform: 'all',
    mcapMin: 8888,
    mcapMax: null,
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
let searchInput;
let mcapMinInput;
let mcapMaxInput;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    tokenTableBody = document.getElementById('tokenTableBody');
    loadingSpinner = document.getElementById('loadingSpinner');
    tokenCount = document.querySelector('.stat-value[data-stat="token-count"]');
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


    // Age pills
    document.querySelectorAll('.filter-pill[data-filter="age"]').forEach(pill => {
        pill.addEventListener('click', handleAgePill);
    });

    // Sort headers
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', handleSort);
    });

    // Token type toggle
    document.querySelectorAll('.token-type-option').forEach(button => {
        button.addEventListener('click', handleTokenTypeToggle);
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
        // Use real-time endpoint if enabled, otherwise fall back to standard endpoint
        let endpoint = USE_REALTIME_PRICES ? `${API_BASE}/tokens/realtime` : `${API_BASE}/tokens`;
        let response = await fetch(endpoint);
        
        // If realtime endpoint fails, fall back to standard endpoint
        if (!response.ok && USE_REALTIME_PRICES) {
            console.log('Realtime endpoint not available, falling back to standard endpoint');
            endpoint = `${API_BASE}/tokens`;
            response = await fetch(endpoint);
        }
        
        if (!response.ok) throw new Error('Failed to fetch tokens');
        
        const data = await response.json();
        
        // If using realtime endpoint, merge with existing token data
        if (USE_REALTIME_PRICES && tokens.length > 0) {
            // Create a map of existing tokens
            const tokenMap = new Map(tokens.map(t => [t.mint_address, t]));
            
            // Update with real-time data
            data.forEach(realtimeToken => {
                const existing = tokenMap.get(realtimeToken.mint_address);
                if (existing) {
                    // Merge real-time price data with existing metadata
                    tokenMap.set(realtimeToken.mint_address, {
                        ...existing,
                        ...realtimeToken,
                        // Ensure real-time prices take precedence
                        latest_price_sol: realtimeToken.latest_price_sol,
                        latest_price_usd: realtimeToken.latest_price_usd,
                        latest_market_cap_usd: realtimeToken.latest_market_cap_usd,
                        calculated_price_usd: realtimeToken.calculated_price_usd
                    });
                } else {
                    tokenMap.set(realtimeToken.mint_address, realtimeToken);
                }
            });
            
            tokens = Array.from(tokenMap.values());
        } else {
            tokens = data;
        }
        
        applyFilters();
        
        // Show real-time indicator only if we actually used the realtime endpoint
        if (USE_REALTIME_PRICES && endpoint.includes('realtime')) {
            updateConnectionStatus(true, 'Real-time');
        }
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
        
        // Update SOL price in header and store globally
        const headerSolPrice = document.getElementById('header-sol-price');
        if (headerSolPrice && data.sol_price) {
            currentSolPrice = data.sol_price.price || 0;
            headerSolPrice.textContent = `$${currentSolPrice.toFixed(2)}`;
        }
        
        // Update SOL price timestamp
        const headerSolTimestamp = document.getElementById('header-sol-timestamp');
        if (headerSolTimestamp && data.sol_price.timestamp) {
            const timestamp = new Date(data.sol_price.timestamp);
            const now = new Date();
            const diffSeconds = Math.floor((now - timestamp) / 1000);
            
            let timeText = '';
            if (diffSeconds < 60) {
                timeText = `${diffSeconds}s ago`;
            } else if (diffSeconds < 3600) {
                timeText = `${Math.floor(diffSeconds / 60)}m ago`;
            } else {
                timeText = `${Math.floor(diffSeconds / 3600)}h ago`;
            }
            
            headerSolTimestamp.textContent = timeText;
            headerSolTimestamp.title = `Last updated: ${timestamp.toLocaleTimeString()}`;
        }
        
        // Update connection status
        updateConnectionStatus(true);
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
        // First filter by token view (new vs graduated)
        if (tokenView === 'new' && token.graduated_to_amm) return false;
        if (tokenView === 'graduated' && !token.graduated_to_amm) return false;
        
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
        
        // Platform filter - now redundant with tokenView but keeping for compatibility
        if (filters.platform !== 'all') {
            if (filters.platform === 'pump' && token.graduated_to_amm) return false;
            if (filters.platform === 'amm' && !token.graduated_to_amm) return false;
        }
        
        // Quick filters - adjust for token view
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
        tokenTableBody.innerHTML = '<tr><td colspan="9" class="no-data">No tokens found</td></tr>';
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        return;
    }
    
    tokenTableBody.innerHTML = filteredTokens.map((token, index) => {
        // Use calculated price if available, otherwise fallback to latest_price_usd
        const priceUsd = parseFloat(token.calculated_price_usd || token.latest_price_usd) || 0;
        const marketCap = parseFloat(token.latest_market_cap_usd) || 0;
        // Use actual creation time if available, otherwise fall back to first seen
        // Note: token_created_at is often null, so we mostly see "first seen" time
        const creationTime = token.token_created_at || token.created_at || token.first_seen_at;
        const age = formatAge(creationTime);
        const ageTooltip = token.token_created_at 
            ? 'Token age since blockchain creation' 
            : 'Time since first detected by monitor (actual creation time not available)';
        const progress = parseFloat(token.latest_bonding_curve_progress) || 0;
        const isGraduated = token.graduated_to_amm;
        const bcComplete = token.bonding_curve_complete;
        const program = isGraduated ? 'amm_pool' : 'bonding_curve';
        
        // Get token icon - use image_uri if available, otherwise first letter
        const iconContent = token.image_uri && !token.image_uri.includes('ipfs.io')
            ? `<img src="${token.image_uri}" alt="${token.symbol}" onerror="this.style.display='none'; this.parentElement.textContent='${token.symbol?.charAt(0) || '?'}';">`
            : (token.symbol?.charAt(0) || '?');
        
        return `
            <tr data-mint="${token.mint_address}" class="token-row" onclick="window.location.href='/token-detail.html?mint=${token.mint_address}'" style="cursor: pointer;">
                <td>${index + 1}</td>
                <td>
                    <div class="token-info">
                        <div class="token-icon">${iconContent}</div>
                        <div class="token-details">
                            <div class="token-symbol">${token.symbol || 'Unknown'}</div>
                            <div class="token-meta">
                                <span>${token.name || 'No name'}</span>
                                <span class="pair-badge">${token.symbol || '???'}/SOL</span>
                                <span style="color: ${isGraduated ? 'var(--purple)' : bcComplete ? 'var(--success)' : 'var(--yellow)'};">
                                    ${isGraduated ? 'AMM' : bcComplete ? 'BC COMPLETE' : `PUMP ${progress.toFixed(0)}%`}
                                </span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="holder-score-cell">
                    ${formatHolderScore(token.holder_score)}
                </td>
                <td class="mcap-cell">
                    <div>$${formatNumber(marketCap)} <span class="sol-mcap">(${currentSolPrice > 0 ? formatNumber(marketCap / currentSolPrice) + ' SOL' : ''})</span></div>
                    <div class="fdv-label">FDV $${formatNumber(marketCap * 10)}</div>
                </td>
                <td class="price-cell">
                    <div class="price-value">$${formatPrice(priceUsd)}</div>
                </td>
                <td class="age-cell" title="${ageTooltip}" style="color: ${token.token_created_at ? 'var(--green)' : 'var(--red)'};">${age}</td>
                <td class="liquidity-cell">${calculateLiquidity(token)}</td>
                <td>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${isGraduated ? 'complete' : ''}" 
                                 style="width: ${isGraduated ? 100 : progress}%; ${!isGraduated ? getProgressGradient(progress) : ''}"></div>
                        </div>
                        <span class="progress-text">${isGraduated ? 'GRAD' : bcComplete ? 'COMPLETE' : progress >= 100 ? '~100%' : `${progress.toFixed(0)}%`}</span>
                    </div>
                </td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        <a href="https://pump.fun/coin/${token.mint_address}" 
                           target="_blank" 
                           rel="noopener noreferrer" 
                           class="icon-link"
                           title="View on pump.fun"
                           onclick="event.stopPropagation()">
                            <img src="https://pump.fun/_next/image?url=%2Flogo.png&w=96&q=75" 
                                 alt="pump.fun" 
                                 width="20" 
                                 height="20">
                        </a>
                        <a href="https://solscan.io/token/${token.mint_address}" 
                           target="_blank" 
                           rel="noopener noreferrer" 
                           class="icon-link"
                           title="View on Solscan"
                           onclick="event.stopPropagation()">
                            <img src="https://solscan.io/_next/static/media/solana-sol-logo.ecf2bf3a.svg" 
                                 alt="Solscan" 
                                 width="20" 
                                 height="20">
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
    
    // Update token type counters
    updateTokenCounters();
}

// Update token type counters
function updateTokenCounters() {
    const newTokenCount = tokens.filter(token => !token.graduated_to_amm).length;
    const graduatedCount = tokens.filter(token => token.graduated_to_amm).length;
    
    const newTokenCounter = document.getElementById('new-token-count');
    const graduatedCounter = document.getElementById('graduated-token-count');
    
    if (newTokenCounter) {
        newTokenCounter.textContent = newTokenCount;
    }
    
    if (graduatedCounter) {
        graduatedCounter.textContent = graduatedCount;
    }
}

// Event Handlers
function handleTokenTypeToggle(e) {
    const button = e.target;
    const type = button.getAttribute('data-type');
    
    // Update active state
    document.querySelectorAll('.token-type-option').forEach(btn => {
        btn.classList.remove('active');
    });
    button.classList.add('active');
    
    // Update view state
    tokenView = type;
    
    // Re-apply filters
    applyFilters();
}

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

function calculateLiquidity(token) {
    // For AMM/graduated tokens with virtual reserves, calculate real liquidity
    if (token.graduated_to_amm && token.latest_virtual_sol_reserves && currentSolPrice > 0) {
        // Liquidity = 2 × SOL reserves × SOL price
        // Convert from lamports to SOL (divide by 10^9)
        const solReserves = parseFloat(token.latest_virtual_sol_reserves) / 1e9;
        const liquidityUsd = solReserves * 2 * currentSolPrice;
        return '$' + formatNumber(liquidityUsd);
    }
    
    // For bonding curve tokens, estimate liquidity as 10% of market cap
    // This is because bonding curve tokens don't have traditional liquidity pools
    const marketCap = parseFloat(token.latest_market_cap_usd) || 0;
    return '$' + formatNumber(marketCap * 0.1);
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


function showError(message) {
    if (tokenTableBody) {
        tokenTableBody.innerHTML = `<tr><td colspan="9" class="no-data" style="color: var(--red);">${message}</td></tr>`;
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

// Format holder score with color coding
function formatHolderScore(score) {
    if (!score && score !== 0) {
        return '<span class="holder-score-badge" style="background: var(--bg-light); color: var(--text-dim);">--</span>';
    }
    
    const numScore = parseInt(score);
    let color, bgColor, label;
    
    if (numScore >= 250) {
        color = '#14CB82';
        bgColor = 'rgba(20, 203, 130, 0.1)';
    } else if (numScore >= 200) {
        color = '#FFD700';
        bgColor = 'rgba(255, 215, 0, 0.1)';
    } else if (numScore >= 150) {
        color = '#FF9800';
        bgColor = 'rgba(255, 152, 0, 0.1)';
    } else if (numScore >= 100) {
        color = '#FF6B6B';
        bgColor = 'rgba(255, 107, 107, 0.1)';
    } else {
        color = '#F44336';
        bgColor = 'rgba(244, 67, 54, 0.1)';
    }
    
    return `<span class="holder-score-badge" style="background: ${bgColor}; color: ${color}; border: 1px solid ${color}; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 12px;" title="Holder Score: ${numScore}/300">${numScore}</span>`;
}

// Get gradient color based on progress percentage
function getProgressGradient(progress) {
    // Create a gradient from red (0%) through yellow (50%) to green (100%)
    let color;
    
    if (progress <= 50) {
        // Red to Yellow (0-50%)
        const ratio = progress / 50;
        const r = 246; // Red component stays high
        const g = Math.round(70 + (193 - 70) * ratio); // Green increases from 70 to 193
        const b = 93 - Math.round(86 * ratio); // Blue decreases from 93 to 7
        color = `rgb(${r}, ${g}, ${b})`;
    } else {
        // Yellow to Green (50-100%)
        const ratio = (progress - 50) / 50;
        const r = Math.round(255 - (241 * ratio)); // Red decreases from 255 to 14
        const g = Math.round(193 + (203 - 193) * ratio); // Green increases from 193 to 203
        const b = Math.round(7 + (122 * ratio)); // Blue increases from 7 to 129
        color = `rgb(${r}, ${g}, ${b})`;
    }
    
    return `background: ${color};`;
}

