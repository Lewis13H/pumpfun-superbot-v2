# Streaming Metrics Dashboard Upgrade Plan

## Overview

This document outlines a comprehensive upgrade plan for the streaming-metrics.html dashboard to incorporate the fault tolerance and performance optimization features implemented in Sessions 8 & 9 of the IMPLEMENTATION_PLAN.md.

## Goals

1. **Enhanced Visibility**: Provide real-time insights into circuit breaker states, connection health, and recovery mechanisms
2. **Performance Monitoring**: Display adaptive optimization metrics including dynamic batching, cache performance, and resource allocation
3. **Proactive Alerts**: Show system alerts from the FaultToleranceAlerts service
4. **Improved Health Scoring**: Update health calculations to include fault tolerance and optimization metrics
5. **Real-time Updates**: Implement WebSocket/SSE for live data streaming

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Streaming Metrics Dashboard                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Health Score   │  │ System Vitals    │  │ Live Alerts   │  │
│  │  (Enhanced)     │  │ (CPU/Mem/TPS)    │  │ (Real-time)   │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Fault Tolerance Section                     │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │  │
│  │  │Circuit      │  │Connection   │  │Recovery Stats  │  │  │
│  │  │Breakers     │  │Health       │  │& Checkpoints   │  │  │
│  │  └─────────────┘  └─────────────┘  └────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │           Performance Optimization Section               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │  │
│  │  │Dynamic      │  │Adaptive     │  │Resource        │  │  │
│  │  │Batching     │  │Caching      │  │Allocation      │  │  │
│  │  └─────────────┘  └─────────────┘  └────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          Enhanced Visualizations                         │  │
│  │  • Connection Pool Topology                              │  │
│  │  • Performance Trend Analysis                            │  │
│  │  • Real-time Optimization Impact                         │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Backend API Development

#### 1.1 Fault Tolerance Endpoints

```typescript
// GET /api/v1/fault-tolerance/status
interface FaultToleranceStatus {
  enabled: boolean;
  health: {
    healthy: number;
    degraded: number;
    failed: number;
  };
  lastCheckpoint: Date;
  missedSlots: number;
}

// GET /api/v1/fault-tolerance/circuit-breakers
interface CircuitBreakerStatus {
  connectionId: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  parseRate: number;
  latency: number;
}

// GET /api/v1/fault-tolerance/alerts
interface FaultToleranceAlert {
  id: string;
  timestamp: Date;
  severity: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  connectionId?: string;
  data?: any;
}
```

#### 1.2 Performance Optimization Endpoints

```typescript
// GET /api/v1/performance/optimization/status
interface OptimizationStatus {
  enabled: boolean;
  mode: 'auto' | 'manual';
  efficiency: number; // 0-1
  lastOptimization: Date;
  currentParams: {
    batchSize: number;
    batchTimeout: number;
    cacheTTLMultiplier: number;
    maxConcurrentOps: number;
  };
}

// GET /api/v1/performance/batch/metrics
interface BatchMetrics {
  currentSize: number;
  avgSize: number;
  minSize: number;
  maxSize: number;
  throughput: number;
  queueDepth: number;
  priorityDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

// GET /api/v1/performance/cache/stats
interface CacheStats {
  hitRate: number;
  missRate: number;
  evictions: number;
  compressionRatio: number;
  totalSize: number;
  entryCount: number;
  avgTTL: number;
  cacheTypes: {
    [key: string]: {
      hitRate: number;
      size: number;
      entries: number;
    };
  };
}
```

#### 1.3 Real-time Streaming Endpoint

```typescript
// GET /api/v1/performance/stream (Server-Sent Events)
// Events:
// - metrics: Overall system metrics update
// - alert: New fault tolerance alert
// - optimization: Optimization parameter change
// - circuit-breaker: Circuit breaker state change
```

### Phase 2: Frontend UI Components

#### 2.1 Enhanced Health Score Component

