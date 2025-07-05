/**
 * Performance Optimization Dashboard Component
 * Displays real-time performance metrics and optimization suggestions
 */
class PerformanceOptimizationDashboard {
    constructor(container) {
        this.container = container;
        this.charts = {};
        this.metrics = {
            batchSize: [],
            cacheHitRate: [],
            throughput: [],
            latency: []
        };
        this.maxDataPoints = 50;
    }

    initialize() {
        this.render();
        this.initializeCharts();
    }

    render() {
        this.container.innerHTML = `
            <div class="performance-optimization-wrapper">
                <div class="perf-header">
                    <h3 class="section-title">Performance Optimization</h3>
                    <div class="optimization-status" id="optimizationStatus">
                        <span class="opt-indicator"></span>
                        <span class="opt-text">Auto-Optimization Active</span>
                    </div>
                </div>
                
                <div class="perf-metrics-grid">
                    <!-- Batch Processing Metrics -->
                    <div class="perf-card">
                        <div class="perf-card-header">
                            <h4>Batch Processing</h4>
                            <span class="perf-icon">📦</span>
                        </div>
                        <div class="perf-card-content">
                            <div class="perf-metric-display">
                                <span class="metric-value" id="currentBatchSize">--</span>
                                <span class="metric-label">Current Batch Size</span>
                            </div>
                            <div class="perf-sub-metrics">
                                <div class="sub-metric">
                                    <span class="sub-label">Efficiency</span>
                                    <span class="sub-value" id="batchEfficiency">--%</span>
                                </div>
                                <div class="sub-metric">
                                    <span class="sub-label">Avg Latency</span>
                                    <span class="sub-value" id="avgBatchLatency">--ms</span>
                                </div>
                            </div>
                            <canvas id="batchSizeTrendChart" class="perf-mini-chart"></canvas>
                        </div>
                    </div>
                    
                    <!-- Cache Performance -->
                    <div class="perf-card">
                        <div class="perf-card-header">
                            <h4>Cache Performance</h4>
                            <span class="perf-icon">💾</span>
                        </div>
                        <div class="perf-card-content">
                            <div class="cache-efficiency-gauge" id="cacheEfficiencyGauge">
                                <svg viewBox="0 0 200 100" class="gauge-svg">
                                    <path d="M 30 90 A 70 70 0 0 1 170 90" fill="none" stroke="#334155" stroke-width="15"/>
                                    <path id="cacheGaugeFill" d="M 30 90 A 70 70 0 0 1 170 90" fill="none" stroke="#10b981" stroke-width="15" stroke-dasharray="0 220"/>
                                </svg>
                                <div class="gauge-value">
                                    <span id="cacheHitRate">--%</span>
                                    <span class="gauge-label">Hit Rate</span>
                                </div>
                            </div>
                            <div class="perf-sub-metrics">
                                <div class="sub-metric">
                                    <span class="sub-label">Compression</span>
                                    <span class="sub-value" id="cacheCompression">--x</span>
                                </div>
                                <div class="sub-metric">
                                    <span class="sub-label">Evictions</span>
                                    <span class="sub-value" id="cacheEvictions">--</span>
                                </div>
                            </div>
                            <div id="cacheDistribution" class="cache-distribution"></div>
                        </div>
                    </div>
                    
                    <!-- Resource Allocation -->
                    <div class="perf-card">
                        <div class="perf-card-header">
                            <h4>Resource Allocation</h4>
                            <span class="perf-icon">🎯</span>
                        </div>
                        <div class="perf-card-content">
                            <canvas id="resourceAllocationChart" class="resource-chart"></canvas>
                            <div class="resource-legend" id="resourceLegend"></div>
                        </div>
                    </div>
                </div>
                
                <!-- Optimization Suggestions -->
                <div class="optimization-suggestions-wrapper">
                    <h4 class="suggestions-title">Optimization Suggestions</h4>
                    <div id="optimizationSuggestions" class="suggestions-container">
                        <div class="no-suggestions">
                            <span class="icon">✅</span>
                            <span>System is optimally configured</span>
                        </div>
                    </div>
                </div>
                
                <!-- Performance Trends -->
                <div class="perf-trends-section">
                    <div class="trends-header">
                        <h4>Performance Trends</h4>
                        <div class="trend-controls">
                            <button class="trend-btn active" data-metric="throughput">Throughput</button>
                            <button class="trend-btn" data-metric="latency">Latency</button>
                            <button class="trend-btn" data-metric="efficiency">Efficiency</button>
                        </div>
                    </div>
                    <canvas id="performanceTrendChart" class="trend-chart"></canvas>
                </div>
            </div>
        `;
        
        // Add event listeners
        this.setupEventListeners();
    }

