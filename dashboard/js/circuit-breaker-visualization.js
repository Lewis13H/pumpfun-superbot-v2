/**
 * Circuit Breaker Visualization Component
 * Displays circuit breaker states and metrics
 */
class CircuitBreakerVisualization {
    constructor(container) {
        this.container = container;
        this.circuitBreakers = new Map();
        this.animationFrameId = null;
    }

    update(circuitBreakers) {
        // Update internal state
        circuitBreakers.forEach(cb => {
            const existing = this.circuitBreakers.get(cb.connectionId);
            if (existing) {
                // Track state changes for animation
                cb.previousState = existing.state;
                cb.stateChanged = existing.state !== cb.state;
            }
            this.circuitBreakers.set(cb.connectionId, cb);
        });
        
        // Render the visualization
        this.render();
    }

    render() {
        const circuitBreakers = Array.from(this.circuitBreakers.values());
        
        if (circuitBreakers.length === 0) {
            this.container.innerHTML = `
                <div class="circuit-breakers-empty">
                    <div class="empty-icon">⚡</div>
                    <p>No circuit breakers configured</p>
                </div>
            `;
            return;
        }
        
        const html = `
            <div class="circuit-breakers-wrapper">
                <div class="circuit-breakers-header">
                    <h3 class="section-title">Circuit Breakers</h3>
                    <div class="circuit-summary">
                        ${this.renderSummary(circuitBreakers)}
                    </div>
                </div>
                <div class="circuit-breakers-grid">
                    ${circuitBreakers.map(cb => this.renderCircuitBreaker(cb)).join('')}
                </div>
            </div>
        `;
        
        this.container.innerHTML = html;
        
        // Add animations after render
        this.animateStateChanges();
    }

    renderSummary(circuitBreakers) {
        const counts = {
            closed: 0,
            open: 0,
            halfOpen: 0
        };
        
        circuitBreakers.forEach(cb => {
            switch (cb.state) {
                case 'CLOSED':
                    counts.closed++;
                    break;
                case 'OPEN':
                    counts.open++;
                    break;
                case 'HALF_OPEN':
                    counts.halfOpen++;
                    break;
            }
        });
        
        return `
            <span class="summary-item summary-closed">
                <span class="summary-icon">🟢</span>
                <span class="summary-count">${counts.closed}</span>
            </span>
            <span class="summary-item summary-half-open">
                <span class="summary-icon">🟡</span>
                <span class="summary-count">${counts.halfOpen}</span>
            </span>
            <span class="summary-item summary-open">
                <span class="summary-icon">🔴</span>
                <span class="summary-count">${counts.open}</span>
            </span>
        `;
    }

    renderCircuitBreaker(cb) {
        const stateClass = this.getStateClass(cb.state);
        const stateIcon = this.getStateIcon(cb.state);
        const timeSinceLastFailure = cb.lastFailure ? this.getTimeSince(cb.lastFailure) : null;
        const timeSinceLastSuccess = cb.lastSuccess ? this.getTimeSince(cb.lastSuccess) : null;
        
        return `
            <div class="circuit-breaker-card ${stateClass} ${cb.stateChanged ? 'state-changed' : ''}" 
                 data-connection-id="${cb.connectionId}">
                <div class="cb-header">
                    <span class="cb-connection">${cb.connectionId}</span>
                    <span class="cb-state-icon">${stateIcon}</span>
                </div>
                
                <div class="cb-state-section">
                    <div class="cb-state-indicator">
                        <div class="cb-state-text">${cb.state}</div>
                        ${cb.state === 'HALF_OPEN' ? 
                            `<div class="cb-recovery-progress">
                                <div class="recovery-bar">
                                    <div class="recovery-fill"></div>
                                </div>
                                <span class="recovery-text">Testing...</span>
                            </div>` : ''}
                    </div>
                    
                    ${this.renderStateTransition(cb)}
                </div>
                
                <div class="cb-metrics">
                    <div class="cb-metric">
                        <span class="metric-label">Failures</span>
                        <span class="metric-value ${cb.failures > 0 ? 'metric-warning' : ''}">${cb.failures}</span>
                    </div>
                    <div class="cb-metric">
                        <span class="metric-label">Parse Rate</span>
                        <span class="metric-value ${cb.parseRate < 0.9 ? 'metric-warning' : ''}">${(cb.parseRate * 100).toFixed(1)}%</span>
                    </div>
                    <div class="cb-metric">
                        <span class="metric-label">Latency</span>
                        <span class="metric-value ${cb.latency > 100 ? 'metric-warning' : ''}">${cb.latency}ms</span>
                    </div>
                </div>
                
                <div class="cb-timeline">
                    ${timeSinceLastFailure ? 
                        `<div class="timeline-item timeline-failure">
                            <span class="timeline-icon">❌</span>
                            <span class="timeline-text">Failed ${timeSinceLastFailure}</span>
                        </div>` : ''}
                    ${timeSinceLastSuccess ? 
                        `<div class="timeline-item timeline-success">
                            <span class="timeline-icon">✅</span>
                            <span class="timeline-text">Success ${timeSinceLastSuccess}</span>
                        </div>` : ''}
                </div>
                
                <div class="cb-health-bar">
                    <div class="health-bar-fill" style="width: ${this.calculateHealthPercentage(cb)}%"></div>
                </div>
            </div>
        `;
    }

    renderStateTransition(cb) {
        if (!cb.stateChanged) return '';
        
        return `
            <div class="state-transition">
                <span class="transition-from">${this.getStateIcon(cb.previousState)}</span>
                <span class="transition-arrow">→</span>
                <span class="transition-to">${this.getStateIcon(cb.state)}</span>
            </div>
        `;
    }

    calculateHealthPercentage(cb) {
        // Health based on parse rate, latency, and failures
        let health = 100;
        
        // Parse rate impact (0-40 points)
        health -= (1 - cb.parseRate) * 40;
        
        // Latency impact (0-30 points)
        const latencyPenalty = Math.min(cb.latency / 200, 1) * 30;
        health -= latencyPenalty;
        
        // Failure impact (0-30 points)
        const failurePenalty = Math.min(cb.failures / 10, 1) * 30;
        health -= failurePenalty;
        
        return Math.max(0, Math.round(health));
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

    getTimeSince(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    animateStateChanges() {
        // Cancel previous animation
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        // Find cards with state changes
        const changedCards = this.container.querySelectorAll('.state-changed');
        
        changedCards.forEach(card => {
            // Remove the class after animation
            setTimeout(() => {
                card.classList.remove('state-changed');
            }, 1000);
        });
        
        // Animate recovery progress bars
        const recoveryBars = this.container.querySelectorAll('.recovery-fill');
        recoveryBars.forEach(bar => {
            this.animateRecoveryBar(bar);
        });
    }

    animateRecoveryBar(bar) {
        let width = 0;
        const animate = () => {
            width = (width + 1) % 100;
            bar.style.width = `${width}%`;
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
    }

    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }
}