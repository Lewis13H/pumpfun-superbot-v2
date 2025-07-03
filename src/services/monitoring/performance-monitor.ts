import { EventEmitter } from 'events';
import os from 'os';

interface StreamMetrics {
  messagesReceived: number;
  messagesParsed: number;
  messagesErrored: number;
  bytesReceived: number;
  parseLatencies: number[];
  streamLag: number;
  lastMessageTime: number;
  connectionUptime: number;
  reconnectCount: number;
}

interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  processMemory: NodeJS.MemoryUsage;
  uptime: number;
}

interface MonitorMetrics {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disconnected';
  messagesPerSecond: number;
  parseRate: number;
  averageLatency: number;
  errors24h: number;
  lastError?: {
    message: string;
    timestamp: Date;
    stack?: string;
  };
}

interface ErrorLog {
  id: string;
  timestamp: Date;
  level: 'error' | 'warn' | 'info';
  component: string;
  message: string;
  details?: any;
  stack?: string;
}

export class PerformanceMonitor extends EventEmitter {
  private streamMetrics: Map<string, StreamMetrics> = new Map();
  private systemMetrics: SystemMetrics;
  private monitorMetrics: Map<string, MonitorMetrics> = new Map();
  private errorLogs: ErrorLog[] = [];
  private maxErrorLogs = 1000;
  private metricsInterval: NodeJS.Timeout | null = null;
  private startTime = Date.now();
  
  // Performance thresholds
  private thresholds = {
    parseLatency: 50, // ms
    parseRate: 0.95, // 95%
    streamLag: 1000, // ms
    cpuUsage: 80, // %
    memoryUsage: 85, // %
    messagesPerSecond: 10, // minimum expected
  };

  constructor() {
    super();
    this.systemMetrics = this.getInitialSystemMetrics();
    this.startMetricsCollection();
  }

