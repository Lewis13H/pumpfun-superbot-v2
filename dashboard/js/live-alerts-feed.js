/**
 * Live Alerts Feed Component
 * Displays real-time system alerts and notifications
 */
class LiveAlertsFeed {
    constructor(container, options = {}) {
        this.container = container;
        this.alerts = [];
        this.maxAlerts = options.maxAlerts || 50;
        this.filters = {
            severity: 'all'
        };
        this.notificationPermission = false;
        this.soundEnabled = options.soundEnabled || false;
        this.alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBi+Ew/DuckQGHWq+6+OZURE');
        
        this.init();
    }

    init() {
        this.render();
        this.checkNotificationPermission();
    }

    async checkNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            this.notificationPermission = await Notification.requestPermission() === 'granted';
        } else if ('Notification' in window) {
            this.notificationPermission = Notification.permission === 'granted';
        }
    }

    render() {
        this.container.innerHTML = `
            <div class="alerts-panel">
                <div class="alerts-header">
                    <h3 class="alerts-title">
                        <span class="alerts-icon">🔔</span>
                        Live Alerts
                        <span class="alerts-count" id="alertsCount">(0)</span>
                    </h3>
                    <div class="alerts-controls">
                        <div class="alert-filters">
                            <button class="filter-btn active" data-severity="all">All</button>
                            <button class="filter-btn" data-severity="critical">Critical</button>
                            <button class="filter-btn" data-severity="warning">Warning</button>
                            <button class="filter-btn" data-severity="info">Info</button>
                        </div>
                        <button class="sound-toggle ${this.soundEnabled ? 'enabled' : ''}" id="soundToggle" title="Toggle sound">
                            ${this.soundEnabled ? '🔊' : '🔇'}
                        </button>
                    </div>
                </div>
                <div class="alerts-feed" id="alertsFeed">
                    <div class="alerts-empty">
                        <span class="empty-icon">🔔</span>
                        <span>No alerts to display</span>
                    </div>
                </div>
            </div>
        `;
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Filter buttons
        this.container.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.filters.severity = e.target.dataset.severity;
                this.renderAlerts();
            });
        });
        
        // Sound toggle
        const soundToggle = document.getElementById('soundToggle');
        if (soundToggle) {
            soundToggle.addEventListener('click', () => {
                this.soundEnabled = !this.soundEnabled;
                soundToggle.classList.toggle('enabled');
                soundToggle.textContent = this.soundEnabled ? '🔊' : '🔇';
            });
        }
    }

    addAlert(alert) {
        // Add unique ID and timestamp if not present
        alert.id = alert.id || Date.now().toString();
        alert.timestamp = alert.timestamp || new Date();
        
        // Add to beginning of array
        this.alerts.unshift(alert);
        
        // Limit array size
        if (this.alerts.length > this.maxAlerts) {
            this.alerts = this.alerts.slice(0, this.maxAlerts);
        }
        
        // Update UI
        this.renderAlerts();
        this.updateCount();
        
        // Show notification
        this.showNotification(alert);
        
        // Play sound for critical alerts
        if (alert.severity === 'critical' && this.soundEnabled) {
            this.playAlertSound();
        }
    }

    renderAlerts() {
        const feedElement = document.getElementById('alertsFeed');
        if (!feedElement) return;
        
        const filteredAlerts = this.filterAlerts();
        
        if (filteredAlerts.length === 0) {
            feedElement.innerHTML = `
                <div class="alerts-empty">
                    <span class="empty-icon">🔔</span>
                    <span>No ${this.filters.severity !== 'all' ? this.filters.severity : ''} alerts to display</span>
                </div>
            `;
            return;
        }
        
        feedElement.innerHTML = filteredAlerts.map(alert => this.renderAlert(alert)).join('');
        
        // Add click handlers for expandable alerts
        feedElement.querySelectorAll('.alert-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.alert-actions')) {
                    item.classList.toggle('expanded');
                }
            });
        });
    }

    renderAlert(alert) {
        const timeAgo = this.getTimeAgo(alert.timestamp);
        const severityIcon = this.getSeverityIcon(alert.severity);
        
        return `
            <div class="alert-item alert-${alert.severity}" data-id="${alert.id}">
                <div class="alert-header">
                    <div class="alert-severity">
                        <span class="severity-icon">${severityIcon}</span>
                        <span class="severity-text">${alert.severity.toUpperCase()}</span>
                    </div>
                    <span class="alert-time" title="${new Date(alert.timestamp).toLocaleString()}">${timeAgo}</span>
                </div>
                <div class="alert-content">
                    <div class="alert-type">${alert.type || 'System Alert'}</div>
                    <div class="alert-message">${alert.message}</div>
                    ${alert.connectionId ? 
                        `<div class="alert-connection">
                            <span class="connection-label">Connection:</span>
                            <span class="connection-id">${alert.connectionId}</span>
                        </div>` : ''}
                </div>
                ${alert.data ? 
                    `<div class="alert-details">
                        <div class="details-header">Details</div>
                        <pre class="details-content">${JSON.stringify(alert.data, null, 2)}</pre>
                    </div>` : ''}
                <div class="alert-actions">
                    <button class="alert-action-btn" onclick="dismissAlert('${alert.id}')" title="Dismiss">
                        <span>✕</span>
                    </button>
                </div>
            </div>
        `;
    }

    filterAlerts() {
        if (this.filters.severity === 'all') {
            return this.alerts;
        }
        return this.alerts.filter(alert => alert.severity === this.filters.severity);
    }

    updateCount() {
        const countElement = document.getElementById('alertsCount');
        if (countElement) {
            const count = this.alerts.length;
            countElement.textContent = `(${count})`;
            
            // Add pulse animation for new alerts
            countElement.classList.add('pulse');
            setTimeout(() => countElement.classList.remove('pulse'), 1000);
        }
    }

    showNotification(alert) {
        // Show toast notification
        this.showToast(alert.message, alert.severity);
        
        // Show browser notification for critical alerts
        if (alert.severity === 'critical' && this.notificationPermission) {
            new Notification('Critical System Alert', {
                body: alert.message,
                icon: '/favicon.ico',
                tag: alert.id,
                requireInteraction: true
            });
        }
    }

    showToast(message, severity = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${severity} show`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    playAlertSound() {
        if (this.alertSound) {
            this.alertSound.play().catch(e => console.log('Could not play alert sound:', e));
        }
    }

    getSeverityIcon(severity) {
        const icons = {
            critical: '🚨',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        return icons[severity] || '📢';
    }

    getTimeAgo(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    dismissAlert(alertId) {
        this.alerts = this.alerts.filter(a => a.id !== alertId);
        this.renderAlerts();
        this.updateCount();
    }

    clearAlerts(severity = null) {
        if (severity) {
            this.alerts = this.alerts.filter(a => a.severity !== severity);
        } else {
            this.alerts = [];
        }
        this.renderAlerts();
        this.updateCount();
    }

    // Test method to generate sample alerts
    generateTestAlert() {
        const severities = ['critical', 'warning', 'info'];
        const types = ['connection_failure', 'performance_degradation', 'high_latency', 'recovery_success'];
        const messages = [
            'Connection to gRPC endpoint failed',
            'Parse rate dropped below 90%',
            'High latency detected on primary connection',
            'System recovered from failure state',
            'Cache hit rate below optimal threshold'
        ];
        
        const alert = {
            severity: severities[Math.floor(Math.random() * severities.length)],
            type: types[Math.floor(Math.random() * types.length)],
            message: messages[Math.floor(Math.random() * messages.length)],
            connectionId: Math.random() > 0.5 ? `conn-${Math.floor(Math.random() * 3) + 1}` : undefined,
            data: Math.random() > 0.7 ? {
                parseRate: Math.random(),
                latency: Math.floor(Math.random() * 200),
                failures: Math.floor(Math.random() * 10)
            } : undefined
        };
        
        this.addAlert(alert);
    }
}

// Global function for dismissing alerts
window.dismissAlert = function(alertId) {
    const feedElement = document.querySelector('.alerts-feed');
    if (feedElement && feedElement.__alertsFeed) {
        feedElement.__alertsFeed.dismissAlert(alertId);
    }
};