```javascript
class EnhancedHealthScore {
  constructor(container) {
    this.container = container;
    this.weights = {
      parseRate: 0.25,
      uptime: 0.15,
      circuitBreakerHealth: 0.20,
      performanceEfficiency: 0.20,
      cacheHitRate: 0.10,
      errorRate: 0.10
    };
  }

  calculate(data) {
    let score = 0;
    
    // Parse rate component
    const avgParseRate = this.calculateAverageParseRate(data.monitors);
    score += avgParseRate * 100 * this.weights.parseRate;
    
    // Circuit breaker health
    const cbHealth = this.calculateCircuitBreakerHealth(data.circuitBreakers);
    score += cbHealth * 100 * this.weights.circuitBreakerHealth;
    
    // Performance efficiency
    const perfEfficiency = data.optimization?.efficiency || 0;
    score += perfEfficiency * 100 * this.weights.performanceEfficiency;
    
    // Cache hit rate
    const cacheHitRate = data.cache?.hitRate || 0;
    score += cacheHitRate * 100 * this.weights.cacheHitRate;
    
    // Error rate (inverse)
    const errorRate = data.errorRate || 0;
    score += (1 - Math.min(errorRate / 5, 1)) * 100 * this.weights.errorRate;
    
    // Uptime bonus
    const uptimeScore = this.calculateUptimeScore(data.system?.uptime);
    score += uptimeScore * 100 * this.weights.uptime;
    
    return Math.round(Math.min(score, 100));
  }

  render(score) {
    const status = this.getStatus(score);
    this.container.innerHTML = `
      <div class="health-score-wrapper">
        <div class="health-score-ring ${status.class}">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" fill="none" stroke="#334155" stroke-width="12"/>
            <circle cx="100" cy="100" r="90" fill="none" 
                    stroke="${status.color}" 
                    stroke-width="12"
                    stroke-dasharray="${score * 5.65} 565"
                    stroke-dashoffset="0"
                    transform="rotate(-90 100 100)"/>
          </svg>
          <div class="health-score-text">
            <div class="score">${score}%</div>
            <div class="label">Health Score</div>
          </div>
        </div>
        <div class="health-status ${status.class}">${status.text}</div>
        <div class="health-breakdown">
          ${this.renderBreakdown()}
        </div>
      </div>
    `;
  }
}
```

#### 2.2 Circuit Breaker Visualization Component

```javascript
class CircuitBreakerVisualization {
  constructor(container) {
    this.container = container;
    this.circuitBreakers = new Map();
  }

  update(circuitBreakers) {
    const html = circuitBreakers.map(cb => this.renderCircuitBreaker(cb)).join('');
    this.container.innerHTML = `
      <div class="circuit-breakers-grid">
        ${html}
      </div>
    `;
  }

  renderCircuitBreaker(cb) {
    const stateClass = this.getStateClass(cb.state);
    const stateIcon = this.getStateIcon(cb.state);
    
    return `
      <div class="circuit-breaker-card ${stateClass}">
        <div class="cb-header">
          <span class="cb-connection">${cb.connectionId}</span>
          <span class="cb-state-icon">${stateIcon}</span>
        </div>
        <div class="cb-state-indicator">
          <div class="cb-state-text">${cb.state}</div>
          ${cb.state === 'HALF_OPEN' ? 
            `<div class="cb-recovery-progress">Testing...</div>` : ''}
        </div>
        <div class="cb-metrics">
          <div class="cb-metric">
            <span class="label">Failures</span>
            <span class="value">${cb.failures}</span>
          </div>
          <div class="cb-metric">
            <span class="label">Parse Rate</span>
            <span class="value">${(cb.parseRate * 100).toFixed(1)}%</span>
          </div>
          <div class="cb-metric">
            <span class="label">Latency</span>
            <span class="value">${cb.latency}ms</span>
          </div>
        </div>
        ${cb.lastFailure ? 
          `<div class="cb-last-failure">Last failure: ${this.formatTime(cb.lastFailure)}</div>` : ''}
      </div>
    `;
  }

  getStateClass(state) {
    switch(state) {
      case 'CLOSED': return 'cb-closed';
      case 'OPEN': return 'cb-open';
      case 'HALF_OPEN': return 'cb-half-open';
      default: return '';
    }
  }

  getStateIcon(state) {
    switch(state) {
      case 'CLOSED': return '🟢';
      case 'OPEN': return '🔴';
      case 'HALF_OPEN': return '🟡';
      default: return '⚪';
    }
  }
}
```