  private getInitialSystemMetrics(): SystemMetrics {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
      cpuUsage: 0,
      memoryUsage: {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100
      },
      processMemory: process.memoryUsage(),
      uptime: 0
    };
  }

  private startMetricsCollection() {
    // Update system metrics every 5 seconds
    this.metricsInterval = setInterval(() => {
      this.updateSystemMetrics();
      this.checkThresholds();
    }, 5000);

    // Track CPU usage
    let previousCpuUsage = process.cpuUsage();
    setInterval(() => {
      const currentCpuUsage = process.cpuUsage(previousCpuUsage);
      const totalUsage = (currentCpuUsage.user + currentCpuUsage.system) / 1000000; // Convert to seconds
      this.systemMetrics.cpuUsage = (totalUsage / 5) * 100; // Percentage over 5 second interval
      previousCpuUsage = process.cpuUsage();
    }, 5000);
  }

  private updateSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    this.systemMetrics = {
      cpuUsage: this.systemMetrics.cpuUsage,
      memoryUsage: {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100
      },
      processMemory: process.memoryUsage(),
      uptime: Date.now() - this.startTime
    };
  }

  // Track streaming metrics
  public recordMessage(monitorName: string, bytes: number) {
    const metrics = this.getOrCreateStreamMetrics(monitorName);
    metrics.messagesReceived++;
    metrics.bytesReceived += bytes;
    metrics.lastMessageTime = Date.now();
  }

  public recordParse(monitorName: string, success: boolean, latency: number) {
    const metrics = this.getOrCreateStreamMetrics(monitorName);
    
    if (success) {
      metrics.messagesParsed++;
    } else {
      metrics.messagesErrored++;
    }
    
    // Keep last 100 latencies for averaging
    metrics.parseLatencies.push(latency);
    if (metrics.parseLatencies.length > 100) {
      metrics.parseLatencies.shift();
    }
    
    this.updateMonitorMetrics(monitorName);
  }

  public recordError(component: string, error: Error, level: 'error' | 'warn' = 'error') {
    const errorLog: ErrorLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      component,
      message: error.message,
      stack: error.stack,
      details: {
        name: error.name,
        ...(error as any).details
      }
    };
    
    this.errorLogs.unshift(errorLog);
    
    // Keep only recent errors
    if (this.errorLogs.length > this.maxErrorLogs) {
      this.errorLogs = this.errorLogs.slice(0, this.maxErrorLogs);
    }
    
    // Update monitor error stats
    if (this.monitorMetrics.has(component)) {
      const monitor = this.monitorMetrics.get(component)!;
      monitor.lastError = {
        message: error.message,
        timestamp: new Date(),
        stack: error.stack
      };
      monitor.errors24h++;
    }
    
    // Emit error event
    this.emit('error:logged', errorLog);
  }

  public recordReconnect(monitorName: string) {
    const metrics = this.getOrCreateStreamMetrics(monitorName);
    metrics.reconnectCount++;
    metrics.connectionUptime = 0;
  }

  public recordStreamLag(monitorName: string, lag: number) {
    const metrics = this.getOrCreateStreamMetrics(monitorName);
    metrics.streamLag = lag;
  }

  private getOrCreateStreamMetrics(monitorName: string): StreamMetrics {
    if (!this.streamMetrics.has(monitorName)) {
      this.streamMetrics.set(monitorName, {
        messagesReceived: 0,
        messagesParsed: 0,
        messagesErrored: 0,
        bytesReceived: 0,
        parseLatencies: [],
        streamLag: 0,
        lastMessageTime: Date.now(),
        connectionUptime: 0,
        reconnectCount: 0
      });
    }
    return this.streamMetrics.get(monitorName)!;
  }

  private updateMonitorMetrics(monitorName: string) {
    const stream = this.streamMetrics.get(monitorName);
    if (!stream) return;
    
    const parseRate = stream.messagesReceived > 0 
      ? stream.messagesParsed / stream.messagesReceived 
      : 0;
    
    const avgLatency = stream.parseLatencies.length > 0
      ? stream.parseLatencies.reduce((a, b) => a + b, 0) / stream.parseLatencies.length
      : 0;
    
    // Calculate messages per second (over last minute)
    const timeWindow = 60000; // 1 minute
    const now = Date.now();
    const messagesInWindow = stream.messagesReceived; // Simplified for now
    const messagesPerSecond = messagesInWindow / (timeWindow / 1000);
    
    // Determine health status
    let status: MonitorMetrics['status'] = 'healthy';
    if (now - stream.lastMessageTime > 30000) {
      status = 'disconnected';
    } else if (parseRate < this.thresholds.parseRate) {
      status = 'degraded';
    } else if (avgLatency > this.thresholds.parseLatency) {
      status = 'degraded';
    } else if (stream.streamLag > this.thresholds.streamLag) {
      status = 'unhealthy';
    }
    
    const monitorMetric: MonitorMetrics = {
      name: monitorName,
      status,
      messagesPerSecond,
      parseRate,
      averageLatency: avgLatency,
      errors24h: this.monitorMetrics.get(monitorName)?.errors24h || 0,
      lastError: this.monitorMetrics.get(monitorName)?.lastError
    };
    
    this.monitorMetrics.set(monitorName, monitorMetric);
  }

  private checkThresholds() {
    const alerts: any[] = [];
    
    // Check system metrics
    if (this.systemMetrics.cpuUsage > this.thresholds.cpuUsage) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        message: `CPU usage high: ${this.systemMetrics.cpuUsage.toFixed(1)}%`
      });
    }
    
    if (this.systemMetrics.memoryUsage.percentage > this.thresholds.memoryUsage) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `Memory usage high: ${this.systemMetrics.memoryUsage.percentage.toFixed(1)}%`
      });
    }
    
    // Check monitor metrics
    for (const [name, monitor] of this.monitorMetrics) {
      if (monitor.status === 'unhealthy' || monitor.status === 'disconnected') {
        alerts.push({
          type: 'monitor',
          severity: 'error',
          message: `Monitor ${name} is ${monitor.status}`
        });
      }
      
      if (monitor.parseRate < this.thresholds.parseRate) {
        alerts.push({
          type: 'parse_rate',
          severity: 'warning',
          message: `Low parse rate for ${name}: ${(monitor.parseRate * 100).toFixed(1)}%`
        });
      }
    }
    
    // Emit alerts
    if (alerts.length > 0) {
      this.emit('alerts:generated', alerts);
    }
  }

  // API methods for dashboard
  public getCurrentMetrics() {
    return {
      system: this.systemMetrics,
      monitors: Array.from(this.monitorMetrics.values()),
      streams: Array.from(this.streamMetrics.entries()).map(([name, metrics]) => ({
        name,
        ...metrics
      })),
      health: this.getHealthScore()
    };
  }

  public getHealthScore(): number {
    let score = 100;
    
    // Deduct for system issues
    if (this.systemMetrics.cpuUsage > this.thresholds.cpuUsage) score -= 10;
    if (this.systemMetrics.memoryUsage.percentage > this.thresholds.memoryUsage) score -= 10;
    
    // Deduct for monitor issues
    for (const monitor of this.monitorMetrics.values()) {
      if (monitor.status === 'disconnected') score -= 20;
      else if (monitor.status === 'unhealthy') score -= 15;
      else if (monitor.status === 'degraded') score -= 10;
      
      if (monitor.parseRate < this.thresholds.parseRate) score -= 5;
    }
    
    return Math.max(0, score);
  }

  public getErrorLogs(limit = 100, filter?: { component?: string; level?: string }) {
    let logs = this.errorLogs;
    
    if (filter?.component) {
      logs = logs.filter(log => log.component === filter.component);
    }
    
    if (filter?.level) {
      logs = logs.filter(log => log.level === filter.level);
    }
    
    return logs.slice(0, limit);
  }

  public clearErrorLogs() {
    this.errorLogs = [];
    
    // Reset error counts
    for (const monitor of this.monitorMetrics.values()) {
      monitor.errors24h = 0;
      monitor.lastError = undefined;
    }
  }

  public getOptimizationRecommendations() {
    const recommendations: string[] = [];
    
    if (this.systemMetrics.cpuUsage > 70) {
      recommendations.push('Consider reducing parse complexity or adding more CPU cores');
    }
    
    if (this.systemMetrics.memoryUsage.percentage > 75) {
      recommendations.push('Memory usage is high. Consider increasing batch intervals or reducing cache sizes');
    }
    
    for (const [name, monitor] of this.monitorMetrics) {
      if (monitor.parseRate < 0.9) {
        recommendations.push(`${name}: Improve parser error handling or add fallback strategies`);
      }
      
      if (monitor.averageLatency > 40) {
        recommendations.push(`${name}: Parse latency is high. Consider optimizing parsing logic`);
      }
    }
    
    return recommendations;
  }

  public destroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();