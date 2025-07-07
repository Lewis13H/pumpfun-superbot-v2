/**
 * WebSocket Handler for Holder Analysis Real-time Updates
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger';
import { HolderAnalysisJobMonitor } from '../../services/holder-analysis/holder-analysis-job-monitor';

const logger = createLogger('HolderAnalysisWS');

export class HolderAnalysisWebSocketHandler extends EventEmitter {
  private clients: Set<WebSocket> = new Set();
  private subscriptions: Map<WebSocket, Set<string>> = new Map();

  constructor(private jobMonitor: HolderAnalysisJobMonitor) {
    super();
    this.setupEventListeners();
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.subscriptions.set(ws, new Set());
    
    logger.info('New WebSocket client connected');

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        logger.error('Invalid WebSocket message:', error);
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
      logger.info('WebSocket client disconnected');
    });

    // Send initial connection confirmation
    this.sendToClient(ws, {
      type: 'connected',
      timestamp: new Date()
    });
  }

  /**
   * Handle messages from client
   */
  private handleClientMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(ws, message);
        break;
      
      case 'unsubscribe':
        this.handleUnsubscribe(ws, message);
        break;
      
      case 'ping':
        this.sendToClient(ws, { type: 'pong' });
        break;
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(ws: WebSocket, message: any): void {
    const { channel, mintAddress } = message;
    const subs = this.subscriptions.get(ws);
    
    if (!subs) return;

    if (channel === 'holder_analysis') {
      subs.add('holder_analysis');
      logger.info('Client subscribed to holder analysis updates');
    } else if (channel === 'token_analysis' && mintAddress) {
      subs.add(`token:${mintAddress}`);
      logger.info(`Client subscribed to token ${mintAddress}`);
    }

    this.sendToClient(ws, {
      type: 'subscribed',
      channel,
      mintAddress
    });
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(ws: WebSocket, message: any): void {
    const { channel, mintAddress } = message;
    const subs = this.subscriptions.get(ws);
    
    if (!subs) return;

    if (channel === 'holder_analysis') {
      subs.delete('holder_analysis');
    } else if (channel === 'token_analysis' && mintAddress) {
      subs.delete(`token:${mintAddress}`);
    }

    this.sendToClient(ws, {
      type: 'unsubscribed',
      channel,
      mintAddress
    });
  }

  /**
   * Setup event listeners from job monitor
   */
  private setupEventListeners(): void {
    // Job events
    this.jobMonitor.on('job_progress', (data) => {
      this.broadcast({
        type: 'job_update',
        jobId: data.jobId,
        progress: data.progress,
        message: data.message,
        timestamp: new Date()
      }, 'holder_analysis');
    });

    // Analysis complete events
    this.jobMonitor.on('analysis_complete', (data) => {
      this.broadcast({
        type: 'analysis_complete',
        mintAddress: data.mintAddress,
        analysis: data.analysis,
        timestamp: new Date()
      }, `token:${data.mintAddress}`);
    });

    // Metrics updates
    this.jobMonitor.on('metrics_collected', (metrics) => {
      this.broadcast({
        type: 'metrics_update',
        metrics,
        timestamp: new Date()
      }, 'holder_analysis');
    });

    // Alerts
    this.jobMonitor.on('alert', (alert) => {
      this.broadcast({
        type: 'alert',
        alert,
        timestamp: new Date()
      }, 'holder_analysis');
    });

    // Significant changes in token analysis
    this.jobMonitor.on('significant_changes', (data) => {
      this.broadcast({
        type: 'significant_changes',
        mintAddress: data.mintAddress,
        changes: data.changes,
        analysis: data.analysis,
        timestamp: new Date()
      }, `token:${data.mintAddress}`);
    });
  }

  /**
   * Broadcast message to subscribed clients
   */
  private broadcast(message: any, channel: string): void {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        const subs = this.subscriptions.get(ws);
        if (subs && (subs.has(channel) || subs.has('holder_analysis'))) {
          ws.send(messageStr);
        }
      }
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all clients
   */
  broadcastToAll(message: any): void {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}