#### 2.3 Performance Optimization Dashboard

```javascript
class PerformanceOptimizationDashboard {
  constructor(container) {
    this.container = container;
    this.charts = {};
    this.initializeCharts();
  }

  initializeCharts() {
    // Batch size trend chart
    this.charts.batchSize = new Chart(
      document.getElementById('batchSizeTrendChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Batch Size',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4
          }, {
            label: 'Optimal Size',
            data: [],
            borderColor: '#10b981',
            borderDash: [5, 5],
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              title: { text: 'Batch Size' }
            }
          }
        }
      }
    );

    // Cache efficiency gauge
    this.charts.cacheGauge = this.createGaugeChart('cacheEfficiencyGauge', {
      title: 'Cache Efficiency',
      min: 0,
      max: 100,
      zones: [
        { min: 0, max: 50, color: '#ef4444' },
        { min: 50, max: 80, color: '#f59e0b' },
        { min: 80, max: 100, color: '#10b981' }
      ]
    });

    // Resource allocation pie chart
    this.charts.resourceAllocation = new Chart(
      document.getElementById('resourceAllocationChart').getContext('2d'),
      {
        type: 'doughnut',
        data: {
          labels: ['Connections', 'Cache', 'Processing', 'Available'],
          datasets: [{
            data: [0, 0, 0, 0],
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#e5e7eb']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'bottom'
            }
          }
        }
      }
    );
  }

  update(data) {
    this.updateBatchingMetrics(data.batching);
    this.updateCacheMetrics(data.cache);
    this.updateResourceMetrics(data.resources);
    this.updateOptimizationSuggestions(data.suggestions);
  }

  updateBatchingMetrics(batchData) {
    // Update batch size trend
    const chart = this.charts.batchSize;
    chart.data.labels.push(new Date().toLocaleTimeString());
    chart.data.datasets[0].data.push(batchData.currentSize);
    chart.data.datasets[1].data.push(batchData.optimalSize);
    
    // Keep last 20 points
    if (chart.data.labels.length > 20) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(dataset => dataset.data.shift());
    }
    
    chart.update('none');

    // Update metrics display
    document.getElementById('currentBatchSize').textContent = batchData.currentSize;
    document.getElementById('batchEfficiency').textContent = 
      `${(batchData.efficiency * 100).toFixed(1)}%`;
    document.getElementById('avgBatchLatency').textContent = 
      `${batchData.avgLatency.toFixed(0)}ms`;
  }

  updateCacheMetrics(cacheData) {
    // Update gauge
    this.charts.cacheGauge.update(cacheData.hitRate * 100);

    // Update stats
    document.getElementById('cacheHitRate').textContent = 
      `${(cacheData.hitRate * 100).toFixed(1)}%`;
    document.getElementById('cacheCompression').textContent = 
      `${cacheData.compressionRatio.toFixed(2)}x`;
    document.getElementById('cacheEvictions').textContent = 
      cacheData.evictions.toLocaleString();

    // Update cache type distribution
    this.renderCacheTypeDistribution(cacheData.cacheTypes);
  }

  renderCacheTypeDistribution(cacheTypes) {
    const container = document.getElementById('cacheDistribution');
    const total = Object.values(cacheTypes).reduce((sum, type) => sum + type.size, 0);
    
    container.innerHTML = Object.entries(cacheTypes).map(([name, stats]) => `
      <div class="cache-type-item">
        <div class="cache-type-header">
          <span class="cache-type-name">${name}</span>
          <span class="cache-type-hit-rate">${(stats.hitRate * 100).toFixed(0)}%</span>
        </div>
        <div class="cache-type-bar">
          <div class="cache-type-fill" style="width: ${(stats.size / total * 100)}%"></div>
        </div>
        <div class="cache-type-stats">
          <span>${this.formatBytes(stats.size)}</span>
          <span>${stats.entries} entries</span>
        </div>
      </div>
    `).join('');
  }

  updateOptimizationSuggestions(suggestions) {
    const container = document.getElementById('optimizationSuggestions');
    
    if (!suggestions || suggestions.length === 0) {
      container.innerHTML = `
        <div class="no-suggestions">
          <span class="icon">✅</span>
          <span>System is optimally configured</span>
        </div>
      `;
      return;
    }

    container.innerHTML = suggestions.map(suggestion => `
      <div class="suggestion-item ${suggestion.priority}">
        <div class="suggestion-icon">${this.getSuggestionIcon(suggestion.type)}</div>
        <div class="suggestion-content">
          <div class="suggestion-title">${suggestion.title}</div>
          <div class="suggestion-description">${suggestion.description}</div>
          ${suggestion.action ? 
            `<button class="suggestion-action" onclick="applyOptimization('${suggestion.id}')">
              ${suggestion.action}
            </button>` : ''}
        </div>
      </div>
    `).join('');
  }
}
```

