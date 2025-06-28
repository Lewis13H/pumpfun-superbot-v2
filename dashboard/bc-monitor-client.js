/**
 * BC Monitor WebSocket Client
 * Handles real-time updates from the bonding curve monitor
 */

class BCMonitorClient {
  constructor() {
    this.ws = null;
    this.reconnectInterval = 5000;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.isConnected = false;
    this.callbacks = {
      onTrade: null,
      onGraduation: null,
      onNewToken: null,
      onStats: null,
      onError: null
    };
    
    // Activity feeds
    this.recentTrades = [];
    this.recentGraduations = [];
    this.recentNewTokens = [];
    this.currentStats = null;
    
    this.connect();
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    const wsUrl = `ws://${window.location.host}/ws`;
    console.log('Connecting to BC Monitor WebSocket:', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('✅ Connected to BC Monitor WebSocket');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Subscribe to all events
        this.ws.send(JSON.stringify({
          type: 'subscribe',
          events: ['all']
        }));
        
        // Update UI connection status
        this.updateConnectionStatus(true);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
        this.updateConnectionStatus(false);
        
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket connection closed');
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.attemptReconnect();
      };
      
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Handle incoming messages
   */
  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        console.log('Server confirmed connection:', data.data.message);
        break;
        
      case 'subscribed':
        console.log('Subscribed to events:', data.data.events);
        break;
        
      case 'trade':
        this.handleTrade(data.data);
        break;
        
      case 'graduation':
        this.handleGraduation(data.data);
        break;
        
      case 'new_token':
        this.handleNewToken(data.data);
        break;
        
      case 'stats':
        this.handleStats(data.data);
        break;
        
      case 'pong':
        // Keepalive response
        break;
        
      default:
        console.log('Unknown message type:', data.type);
    }
  }

  /**
   * Handle trade event
   */
  handleTrade(trade) {
    // Add to recent trades (keep last 50)
    this.recentTrades.unshift(trade);
    if (this.recentTrades.length > 50) {
      this.recentTrades.pop();
    }
    
    // Call callback
    if (this.callbacks.onTrade) {
      this.callbacks.onTrade(trade);
    }
    
    // Update UI
    this.updateTradesFeed();
  }

  /**
   * Handle graduation event
   */
  handleGraduation(graduation) {
    // Add to recent graduations
    this.recentGraduations.unshift(graduation);
    if (this.recentGraduations.length > 20) {
      this.recentGraduations.pop();
    }
    
    // Call callback
    if (this.callbacks.onGraduation) {
      this.callbacks.onGraduation(graduation);
    }
    
    // Update UI with celebration
    this.showGraduationAlert(graduation);
  }

  /**
   * Handle new token event
   */
  handleNewToken(token) {
    // Add to recent new tokens
    this.recentNewTokens.unshift(token);
    if (this.recentNewTokens.length > 30) {
      this.recentNewTokens.pop();
    }
    
    // Call callback
    if (this.callbacks.onNewToken) {
      this.callbacks.onNewToken(token);
    }
    
    // Update UI
    this.updateNewTokensFeed();
  }

  /**
   * Handle stats update
   */
  handleStats(stats) {
    this.currentStats = stats;
    
    // Call callback
    if (this.callbacks.onStats) {
      this.callbacks.onStats(stats);
    }
    
    // Update UI
    this.updateStatsDisplay();
  }

  /**
   * Update connection status indicator
   */
  updateConnectionStatus(connected) {
    // Update main connection status in header
    if (window.updateConnectionStatus) {
      window.updateConnectionStatus(connected, connected ? 'BC Monitor Connected' : 'BC Monitor Disconnected');
    }
    
    // Also update BC Monitor specific status if on that page
    const indicator = document.getElementById('bc-monitor-status');
    if (indicator) {
      indicator.className = connected ? 'status-connected' : 'status-disconnected';
      indicator.textContent = connected ? 'BC Monitor Connected' : 'BC Monitor Disconnected';
    }
  }

  /**
   * Update trades feed UI
   */
  updateTradesFeed() {
    const feed = document.getElementById('bc-trades-feed');
    if (!feed) return;
    
    const html = this.recentTrades.slice(0, 10).map(trade => {
      const typeClass = trade.type === 'buy' ? 'trade-buy' : 'trade-sell';
      const typeIcon = trade.type === 'buy' ? '🟢' : '🔴';
      
      return `
        <div class="trade-item ${typeClass}">
          <span class="trade-type">${typeIcon} ${trade.type.toUpperCase()}</span>
          <span class="trade-mint">${trade.mint.slice(0, 6)}...${trade.mint.slice(-4)}</span>
          <span class="trade-price">$${this.formatNumber(trade.price)}</span>
          <span class="trade-market-cap">${this.formatMarketCap(trade.marketCap)}</span>
          <span class="trade-time">${this.formatTime(trade.timestamp)}</span>
        </div>
      `;
    }).join('');
    
    feed.innerHTML = html;
  }

  /**
   * Show graduation alert
   */
  showGraduationAlert(graduation) {
    const alert = document.createElement('div');
    alert.className = 'graduation-alert';
    alert.innerHTML = `
      <div class="graduation-content">
        <div class="graduation-emoji">🎓</div>
        <div class="graduation-text">
          <h3>Token Graduated!</h3>
          <p>${graduation.mint.slice(0, 8)}...${graduation.mint.slice(-6)}</p>
          <p>Final SOL: ${graduation.finalSol.toFixed(2)}</p>
          <p>Market Cap: ${this.formatMarketCap(graduation.marketCap)}</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(alert);
    
    // Remove after animation
    setTimeout(() => {
      alert.remove();
    }, 5000);
  }

  /**
   * Update new tokens feed
   */
  updateNewTokensFeed() {
    const feed = document.getElementById('bc-new-tokens-feed');
    if (!feed) return;
    
    const html = this.recentNewTokens.slice(0, 5).map(token => {
      return `
        <div class="new-token-item">
          <div class="new-token-header">
            <span class="new-token-label">🚀 NEW</span>
            <span class="new-token-time">${this.formatTime(token.timestamp)}</span>
          </div>
          <div class="new-token-mint">${token.mint}</div>
          <div class="new-token-creator">Creator: ${token.creator.slice(0, 8)}...</div>
        </div>
      `;
    }).join('');
    
    feed.innerHTML = html;
  }

  /**
   * Update stats display
   */
  updateStatsDisplay() {
    if (!this.currentStats) return;
    
    // Update various stat elements
    this.updateStatValue('bc-stats-trades', this.currentStats.totalTrades);
    this.updateStatValue('bc-stats-tps', this.currentStats.transactionsPerSecond.toFixed(1));
    this.updateStatValue('bc-stats-new-tokens', this.currentStats.newTokensDetected);
    this.updateStatValue('bc-stats-graduations', this.currentStats.graduatedTokens);
    this.updateStatValue('bc-stats-parse-rate', `${this.currentStats.parseSuccessRate.toFixed(1)}%`);
    this.updateStatValue('bc-stats-uptime', this.formatUptime(this.currentStats.uptimeSeconds));
  }

  /**
   * Update a stat value element
   */
  updateStatValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect in ${this.reconnectInterval / 1000}s... (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Send ping to keep connection alive
   */
  sendPing() {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  /**
   * Format number with commas
   */
  formatNumber(num) {
    return num.toFixed(4);
  }

  /**
   * Format market cap
   */
  formatMarketCap(num) {
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `$${(num / 1000).toFixed(1)}K`;
    }
    return `$${num.toFixed(0)}`;
  }

  /**
   * Format timestamp
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  /**
   * Format uptime
   */
  formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

// Initialize BC Monitor client when DOM is ready
let bcMonitor = null;

document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on a page that needs BC Monitor
  if (document.getElementById('bc-monitor-section')) {
    bcMonitor = new BCMonitorClient();
    
    // Set up ping interval
    setInterval(() => {
      if (bcMonitor) {
        bcMonitor.sendPing();
      }
    }, 30000);
  }
});