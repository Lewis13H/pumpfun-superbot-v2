#!/usr/bin/env node
/**
 * System Resource Monitor
 * 
 * Monitors CPU, memory, and database performance during stress tests
 * Alerts when thresholds are exceeded
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SAMPLE_INTERVAL = 5000; // 5 seconds
const ALERT_THRESHOLDS = {
  cpuPercent: 80,
  memoryPercent: 85,
  dbConnections: 90,
  dbQueryTime: 1000, // ms
  processMemoryMB: 500,
};

interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAvg: number[];
    cores: number;
  };
  memory: {
    totalMB: number;
    freeMB: number;
    usedMB: number;
    percent: number;
  };
  process: {
    memoryMB: number;
    cpuPercent: number;
  };
  database: {
    connections: number;
    activeQueries: number;
    longestQueryMs: number;
    deadlocks: number;
  };
  monitors: {
    name: string;
    pid?: number;
    memoryMB?: number;
    cpuPercent?: number;
  }[];
}

const history: SystemMetrics[] = [];
const alerts: { time: Date; type: string; message: string; value: number }[] = [];

// Get process stats by name
async function getProcessStats(processName: string): Promise<any[]> {
  try {
    const { stdout } = await execAsync(
      `ps aux | grep "${processName}" | grep -v grep | awk '{print $2, $3, $4, $6}'`
    );
    
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [pid, cpu, mem, rss] = line.split(/\s+/);
      return {
        pid: parseInt(pid),
        cpuPercent: parseFloat(cpu),
        memoryPercent: parseFloat(mem),
        memoryMB: parseInt(rss) / 1024,
      };
    });
  } catch {
    return [];
  }
}

// Get database metrics
async function getDatabaseMetrics(): Promise<SystemMetrics['database']> {
  try {
    const [connections, activity, locks] = await Promise.all([
      db.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE state = 'active') as active
        FROM pg_stat_activity
        WHERE datname = current_database()
      `),
      db.query(`
        SELECT pid, query, EXTRACT(EPOCH FROM (now() - query_start)) * 1000 as duration_ms
        FROM pg_stat_activity
        WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY duration_ms DESC
        LIMIT 1
      `),
      db.query(`
        SELECT COUNT(*) as deadlocks
        FROM pg_locks l1
        JOIN pg_locks l2 ON l1.database = l2.database
        WHERE l1.granted AND NOT l2.granted AND l1.pid != l2.pid
      `),
    ]);
    
    return {
      connections: parseInt(connections.rows[0].total),
      activeQueries: parseInt(connections.rows[0].active),
      longestQueryMs: activity.rows[0]?.duration_ms || 0,
      deadlocks: parseInt(locks.rows[0].deadlocks),
    };
  } catch (error) {
    return {
      connections: 0,
      activeQueries: 0,
      longestQueryMs: 0,
      deadlocks: 0,
    };
  }
}

// Collect system metrics
async function collectMetrics(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  const totalMem = os.totalmem() / 1024 / 1024;
  const freeMem = os.freemem() / 1024 / 1024;
  const usedMem = totalMem - freeMem;
  
  // Get monitor processes
  const [bcMonitor, ammMonitor, ammAccount] = await Promise.all([
    getProcessStats('bc-monitor'),
    getProcessStats('amm-monitor'),
    getProcessStats('amm-account-monitor'),
  ]);
  
  const monitors = [
    { name: 'BC Monitor', ...bcMonitor[0] },
    { name: 'AMM Monitor', ...ammMonitor[0] },
    { name: 'AMM Account', ...ammAccount[0] },
  ].filter(m => m.pid);
  
  // Calculate total CPU usage
  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total * 100);
  }, 0) / cpus.length;
  
  // Get process memory
  const processMemory = process.memoryUsage();
  
  return {
    timestamp: new Date(),
    cpu: {
      usage: cpuUsage,
      loadAvg: os.loadavg(),
      cores: cpus.length,
    },
    memory: {
      totalMB: totalMem,
      freeMB: freeMem,
      usedMB: usedMem,
      percent: (usedMem / totalMem) * 100,
    },
    process: {
      memoryMB: processMemory.heapUsed / 1024 / 1024,
      cpuPercent: 0, // Will calculate from history
    },
    database: await getDatabaseMetrics(),
    monitors,
  };
}

// Check alerts
function checkAlerts(metrics: SystemMetrics) {
  // CPU alert
  if (metrics.cpu.usage > ALERT_THRESHOLDS.cpuPercent) {
    alerts.push({
      time: new Date(),
      type: 'CPU',
      message: `CPU usage above ${ALERT_THRESHOLDS.cpuPercent}%`,
      value: metrics.cpu.usage,
    });
  }
  
  // Memory alert
  if (metrics.memory.percent > ALERT_THRESHOLDS.memoryPercent) {
    alerts.push({
      time: new Date(),
      type: 'Memory',
      message: `Memory usage above ${ALERT_THRESHOLDS.memoryPercent}%`,
      value: metrics.memory.percent,
    });
  }
  
  // Database connection alert
  if (metrics.database.connections > ALERT_THRESHOLDS.dbConnections) {
    alerts.push({
      time: new Date(),
      type: 'Database',
      message: `Database connections above ${ALERT_THRESHOLDS.dbConnections}`,
      value: metrics.database.connections,
    });
  }
  
  // Query time alert
  if (metrics.database.longestQueryMs > ALERT_THRESHOLDS.dbQueryTime) {
    alerts.push({
      time: new Date(),
      type: 'Database',
      message: `Slow query detected (${metrics.database.longestQueryMs.toFixed(0)}ms)`,
      value: metrics.database.longestQueryMs,
    });
  }
  
  // Process memory alert
  if (metrics.process.memoryMB > ALERT_THRESHOLDS.processMemoryMB) {
    alerts.push({
      time: new Date(),
      type: 'Process',
      message: `Process memory above ${ALERT_THRESHOLDS.processMemoryMB}MB`,
      value: metrics.process.memoryMB,
    });
  }
  
  // Monitor crashes
  const previousMetrics = history[history.length - 2];
  if (previousMetrics) {
    previousMetrics.monitors.forEach(prevMon => {
      const currentMon = metrics.monitors.find(m => m.name === prevMon.name);
      if (prevMon.pid && !currentMon?.pid) {
        alerts.push({
          time: new Date(),
          type: 'Monitor',
          message: `${prevMon.name} crashed`,
          value: 0,
        });
      }
    });
  }
  
  // Keep only recent alerts
  if (alerts.length > 100) {
    alerts.splice(0, alerts.length - 100);
  }
}

// Display dashboard
function displayDashboard() {
  console.clear();
  
  const current = history[history.length - 1];
  if (!current) return;
  
  console.log(chalk.cyan.bold('📊 SYSTEM RESOURCE MONITOR'));
  console.log(chalk.gray('═'.repeat(80)));
  
  // CPU section
  console.log(chalk.white.bold('\n💻 CPU'));
  const cpuColor = current.cpu.usage > ALERT_THRESHOLDS.cpuPercent ? chalk.red : 
                   current.cpu.usage > 60 ? chalk.yellow : chalk.green;
  console.log(
    chalk.white('Usage:'), cpuColor(`${current.cpu.usage.toFixed(1)}%`),
    chalk.gray(`(${current.cpu.cores} cores)`),
    chalk.gray('|'),
    chalk.white('Load:'), chalk.cyan(current.cpu.loadAvg.map(l => l.toFixed(2)).join(', '))
  );
  
  // Memory section
  console.log(chalk.white.bold('\n🧠 MEMORY'));
  const memColor = current.memory.percent > ALERT_THRESHOLDS.memoryPercent ? chalk.red :
                   current.memory.percent > 70 ? chalk.yellow : chalk.green;
  console.log(
    chalk.white('System:'), memColor(`${current.memory.percent.toFixed(1)}%`),
    chalk.gray(`(${current.memory.usedMB.toFixed(0)}/${current.memory.totalMB.toFixed(0)} MB)`),
    chalk.gray('|'),
    chalk.white('Process:'), chalk.cyan(`${current.process.memoryMB.toFixed(0)} MB`)
  );
  
  // Database section
  console.log(chalk.white.bold('\n🗄️  DATABASE'));
  const dbColor = current.database.connections > ALERT_THRESHOLDS.dbConnections ? chalk.red :
                  current.database.connections > 70 ? chalk.yellow : chalk.green;
  console.log(
    chalk.white('Connections:'), dbColor(current.database.connections),
    chalk.gray(`(${current.database.activeQueries} active)`),
    chalk.gray('|'),
    chalk.white('Longest Query:'), 
    current.database.longestQueryMs > ALERT_THRESHOLDS.dbQueryTime ? 
      chalk.red(`${current.database.longestQueryMs.toFixed(0)}ms`) :
      chalk.green(`${current.database.longestQueryMs.toFixed(0)}ms`)
  );
  
  if (current.database.deadlocks > 0) {
    console.log(chalk.red(`⚠️  Deadlocks detected: ${current.database.deadlocks}`));
  }
  
  // Monitors section
  console.log(chalk.white.bold('\n🔍 MONITORS'));
  current.monitors.forEach(monitor => {
    const status = monitor.pid ? chalk.green('● Running') : chalk.red('● Stopped');
    console.log(
      chalk.white(monitor.name.padEnd(15)),
      status,
      monitor.pid ? chalk.gray(`PID: ${monitor.pid}`) : '',
      monitor.memoryMB ? chalk.gray(`Mem: ${monitor.memoryMB.toFixed(0)}MB`) : '',
      monitor.cpuPercent ? chalk.gray(`CPU: ${monitor.cpuPercent.toFixed(1)}%`) : ''
    );
  });
  
  // Trends (last 5 minutes)
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentHistory = history.filter(h => h.timestamp.getTime() > fiveMinAgo);
  
  if (recentHistory.length > 10) {
    console.log(chalk.white.bold('\n📈 5-MINUTE TRENDS'));
    
    const avgCpu = recentHistory.reduce((sum, h) => sum + h.cpu.usage, 0) / recentHistory.length;
    const maxCpu = Math.max(...recentHistory.map(h => h.cpu.usage));
    const avgMem = recentHistory.reduce((sum, h) => sum + h.memory.percent, 0) / recentHistory.length;
    const maxMem = Math.max(...recentHistory.map(h => h.memory.percent));
    
    console.log(
      chalk.white('CPU:'),
      chalk.gray('Avg'), chalk.cyan(`${avgCpu.toFixed(1)}%`),
      chalk.gray('Max'), chalk.yellow(`${maxCpu.toFixed(1)}%`)
    );
    console.log(
      chalk.white('Memory:'),
      chalk.gray('Avg'), chalk.cyan(`${avgMem.toFixed(1)}%`),
      chalk.gray('Max'), chalk.yellow(`${maxMem.toFixed(1)}%`)
    );
  }
  
  // Recent alerts
  if (alerts.length > 0) {
    console.log(chalk.red.bold('\n⚠️  ALERTS'));
    const recentAlerts = alerts.slice(-5);
    recentAlerts.forEach(alert => {
      const age = Date.now() - alert.time.getTime();
      const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`;
      console.log(
        chalk.red('•'),
        chalk.white(`[${alert.type}]`),
        chalk.gray(alert.message),
        chalk.yellow(`(${ageStr})`)
      );
    });
  }
  
  // Resource usage graph (simple ASCII)
  console.log(chalk.white.bold('\n📊 RESOURCE USAGE (Last 30 samples)'));
  const graphHistory = history.slice(-30);
  if (graphHistory.length > 0) {
    const maxHeight = 10;
    
    // CPU graph
    console.log(chalk.cyan('CPU:'));
    const cpuGraph = graphHistory.map(h => {
      const height = Math.round((h.cpu.usage / 100) * maxHeight);
      return '█'.repeat(height) + '░'.repeat(maxHeight - height);
    });
    
    for (let i = maxHeight - 1; i >= 0; i--) {
      const row = cpuGraph.map(col => col[i] || ' ').join('');
      const percent = ((i + 1) / maxHeight * 100).toFixed(0);
      console.log(chalk.gray(`${percent.padStart(3)}% |`) + row);
    }
    
    // Memory graph
    console.log(chalk.cyan('\nMemory:'));
    const memGraph = graphHistory.map(h => {
      const height = Math.round((h.memory.percent / 100) * maxHeight);
      return '█'.repeat(height) + '░'.repeat(maxHeight - height);
    });
    
    for (let i = maxHeight - 1; i >= 0; i--) {
      const row = memGraph.map(col => col[i] || ' ').join('');
      const percent = ((i + 1) / maxHeight * 100).toFixed(0);
      console.log(chalk.gray(`${percent.padStart(3)}% |`) + row);
    }
  }
  
  console.log(chalk.gray('\n═'.repeat(80)));
  console.log(chalk.gray('Press Ctrl+C to stop monitoring'));
}

// Main monitoring loop
async function runResourceMonitor() {
  console.log(chalk.cyan.bold('🚀 STARTING SYSTEM RESOURCE MONITOR'));
  console.log(chalk.gray('Monitoring system resources...\n'));
  
  const monitor = async () => {
    const metrics = await collectMetrics();
    history.push(metrics);
    
    // Keep only last hour of history
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentHistory = history.filter(h => h.timestamp.getTime() > oneHourAgo);
    history.length = 0;
    history.push(...recentHistory);
    
    checkAlerts(metrics);
    displayDashboard();
  };
  
  // Initial collection
  await monitor();
  
  // Set up interval
  const interval = setInterval(monitor, SAMPLE_INTERVAL);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nStopping resource monitor...'));
    clearInterval(interval);
    
    // Final summary
    console.log(chalk.cyan.bold('\n📊 MONITORING SUMMARY'));
    console.log(chalk.gray('═'.repeat(80)));
    
    const avgCpu = history.reduce((sum, h) => sum + h.cpu.usage, 0) / history.length;
    const maxCpu = Math.max(...history.map(h => h.cpu.usage));
    const avgMem = history.reduce((sum, h) => sum + h.memory.percent, 0) / history.length;
    const maxMem = Math.max(...history.map(h => h.memory.percent));
    
    console.log(chalk.white('Average CPU:'), chalk.cyan(`${avgCpu.toFixed(1)}%`));
    console.log(chalk.white('Peak CPU:'), chalk.yellow(`${maxCpu.toFixed(1)}%`));
    console.log(chalk.white('Average Memory:'), chalk.cyan(`${avgMem.toFixed(1)}%`));
    console.log(chalk.white('Peak Memory:'), chalk.yellow(`${maxMem.toFixed(1)}%`));
    console.log(chalk.white('Total Alerts:'), chalk.red(alerts.length));
    
    await db.close();
    process.exit(0);
  });
}

// Run monitor
runResourceMonitor().catch(async (error) => {
  console.error(chalk.red('Fatal error:'), error);
  await db.close();
  process.exit(1);
});