#### 2.4 Connection Pool Topology Visualization

```javascript
class ConnectionPoolTopology {
  constructor(container) {
    this.container = container;
    this.svg = null;
    this.initialize();
  }

  initialize() {
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', 400);
  }

  update(poolData) {
    const width = this.container.clientWidth;
    const height = 400;

    // Clear previous render
    this.svg.selectAll('*').remove();

    // Create connection nodes
    const nodes = poolData.connections.map((conn, i) => ({
      ...conn,
      x: (i + 1) * (width / (poolData.connections.length + 1)),
      y: height / 2
    }));

    // Create links to monitors
    const links = [];
    poolData.connections.forEach(conn => {
      conn.monitors.forEach(monitor => {
        links.push({
          source: conn.id,
          target: monitor,
          type: 'monitor'
        });
      });
    });

    // Render connections
    const connectionGroups = this.svg.selectAll('.connection-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'connection-node')
      .attr('transform', d => `translate(${d.x}, ${d.y})`);

    // Connection circles
    connectionGroups.append('circle')
      .attr('r', 40)
      .attr('fill', d => this.getConnectionColor(d))
      .attr('stroke', '#334155')
      .attr('stroke-width', 2);

    // Connection labels
    connectionGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', -50)
      .text(d => d.id)
      .style('fill', '#e0e0e0')
      .style('font-size', '12px');

    // Load indicators
    connectionGroups.append('rect')
      .attr('x', -30)
      .attr('y', 15)
      .attr('width', 60)
      .attr('height', 8)
      .attr('fill', '#334155')
      .attr('rx', 4);

    connectionGroups.append('rect')
      .attr('x', -30)
      .attr('y', 15)
      .attr('width', d => (d.load / 100) * 60)
      .attr('height', 8)
      .attr('fill', d => this.getLoadColor(d.load))
      .attr('rx', 4);

    // Circuit breaker state
    connectionGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 5)
      .text(d => this.getCircuitBreakerIcon(d.circuitState))
      .style('font-size', '20px');

    // Stats
    connectionGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 65)
      .text(d => `${d.tps} TPS`)
      .style('fill', '#94a3b8')
      .style('font-size', '11px');
  }

  getConnectionColor(conn) {
    if (conn.circuitState === 'OPEN') return '#ef4444';
    if (conn.circuitState === 'HALF_OPEN') return '#f59e0b';
    if (conn.load > 80) return '#f59e0b';
    return '#10b981';
  }

  getLoadColor(load) {
    if (load > 80) return '#ef4444';
    if (load > 60) return '#f59e0b';
    return '#10b981';
  }

  getCircuitBreakerIcon(state) {
    switch(state) {
      case 'CLOSED': return '⚡';
      case 'OPEN': return '🔌';
      case 'HALF_OPEN': return '⚠️';
      default: return '❓';
    }
  }
}
```

#### 2.5 Live Alerts Feed Component

