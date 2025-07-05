/**
 * Realtime Data Manager
 * Manages SSE connections and data distribution to UI components
 */
class RealtimeDataManager {
    constructor() {
        this.eventSource = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.listeners = new Map();
        this.connectionStatus = 'disconnected';
        this.dataCache = {
            faultTolerance: {},
            performance: {},
            alerts: []
        };
    }

    connect() {
        console.log('Connecting to SSE stream...');
        
        try {
            this.eventSource = new EventSource('/api/v1/performance/stream');
            
            this.eventSource.onopen = () => {
                console.log('Connected to real-time stream');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');
            };

            this.eventSource.onerror = (error) => {
                console.error('Stream error:', error);
                this.updateConnectionStatus('error');
                
                if (this.eventSource.readyState === EventSource.CLOSED) {
                    this.reconnect();
                }
            };

            // Handle different event types
            this.setupEventHandlers();
            
            // Start polling for additional data
            this.startPolling();
            
        } catch (error) {
            console.error('Failed to connect to stream:', error);
            this.reconnect();
        }
    }

    setupEventHandlers() {
        // Connected event
        this.eventSource.addEventListener('connected', (event) => {
            console.log('SSE connected event received');
            this.updateConnectionStatus('connected');
        });

        // System metrics update
        this.eventSource.addEventListener('metrics', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMetricsUpdate(data);
            } catch (error) {
                console.error('Error parsing metrics data:', error);
            }
        });

        // Fault tolerance alerts
        this.eventSource.addEventListener('alert', (event) => {
            try {
                const alert = JSON.parse(event.data);
                this.handleAlert(alert);
            } catch (error) {
                console.error('Error parsing alert data:', error);
            }
        });

        // Circuit breaker state changes
        this.eventSource.addEventListener('circuit-breaker', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleCircuitBreakerUpdate(data);
            } catch (error) {
                console.error('Error parsing circuit breaker data:', error);
            }
        });

        // Optimization updates
        this.eventSource.addEventListener('optimization', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleOptimizationUpdate(data);
            } catch (error) {
                console.error('Error parsing optimization data:', error);
            }
        });

        // Cache stats updates
        this.eventSource.addEventListener('cache-stats', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleCacheStatsUpdate(data);
            } catch (error) {
                console.error('Error parsing cache stats:', error);
            }
        });

        // Batch metrics updates
        this.eventSource.addEventListener('batch-metrics', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleBatchMetricsUpdate(data);
            } catch (error) {
                console.error('Error parsing batch metrics:', error);
            }
        });
    }

    handleMetricsUpdate(data) {
        this.dataCache.performance = {
            ...this.dataCache.performance,
            ...data
        };
        this.emit('metrics', data);
    }

    handleAlert(alert) {
        // Add to alerts cache
        this.dataCache.alerts.unshift(alert);
        if (this.dataCache.alerts.length > 100) {
            this.dataCache.alerts = this.dataCache.alerts.slice(0, 100);
        }
        
        this.emit('alert', alert);
    }

    handleCircuitBreakerUpdate(data) {
        this.dataCache.faultTolerance.circuitBreakers = data.circuitBreakers || [];
        this.emit('circuit-breaker', data);
    }

    handleOptimizationUpdate(data) {
        this.dataCache.performance.optimization = data;
        this.emit('optimization', data);
    }

    handleCacheStatsUpdate(data) {
        this.dataCache.performance.cache = data;
        this.emit('cache-stats', data);
    }

    handleBatchMetricsUpdate(data) {
        this.dataCache.performance.batching = data;
        this.emit('batch-metrics', data);
    }

    startPolling() {
        // Poll for fault tolerance status
        this.pollEndpoint('/api/v1/fault-tolerance/status', 5000, (data) => {
            this.dataCache.faultTolerance.status = data;
            this.emit('fault-tolerance-status', data);
        });

        // Poll for circuit breakers
        this.pollEndpoint('/api/v1/fault-tolerance/circuit-breakers', 5000, (data) => {
            this.dataCache.faultTolerance.circuitBreakers = data;
            this.emit('circuit-breakers', data);
        });

        // Poll for optimization status
        this.pollEndpoint('/api/v1/performance/optimization/status', 5000, (data) => {
            this.dataCache.performance.optimization = data;
            this.emit('optimization-status', data);
        });

        // Poll for performance suggestions
        this.pollEndpoint('/api/v1/performance/suggestions', 10000, (data) => {
            this.dataCache.performance.suggestions = data;
            this.emit('suggestions', data);
        });
    }

    async pollEndpoint(endpoint, interval, callback) {
        const poll = async () => {
            try {
                const response = await fetch(endpoint);
                if (response.ok) {
                    const data = await response.json();
                    callback(data);
                }
            } catch (error) {
                console.error(`Error polling ${endpoint}:`, error);
            }
        };

        // Initial poll
        poll();
        
        // Set up interval
        setInterval(poll, interval);
    }

    reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.updateConnectionStatus('failed');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.updateConnectionStatus('reconnecting');
        
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

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
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

    updateConnectionStatus(status) {
        this.connectionStatus = status;
        this.emit('connection-status', status);
        
        // Update UI indicator
        const indicator = document.getElementById('realtimeIndicator');
        if (indicator) {
            indicator.className = `realtime-indicator ${status}`;
            indicator.textContent = this.getStatusText(status);
        }
    }

    getStatusText(status) {
        const texts = {
            connected: 'Live',
            connecting: 'Connecting...',
            reconnecting: 'Reconnecting...',
            disconnected: 'Offline',
            error: 'Error',
            failed: 'Failed'
        };
        return texts[status] || 'Unknown';
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.updateConnectionStatus('disconnected');
    }

    getCache() {
        return this.dataCache;
    }

    // Test data generation for development
    generateTestData() {
        // Generate test metrics
        const testMetrics = {
            batch: {
                currentSize: Math.floor(Math.random() * 100),
                throughput: Math.floor(Math.random() * 1000),
                avgLatency: Math.floor(Math.random() * 100)
            },
            cache: {
                hitRate: Math.random(),
                size: Math.floor(Math.random() * 1000000),
                compressionRatio: 1 + Math.random() * 3
            },
            optimization: {
                efficiency: Math.random(),
                params: {
                    batchSize: 50,
                    batchTimeout: 1000,
                    cacheTTLMultiplier: 1,
                    maxConcurrentOps: 10
                }
            },
            resources: {
                cpu: Math.random() * 100,
                memory: Math.random() * 100
            },
            timestamp: new Date()
        };
        
        this.handleMetricsUpdate(testMetrics);
        
        // Generate test alert
        if (Math.random() > 0.8) {
            const severities = ['critical', 'warning', 'info'];
            const types = ['connection_failure', 'performance_degradation', 'high_latency'];
            
            const testAlert = {
                id: Date.now().toString(),
                severity: severities[Math.floor(Math.random() * severities.length)],
                type: types[Math.floor(Math.random() * types.length)],
                message: 'Test alert message',
                timestamp: new Date()
            };
            
            this.handleAlert(testAlert);
        }
        
        // Generate test circuit breaker data
        const testCircuitBreakers = [
            {
                connectionId: 'conn-1',
                state: ['CLOSED', 'OPEN', 'HALF_OPEN'][Math.floor(Math.random() * 3)],
                failures: Math.floor(Math.random() * 5),
                parseRate: 0.8 + Math.random() * 0.2,
                latency: Math.floor(Math.random() * 200),
                lastFailure: Math.random() > 0.5 ? new Date(Date.now() - Math.random() * 3600000) : null,
                lastSuccess: new Date(Date.now() - Math.random() * 60000)
            },
            {
                connectionId: 'conn-2',
                state: ['CLOSED', 'OPEN', 'HALF_OPEN'][Math.floor(Math.random() * 3)],
                failures: Math.floor(Math.random() * 5),
                parseRate: 0.8 + Math.random() * 0.2,
                latency: Math.floor(Math.random() * 200),
                lastFailure: Math.random() > 0.5 ? new Date(Date.now() - Math.random() * 3600000) : null,
                lastSuccess: new Date(Date.now() - Math.random() * 60000)
            }
        ];
        
        this.handleCircuitBreakerUpdate({ circuitBreakers: testCircuitBreakers });
    }
}