    initializeCharts() {
        // Batch size trend chart
        const batchCtx = document.getElementById('batchSizeTrendChart').getContext('2d');
        this.charts.batchSize = new Chart(batchCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Batch Size',
                    data: [],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { display: false },
                    y: { 
                        display: false,
                        min: 0,
                        max: 100
                    }
                }
            }
        });
        
        // Resource allocation pie chart
        const resourceCtx = document.getElementById('resourceAllocationChart').getContext('2d');
        this.charts.resourceAllocation = new Chart(resourceCtx, {
            type: 'doughnut',
            data: {
                labels: ['Connections', 'Cache', 'Processing', 'Available'],
                datasets: [{
                    data: [25, 25, 25, 25],
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#e5e7eb'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                cutout: '70%'
            }
        });
        
        // Performance trend chart
        const trendCtx = document.getElementById('performanceTrendChart').getContext('2d');
        this.charts.performanceTrend = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Throughput',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#94a3b8' }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: '#334155',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: { color: '#334155' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        display: true,
                        grid: { color: '#334155' },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    update(data) {
        this.updateBatchingMetrics(data.batching);
        this.updateCacheMetrics(data.cache);
        this.updateResourceMetrics(data.resources);
        this.updateOptimizationSuggestions(data.suggestions);
        this.updateTrends(data);
    }

    updateBatchingMetrics(batchData) {
        if (!batchData) return;
        
        // Update display values
        document.getElementById('currentBatchSize').textContent = batchData.currentSize || '--';
        document.getElementById('batchEfficiency').textContent = 
            batchData.efficiency ? `${(batchData.efficiency * 100).toFixed(1)}%` : '--%';
        document.getElementById('avgBatchLatency').textContent = 
            batchData.avgLatency ? `${batchData.avgLatency.toFixed(0)}ms` : '--ms';
        
        // Update batch size trend
        this.updateMiniChart('batchSize', batchData.currentSize);
    }

    updateCacheMetrics(cacheData) {
        if (!cacheData) return;
        
        // Update gauge
        const hitRate = cacheData.hitRate || 0;
        document.getElementById('cacheHitRate').textContent = `${(hitRate * 100).toFixed(1)}%`;
        this.updateCacheGauge(hitRate);
        
        // Update stats
        document.getElementById('cacheCompression').textContent = 
            cacheData.compressionRatio ? `${cacheData.compressionRatio.toFixed(2)}x` : '--x';
        document.getElementById('cacheEvictions').textContent = 
            cacheData.evictions?.toLocaleString() || '--';
        
        // Update cache type distribution
        if (cacheData.cacheTypes) {
            this.renderCacheTypeDistribution(cacheData.cacheTypes);
        }
    }

    updateCacheGauge(hitRate) {
        const gaugeFill = document.getElementById('cacheGaugeFill');
        if (gaugeFill) {
            const dashArray = `${hitRate * 220} 220`;
            gaugeFill.setAttribute('stroke-dasharray', dashArray);
            
            // Update color based on hit rate
            let color = '#ef4444'; // Red
            if (hitRate > 0.8) color = '#10b981'; // Green
            else if (hitRate > 0.6) color = '#f59e0b'; // Yellow
            
            gaugeFill.setAttribute('stroke', color);
        }
    }

    renderCacheTypeDistribution(cacheTypes) {
        const container = document.getElementById('cacheDistribution');
        if (!container) return;
        
        const total = Object.values(cacheTypes).reduce((sum, type) => sum + (type.size || 0), 0);
        
        container.innerHTML = Object.entries(cacheTypes).map(([name, stats]) => `
            <div class="cache-type-item">
                <div class="cache-type-header">
                    <span class="cache-type-name">${name}</span>
                    <span class="cache-type-hit-rate">${((stats.hitRate || 0) * 100).toFixed(0)}%</span>
                </div>
                <div class="cache-type-bar">
                    <div class="cache-type-fill" style="width: ${total > 0 ? (stats.size / total * 100) : 0}%"></div>
                </div>
                <div class="cache-type-stats">
                    <span>${this.formatBytes(stats.size || 0)}</span>
                    <span>${stats.entries || 0} entries</span>
                </div>
            </div>
        `).join('');
    }

    updateResourceMetrics(resources) {
        if (!resources || !this.charts.resourceAllocation) return;
        
        // Update resource allocation chart
        const data = [
            resources.connections || 25,
            resources.cache || 25,
            resources.processing || 25,
            resources.available || 25
        ];
        
        this.charts.resourceAllocation.data.datasets[0].data = data;
        this.charts.resourceAllocation.update('none');
        
        // Update legend
        this.updateResourceLegend(data);
    }

    updateResourceLegend(data) {
        const container = document.getElementById('resourceLegend');
        if (!container) return;
        
        const labels = ['Connections', 'Cache', 'Processing', 'Available'];
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#e5e7eb'];
        
        container.innerHTML = labels.map((label, i) => `
            <div class="legend-item">
                <span class="legend-color" style="background: ${colors[i]}"></span>
                <span class="legend-label">${label}</span>
                <span class="legend-value">${data[i]}%</span>
            </div>
        `).join('');
    }

    updateOptimizationSuggestions(suggestions) {
        const container = document.getElementById('optimizationSuggestions');
        if (!container) return;
        
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

    updateMiniChart(chartName, value) {
        if (!this.charts[chartName]) return;
        
        // Add new data point
        this.metrics[chartName].push(value);
        if (this.metrics[chartName].length > this.maxDataPoints) {
            this.metrics[chartName].shift();
        }
        
        // Update chart
        const chart = this.charts[chartName];
        chart.data.labels = this.metrics[chartName].map((_, i) => i);
        chart.data.datasets[0].data = this.metrics[chartName];
        chart.update('none');
    }

    updateTrends(data) {
        // Update performance trend chart based on selected metric
        const activeMetric = document.querySelector('.trend-btn.active')?.dataset.metric || 'throughput';
        this.updateTrendChart(activeMetric, data);
    }

    updateTrendChart(metric, data) {
        if (!this.charts.performanceTrend) return;
        
        let value, label, color;
        switch (metric) {
            case 'throughput':
                value = data.batching?.throughput || 0;
                label = 'Throughput (msg/s)';
                color = '#10b981';
                break;
            case 'latency':
                value = data.batching?.avgLatency || 0;
                label = 'Latency (ms)';
                color = '#f59e0b';
                break;
            case 'efficiency':
                value = (data.optimization?.efficiency || 0) * 100;
                label = 'Efficiency (%)';
                color = '#3b82f6';
                break;
        }
        
        // Update metric history
        if (!this.metrics[metric]) {
            this.metrics[metric] = [];
        }
        this.metrics[metric].push(value);
        if (this.metrics[metric].length > this.maxDataPoints) {
            this.metrics[metric].shift();
        }
        
        // Update chart
        const chart = this.charts.performanceTrend;
        chart.data.labels = this.metrics[metric].map((_, i) => i);
        chart.data.datasets[0] = {
            label: label,
            data: this.metrics[metric],
            borderColor: color,
            backgroundColor: color + '20',
            tension: 0.4,
            pointRadius: 0
        };
        chart.update();
    }

    setupEventListeners() {
        // Trend control buttons
        document.querySelectorAll('.trend-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.trend-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                // Trigger update with current data
                this.updateTrends(this.lastData || {});
            });
        });
    }

    getSuggestionIcon(type) {
        const icons = {
            batch: '📦',
            cache: '💾',
            resource: '🎯',
            memory: '🧠',
            performance: '🚀',
            warning: '⚠️'
        };
        return icons[type] || '💡';
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    destroy() {
        // Cleanup charts
        Object.values(this.charts).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.charts = {};
    }
}