```javascript
class LiveAlertsFeed {
  constructor(container) {
    this.container = container;
    this.alerts = [];
    this.maxAlerts = 50;
    this.filters = {
      severity: 'all'
    };
  }

  addAlert(alert) {
    // Add to beginning of array
    this.alerts.unshift({
      ...alert,
      id: alert.id || Date.now(),
      timestamp: alert.timestamp || new Date()
    });

    // Limit array size
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    this.render();
    this.showNotification(alert);
  }

  render() {
    const filteredAlerts = this.filterAlerts();
    
    if (filteredAlerts.length === 0) {
      this.container.innerHTML = `
        <div class="alerts-empty">
          <span class="icon">🔔</span>
          <span>No alerts to display</span>
        </div>
      `;
      return;
    }

    this.container.innerHTML = filteredAlerts.map(alert => `
      <div class="alert-item ${alert.severity}" data-id="${alert.id}">
        <div class="alert-header">
          <span class="alert-severity-icon">${this.getSeverityIcon(alert.severity)}</span>
          <span class="alert-type">${alert.type}</span>
          <span class="alert-time">${this.formatTime(alert.timestamp)}</span>
        </div>
        <div class="alert-message">${alert.message}</div>
        ${alert.connectionId ? 
          `<div class="alert-connection">Connection: ${alert.connectionId}</div>` : ''}
        ${alert.data ? 
          `<div class="alert-data">
            <details>
              <summary>Details</summary>
              <pre>${JSON.stringify(alert.data, null, 2)}</pre>
            </details>
          </div>` : ''}
      </div>
    `).join('');
  }

  filterAlerts() {
    if (this.filters.severity === 'all') {
      return this.alerts;
    }
    return this.alerts.filter(alert => alert.severity === this.filters.severity);
  }

  getSeverityIcon(severity) {
    switch(severity) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '📢';
    }
  }

  showNotification(alert) {
    if (alert.severity === 'critical') {
      // Show browser notification if permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Critical System Alert', {
          body: alert.message,
          icon: '/favicon.ico',
          tag: alert.id
        });
      }
    }

    // Show toast notification
    showToast(alert.message, alert.severity);
  }

  setFilter(severity) {
    this.filters.severity = severity;
    this.render();
  }
}
```

### Phase 3: Real-time Data Integration

#### 3.1 WebSocket/SSE Connection Manager

```javascript
class RealtimeDataManager {
  constructor() {
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.listeners = new Map();
  }

  connect() {
    try {
      this.eventSource = new EventSource('/api/v1/performance/stream');
      
      this.eventSource.onopen = () => {
        console.log('Connected to real-time stream');
        this.reconnectAttempts = 0;
        this.updateConnectionStatus(true);
      };

      this.eventSource.onerror = (error) => {
        console.error('Stream error:', error);
        this.updateConnectionStatus(false);
        this.reconnect();
      };

      // System metrics update
      this.eventSource.addEventListener('metrics', (event) => {
        const data = JSON.parse(event.data);
        this.emit('metrics', data);
      });

      // Fault tolerance alerts
      this.eventSource.addEventListener('alert', (event) => {
        const alert = JSON.parse(event.data);
        this.emit('alert', alert);
      });

      // Circuit breaker state changes
      this.eventSource.addEventListener('circuit-breaker', (event) => {
        const data = JSON.parse(event.data);
        this.emit('circuit-breaker', data);
      });

      // Optimization updates
      this.eventSource.addEventListener('optimization', (event) => {
        const data = JSON.parse(event.data);
        this.emit('optimization', data);
      });

      // Cache stats updates
      this.eventSource.addEventListener('cache-stats', (event) => {
        const data = JSON.parse(event.data);
        this.emit('cache-stats', data);
      });

      // Batch metrics updates
      this.eventSource.addEventListener('batch-metrics', (event) => {
        const data = JSON.parse(event.data);
        this.emit('batch-metrics', data);
      });

    } catch (error) {
      console.error('Failed to connect to stream:', error);
      this.reconnect();
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      showToast('Unable to connect to real-time updates', 'error');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  updateConnectionStatus(connected) {
    const indicator = document.getElementById('realtimeIndicator');
    if (indicator) {
      indicator.className = `realtime-indicator ${connected ? 'connected' : 'disconnected'}`;
      indicator.textContent = connected ? 'Live' : 'Offline';
    }
  }
}
```

### Phase 4: CSS Enhancements

#### 4.1 New Component Styles

