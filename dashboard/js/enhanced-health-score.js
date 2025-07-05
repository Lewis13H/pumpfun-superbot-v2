/**
 * Enhanced Health Score Component
 * Calculates and displays system health based on multiple metrics
 */
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
        this.scoreHistory = [];
        this.maxHistoryLength = 60; // Keep last 60 data points
    }

    calculate(data) {
        let score = 0;
        let breakdown = {};
        
        // Parse rate component (25%)
        const avgParseRate = this.calculateAverageParseRate(data.monitors || []);
        breakdown.parseRate = avgParseRate * 100;
        score += avgParseRate * 100 * this.weights.parseRate;
        
        // Circuit breaker health (20%)
        const cbHealth = this.calculateCircuitBreakerHealth(data.circuitBreakers || []);
        breakdown.circuitBreakerHealth = cbHealth * 100;
        score += cbHealth * 100 * this.weights.circuitBreakerHealth;
        
        // Performance efficiency (20%)
        const perfEfficiency = data.optimization?.efficiency || 0;
        breakdown.performanceEfficiency = perfEfficiency * 100;
        score += perfEfficiency * 100 * this.weights.performanceEfficiency;
        
        // Cache hit rate (10%)
        const cacheHitRate = data.cache?.hitRate || 0;
        breakdown.cacheHitRate = cacheHitRate * 100;
        score += cacheHitRate * 100 * this.weights.cacheHitRate;
        
        // Error rate (inverse) (10%)
        const errorRate = data.errorRate || 0;
        const errorScore = 1 - Math.min(errorRate / 5, 1);
        breakdown.errorRate = errorScore * 100;
        score += errorScore * 100 * this.weights.errorRate;
        
        // Uptime bonus (15%)
        const uptimeScore = this.calculateUptimeScore(data.system?.uptime);
        breakdown.uptime = uptimeScore * 100;
        score += uptimeScore * 100 * this.weights.uptime;
        
        // Track history
        this.scoreHistory.push({
            timestamp: new Date(),
            score: Math.round(Math.min(score, 100)),
            breakdown
        });
        
        if (this.scoreHistory.length > this.maxHistoryLength) {
            this.scoreHistory.shift();
        }
        
        return {
            score: Math.round(Math.min(score, 100)),
            breakdown,
            trend: this.calculateTrend()
        };
    }

    calculateAverageParseRate(monitors) {
        if (!monitors.length) return 0.95; // Default to 95% if no data
        const total = monitors.reduce((sum, m) => sum + (m.parseRate || 0), 0);
        return total / monitors.length;
    }

    calculateCircuitBreakerHealth(circuitBreakers) {
        if (!circuitBreakers.length) return 1; // All healthy if no data
        
        let healthScore = 0;
        circuitBreakers.forEach(cb => {
            switch (cb.state) {
                case 'CLOSED':
                    healthScore += 1;
                    break;
                case 'HALF_OPEN':
                    healthScore += 0.5;
                    break;
                case 'OPEN':
                    healthScore += 0;
                    break;
            }
        });
        
        return healthScore / circuitBreakers.length;
    }

    calculateUptimeScore(uptimeMs) {
        if (!uptimeMs) return 1;
        
        const hours = uptimeMs / (1000 * 60 * 60);
        
        // Perfect score for > 24 hours
        if (hours >= 24) return 1;
        
        // Linear scale for < 24 hours
        return hours / 24;
    }

    calculateTrend() {
        if (this.scoreHistory.length < 2) return 'stable';
        
        const recent = this.scoreHistory.slice(-10);
        const older = this.scoreHistory.slice(-20, -10);
        
        if (older.length === 0) return 'stable';
        
        const recentAvg = recent.reduce((sum, h) => sum + h.score, 0) / recent.length;
        const olderAvg = older.reduce((sum, h) => sum + h.score, 0) / older.length;
        
        const diff = recentAvg - olderAvg;
        
        if (diff > 5) return 'improving';
        if (diff < -5) return 'declining';
        return 'stable';
    }

    getStatus(score) {
        if (score >= 90) return { text: 'EXCELLENT', class: 'status-excellent', color: '#10b981' };
        if (score >= 75) return { text: 'GOOD', class: 'status-good', color: '#3b82f6' };
        if (score >= 50) return { text: 'WARNING', class: 'status-warning', color: '#f59e0b' };
        return { text: 'CRITICAL', class: 'status-critical', color: '#ef4444' };
    }

    render(data) {
        const result = this.calculate(data);
        const status = this.getStatus(result.score);
        
        this.container.innerHTML = `
            <div class="enhanced-health-score-wrapper">
                <div class="health-score-main">
                    <div class="health-score-ring ${status.class}">
                        <svg viewBox="0 0 200 200" class="health-ring-svg">
                            <circle cx="100" cy="100" r="90" fill="none" stroke="#334155" stroke-width="12"/>
                            <circle cx="100" cy="100" r="90" fill="none" 
                                    stroke="${status.color}" 
                                    stroke-width="12"
                                    stroke-dasharray="${result.score * 5.65} 565"
                                    stroke-dashoffset="0"
                                    transform="rotate(-90 100 100)"
                                    class="health-ring-progress"/>
                        </svg>
                        <div class="health-score-text">
                            <div class="score">${result.score}%</div>
                            <div class="label">Health Score</div>
                        </div>
                    </div>
                    <div class="health-status ${status.class}">${status.text}</div>
                    <div class="health-trend trend-${result.trend}">
                        ${this.getTrendIcon(result.trend)} ${this.getTrendText(result.trend)}
                    </div>
                </div>
                <div class="health-breakdown">
                    <h4 class="breakdown-title">Score Breakdown</h4>
                    ${this.renderBreakdown(result.breakdown)}
                </div>
                <div class="health-history">
                    <canvas id="healthHistoryChart" width="300" height="100"></canvas>
                </div>
            </div>
        `;
        
        // Render mini chart
        this.renderHistoryChart();
    }

    renderBreakdown(breakdown) {
        const items = [
            { key: 'parseRate', label: 'Parse Rate', icon: '📊' },
            { key: 'circuitBreakerHealth', label: 'Circuit Breakers', icon: '⚡' },
            { key: 'performanceEfficiency', label: 'Performance', icon: '🚀' },
            { key: 'cacheHitRate', label: 'Cache Hits', icon: '💾' },
            { key: 'errorRate', label: 'Error Rate', icon: '⚠️' },
            { key: 'uptime', label: 'Uptime', icon: '⏱️' }
        ];
        
        return items.map(item => `
            <div class="health-factor">
                <div class="factor-header">
                    <span class="factor-icon">${item.icon}</span>
                    <span class="factor-label">${item.label}</span>
                </div>
                <div class="factor-bar">
                    <div class="factor-progress" style="width: ${breakdown[item.key] || 0}%"></div>
                </div>
                <span class="factor-value">${Math.round(breakdown[item.key] || 0)}%</span>
            </div>
        `).join('');
    }

    renderHistoryChart() {
        const canvas = document.getElementById('healthHistoryChart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (this.scoreHistory.length < 2) return;
        
        // Draw grid
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 0.5;
        
        // Horizontal lines
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Draw score line
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const xStep = width / (this.maxHistoryLength - 1);
        this.scoreHistory.forEach((point, i) => {
            const x = i * xStep;
            const y = height - (point.score / 100) * height;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Draw area fill
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();
    }

    getTrendIcon(trend) {
        switch (trend) {
            case 'improving': return '📈';
            case 'declining': return '📉';
            default: return '➡️';
        }
    }

    getTrendText(trend) {
        switch (trend) {
            case 'improving': return 'Improving';
            case 'declining': return 'Declining';
            default: return 'Stable';
        }
    }
}