```css
/* Fault Tolerance Section */
.fault-tolerance-section {
    margin-bottom: 30px;
}

.fault-tolerance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 20px;
}

.circuit-breaker-card {
    background: #1e293b;
    border: 2px solid #334155;
    border-radius: 12px;
    padding: 20px;
    transition: all 0.3s ease;
}

.circuit-breaker-card.cb-open {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.circuit-breaker-card.cb-half-open {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
}

.cb-state-indicator {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 15px 0;
}

.cb-state-text {
    font-size: 18px;
    font-weight: 700;
}

.cb-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 15px;
}

.cb-metric {
    text-align: center;
}

.cb-metric .label {
    font-size: 11px;
    color: #94a3b8;
    display: block;
}

.cb-metric .value {
    font-size: 20px;
    font-weight: 700;
    color: #f1f5f9;
}

/* Performance Optimization Section */
.performance-optimization-section {
    margin-bottom: 30px;
}

.optimization-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid #3b82f6;
    border-radius: 20px;
    font-size: 14px;
    color: #3b82f6;
}

.opt-indicator::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #3b82f6;
    border-radius: 50%;
    margin-right: 6px;
    animation: pulse 2s infinite;
}

.optimization-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 20px;
}

.opt-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 24px;
}

.batch-size-chart {
    height: 200px;
    margin-top: 20px;
}

.cache-type-item {
    margin-bottom: 15px;
}

.cache-type-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    font-size: 13px;
}

.cache-type-bar {
    height: 6px;
    background: #334155;
    border-radius: 3px;
    overflow: hidden;
}

.cache-type-fill {
    height: 100%;
    background: #3b82f6;
    transition: width 0.3s ease;
}

/* Connection Pool Topology */
.connection-pool-viz {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 20px;
    min-height: 400px;
}

.connection-node {
    cursor: pointer;
    transition: all 0.3s ease;
}

.connection-node:hover circle {
    stroke-width: 4;
    filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.5));
}

/* Live Alerts Feed */
.alerts-panel {
    position: fixed;
    right: 20px;
    top: 80px;
    width: 350px;
    max-height: 500px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    display: flex;
    flex-direction: column;
}

.alerts-header {
    padding: 16px 20px;
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.alerts-feed {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
}

.alert-item {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 10px;
    animation: slideIn 0.3s ease;
}

@keyframes slideIn {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

.alert-item.critical {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.alert-item.warning {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
}

.alert-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.alert-severity-icon {
    font-size: 16px;
}

.alert-time {
    font-size: 11px;
    color: #64748b;
}

/* Optimization Suggestions */
.optimization-suggestions {
    margin-top: 20px;
}

.suggestion-item {
    display: flex;
    gap: 15px;
    padding: 15px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    margin-bottom: 10px;
    transition: all 0.2s ease;
}

.suggestion-item:hover {
    border-color: #3b82f6;
    transform: translateY(-1px);
}

.suggestion-item.high {
    border-left: 4px solid #ef4444;
}

.suggestion-item.medium {
    border-left: 4px solid #f59e0b;
}

.suggestion-item.low {
    border-left: 4px solid #3b82f6;
}

.suggestion-icon {
    font-size: 24px;
}

.suggestion-content {
    flex: 1;
}

.suggestion-title {
    font-weight: 600;
    margin-bottom: 5px;
}

.suggestion-description {
    font-size: 13px;
    color: #94a3b8;
    margin-bottom: 10px;
}

.suggestion-action {
    padding: 6px 12px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.suggestion-action:hover {
    background: #2563eb;
    transform: translateY(-1px);
}

/* Health Score Ring */
.health-score-ring {
    position: relative;
    width: 200px;
    height: 200px;
    margin: 0 auto;
}

.health-score-ring svg {
    transform: rotate(-90deg);
}

.health-score-ring circle {
    transition: stroke-dasharray 0.5s ease;
}

.health-score-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
}

.health-score-text .score {
    font-size: 48px;
    font-weight: 800;
    background: linear-gradient(135deg, #10b981, #3b82f6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.health-score-text .label {
    font-size: 14px;
    color: #94a3b8;
    margin-top: -5px;
}

.health-breakdown {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #334155;
}

.health-factor {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
}

.health-factor-label {
    color: #94a3b8;
}

.health-factor-value {
    font-weight: 600;
}

/* Responsive Design */
@media (max-width: 1200px) {
    .fault-tolerance-grid,
    .optimization-grid {
        grid-template-columns: 1fr;
    }
    
    .alerts-panel {
        position: relative;
        right: auto;
        top: auto;
        width: 100%;
        max-height: 400px;
        margin-bottom: 20px;
    }
}

@media (max-width: 768px) {
    .health-score-ring {
        width: 150px;
        height: 150px;
    }
    
    .health-score-text .score {
        font-size: 36px;
    }
    
    .connection-pool-viz {
        overflow-x: auto;
    }
}
```

### Phase 5: Implementation Timeline

#### Week 1: Backend Development
- Day 1-2: Implement fault tolerance API endpoints
- Day 3-4: Implement performance optimization API endpoints
- Day 5: Set up SSE streaming endpoint and event emitters

#### Week 2: Frontend Components
- Day 1-2: Build enhanced health score and circuit breaker components
- Day 3-4: Implement performance optimization dashboard
- Day 5: Create connection pool topology visualization

#### Week 3: Integration & Testing
- Day 1-2: Integrate real-time data streaming
- Day 3-4: Add live alerts feed and notifications
- Day 5: Performance testing and optimization

#### Week 4: Polish & Deploy
- Day 1-2: UI/UX refinements and responsive design
- Day 3-4: Error handling and edge cases
- Day 5: Documentation and deployment

## API Implementation Guide

### 1. Fault Tolerance Controller

```typescript
// src/api/controllers/fault-tolerance-controller.ts
export class FaultToleranceController {
  constructor(
    private faultTolerantManager: FaultTolerantManager,
    private stateRecoveryService: StateRecoveryService,
    private alertService: FaultToleranceAlerts
  ) {}

  async getStatus(req: Request, res: Response) {
    const health = this.faultTolerantManager.getHealthSummary();
    const checkpoint = await this.stateRecoveryService.getLatestCheckpoint();
    
    res.json({
      enabled: true,
      health,
      lastCheckpoint: checkpoint?.timestamp,
      missedSlots: checkpoint?.missedSlots || 0
    });
  }

  async getCircuitBreakers(req: Request, res: Response) {
    const connectionHealth = this.faultTolerantManager.getConnectionHealth();
    const circuitBreakers = Array.from(connectionHealth.entries()).map(([id, health]) => ({
      connectionId: id,
      ...health
    }));
    
    res.json(circuitBreakers);
  }

  async getAlerts(req: Request, res: Response) {
    const limit = parseInt(req.query.limit as string) || 50;
    const severity = req.query.severity as string;
    
    const alerts = this.alertService.getAlertHistory(limit);
    const filtered = severity ? 
      alerts.filter(a => a.severity === severity) : 
      alerts;
    
    res.json(filtered);
  }
}
```

### 2. Performance Optimization Controller

```typescript
// src/api/controllers/performance-optimization-controller.ts
export class PerformanceOptimizationController {
  constructor(
    private performanceOptimizer: PerformanceOptimizer,
    private batchProcessor: DynamicBatchProcessor,
    private cacheManager: AdaptiveCacheManager,
    private performanceMonitor: PerformanceMonitor
  ) {}

  async getOptimizationStatus(req: Request, res: Response) {
    const params = this.performanceOptimizer.getOptimizationParams();
    const report = this.performanceOptimizer.getPerformanceReport();
    
    res.json({
      enabled: true,
      mode: 'auto',
      efficiency: report.improvement.overall / 100,
      lastOptimization: new Date(),
      currentParams: params
    });
  }

  async getBatchMetrics(req: Request, res: Response) {
    const stats = this.batchProcessor.getStats();
    const queueInfo = this.batchProcessor.getQueueInfo();
    
    res.json({
      currentSize: stats.currentBatchSize,
      avgSize: stats.avgBatchSize,
      minSize: stats.minBatchSize,
      maxSize: stats.maxBatchSize,
      throughput: stats.throughput,
      queueDepth: queueInfo.totalSize,
      priorityDistribution: queueInfo.priorityCounts
    });
  }

  async getCacheStats(req: Request, res: Response) {
    const stats = this.cacheManager.getStats();
    const entries = this.cacheManager.getEntries();
    
    res.json({
      hitRate: stats.hitRate,
      missRate: 1 - stats.hitRate,
      evictions: stats.evictions,
      compressionRatio: stats.compressionRatio,
      totalSize: stats.size,
      entryCount: stats.entries,
      avgTTL: stats.avgTTL,
      cacheTypes: this.aggregateCacheTypes(entries)
    });
  }

  setupSSE(req: Request, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial connection confirmation
    res.write('event: connected\ndata: {}\n\n');

    // Set up event listeners
    const metricsInterval = setInterval(() => {
      const metrics = this.gatherMetrics();
      res.write(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`);
    }, 5000);

    const alertListener = (alert: any) => {
      res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
    };

    const optimizationListener = (data: any) => {
      res.write(`event: optimization\ndata: ${JSON.stringify(data)}\n\n`);
    };

    this.eventBus.on('alert:created', alertListener);
    this.eventBus.on('optimization:updated', optimizationListener);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(metricsInterval);
      this.eventBus.off('alert:created', alertListener);
      this.eventBus.off('optimization:updated', optimizationListener);
    });
  }
}
```

## Testing Strategy

### 1. Unit Tests

```typescript
// tests/components/enhanced-health-score.test.ts
describe('EnhancedHealthScore', () => {
  it('should calculate health score correctly', () => {
    const component = new EnhancedHealthScore(mockContainer);
    const data = {
      monitors: [{ parseRate: 0.95 }, { parseRate: 0.98 }],
      circuitBreakers: [
        { state: 'CLOSED' },
        { state: 'OPEN' },
        { state: 'CLOSED' }
      ],
      optimization: { efficiency: 0.85 },
      cache: { hitRate: 0.92 },
      errorRate: 0.5,
      system: { uptime: 86400000 } // 24 hours
    };
    
    const score = component.calculate(data);
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThan(100);
  });
});
```

### 2. Integration Tests

```typescript
// tests/integration/realtime-updates.test.ts
describe('Realtime Updates', () => {
  it('should receive SSE events', (done) => {
    const eventSource = new EventSource('/api/v1/performance/stream');
    
    eventSource.addEventListener('metrics', (event) => {
      const data = JSON.parse(event.data);
      expect(data).toHaveProperty('monitors');
      expect(data).toHaveProperty('optimization');
      eventSource.close();
      done();
    });
  });
});
```

### 3. Load Testing

```javascript
// tests/load/dashboard-performance.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 50,
  duration: '5m',
};

export default function() {
  // Test API endpoints
  const responses = http.batch([
    ['GET', 'http://localhost:3001/api/v1/fault-tolerance/status'],
    ['GET', 'http://localhost:3001/api/v1/performance/optimization/status'],
    ['GET', 'http://localhost:3001/api/v1/performance/cache/stats']
  ]);
  
  responses.forEach(response => {
    check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 200ms': (r) => r.timings.duration < 200,
    });
  });
}
```

## Deployment Considerations

### 1. Environment Variables

```bash
# Fault Tolerance Configuration
FAULT_TOLERANCE_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=3
CIRCUIT_BREAKER_TIMEOUT=5000
CHECKPOINT_INTERVAL=60000

# Performance Optimization Configuration
PERFORMANCE_OPTIMIZATION_ENABLED=true
OPTIMIZATION_MODE=auto
BATCH_MIN_SIZE=10
BATCH_MAX_SIZE=100
CACHE_MAX_SIZE=1000000
```

### 2. Monitoring & Alerting

- Set up Prometheus metrics export
- Configure Grafana dashboards
- Set up PagerDuty integration for critical alerts
- Implement log aggregation with ELK stack

### 3. Performance Requirements

- Dashboard should load in < 2 seconds
- Real-time updates latency < 100ms
- Support 100+ concurrent users
- Memory usage < 500MB per client

## Conclusion

This comprehensive upgrade plan transforms the streaming-metrics.html dashboard from a basic monitoring tool into a sophisticated operations center that provides:

1. **Deep visibility** into fault tolerance mechanisms
2. **Real-time insights** into performance optimization
3. **Proactive alerting** for system issues
4. **Interactive visualizations** for complex data
5. **Actionable recommendations** for system optimization

The implementation leverages the Session 8 & 9 features to create a powerful monitoring solution that helps operators maintain optimal system performance and quickly respond to issues.