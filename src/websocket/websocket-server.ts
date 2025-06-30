/**
 * WebSocket Server
 * Event-driven WebSocket implementation with proper error handling
 */

import { Server as HTTPServer } from 'http';
import { WebSocket, Server as WSServer } from 'ws';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { ConfigService } from '../core/config';

export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: number;
}

export interface WebSocketClient {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  joinedAt: Date;
}

export class WebSocketServer {
  private wss: WSServer;
  private clients = new Map<string, WebSocketClient>();
  private logger: Logger;
  private messageQueue: WebSocketMessage[] = [];
  private processingQueue = false;

  constructor(
    httpServer: HTTPServer,
    private eventBus: EventBus,
    config: ConfigService
  ) {
    this.logger = new Logger({ context: 'WebSocketServer' });
    
    // Initialize WebSocket server
    this.wss = new WSServer({
      server: httpServer,
      path: config.get('api').webSocketPath,
      perMessageDeflate: false, // Disable compression to avoid frame header issues
      clientTracking: false // We'll track clients ourselves
    });
    
    this.setupWebSocketServer();
    this.subscribeToEvents();
  }

  /**
   * Setup WebSocket server handlers
   */
  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      const client: WebSocketClient = {
        id: clientId,
        ws,
        subscriptions: new Set(['all']), // Subscribe to all events by default
        joinedAt: new Date()
      };
      
      this.clients.set(clientId, client);
      this.logger.info(`Client connected: ${clientId}`);
      
      // Send welcome message
      this.sendToClient(client, {
        type: 'connected',
        payload: {
          clientId,
          serverTime: new Date(),
          availableEvents: Object.values(EVENTS)
        },
        timestamp: Date.now()
      });
      
      // Emit connection event
      this.eventBus.emit(EVENTS.WS_CLIENT_CONNECTED, { clientId });
      
      // Setup client handlers
      this.setupClientHandlers(client);
    });
    
    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error', error);
    });
  }

  /**
   * Setup handlers for a client
   */
  private setupClientHandlers(client: WebSocketClient): void {
    const { ws, id } = client;
    
    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(client, message);
      } catch (error) {
        this.logger.error('Invalid message from client', error as Error);
        this.sendError(client, 'Invalid message format');
      }
    });
    
    // Handle client disconnect
    ws.on('close', (code, reason) => {
      this.logger.info(`Client disconnected: ${id}`, { code, reason: reason?.toString() });
      this.clients.delete(id);
      this.eventBus.emit(EVENTS.WS_CLIENT_DISCONNECTED, { clientId: id });
    });
    
    // Handle errors
    ws.on('error', (error) => {
      this.logger.error(`Client error: ${id}`, error);
    });
    
    // Setup ping/pong for connection health
    ws.on('pong', () => {
      // Client is alive
    });
  }

  /**
   * Handle message from client
   */
  private handleClientMessage(client: WebSocketClient, message: any): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(client, message.events || []);
        break;
        
      case 'unsubscribe':
        this.handleUnsubscribe(client, message.events || []);
        break;
        
      case 'ping':
        this.sendToClient(client, {
          type: 'pong',
          payload: { timestamp: Date.now() },
          timestamp: Date.now()
        });
        break;
        
      default:
        this.sendError(client, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(client: WebSocketClient, events: string[]): void {
    for (const event of events) {
      client.subscriptions.add(event);
    }
    
    this.sendToClient(client, {
      type: 'subscribed',
      payload: { events, subscriptions: Array.from(client.subscriptions) },
      timestamp: Date.now()
    });
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(client: WebSocketClient, events: string[]): void {
    for (const event of events) {
      client.subscriptions.delete(event);
    }
    
    this.sendToClient(client, {
      type: 'unsubscribed',
      payload: { events, subscriptions: Array.from(client.subscriptions) },
      timestamp: Date.now()
    });
  }

  /**
   * Subscribe to event bus events
   */
  private subscribeToEvents(): void {
    // Trade events
    this.eventBus.on(EVENTS.BC_TRADE, (data) => {
      this.broadcast({
        type: EVENTS.BC_TRADE,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    this.eventBus.on(EVENTS.AMM_TRADE, (data) => {
      this.broadcast({
        type: EVENTS.AMM_TRADE,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    // Token events
    this.eventBus.on(EVENTS.TOKEN_DISCOVERED, (data) => {
      this.broadcast({
        type: EVENTS.TOKEN_DISCOVERED,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      this.broadcast({
        type: EVENTS.TOKEN_GRADUATED,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    this.eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
      this.broadcast({
        type: EVENTS.TOKEN_THRESHOLD_CROSSED,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    // Monitor events
    this.eventBus.on(EVENTS.MONITOR_STATS_UPDATED, (data) => {
      this.broadcast({
        type: EVENTS.MONITOR_STATS_UPDATED,
        payload: data,
        timestamp: Date.now()
      });
    });
    
    // Price events
    this.eventBus.on(EVENTS.SOL_PRICE_UPDATED, (price) => {
      this.broadcast({
        type: EVENTS.SOL_PRICE_UPDATED,
        payload: { price },
        timestamp: Date.now()
      });
    });
  }

  /**
   * Broadcast message to all subscribed clients
   */
  broadcast(message: WebSocketMessage): void {
    // Queue message
    this.messageQueue.push(message);
    
    // Process queue if not already processing
    if (!this.processingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * Process message queue
   */
  private async processMessageQueue(): Promise<void> {
    this.processingQueue = true;
    
    while (this.messageQueue.length > 0) {
      const messages = this.messageQueue.splice(0, 100); // Process in batches
      
      for (const message of messages) {
        // Serialize with BigInt support
        const data = JSON.stringify(message, (_, value) => {
          if (typeof value === 'bigint') {
            return value.toString();
          }
          return value;
        });
        
        for (const client of this.clients.values()) {
          // Check if client is subscribed to this event
          if (client.subscriptions.has('all') || client.subscriptions.has(message.type)) {
            this.sendRaw(client, data);
          }
        }
      }
      
      // Small delay to prevent overwhelming clients
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.processingQueue = false;
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    const data = JSON.stringify(message, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
    this.sendRaw(client, data);
  }

  /**
   * Send raw data to client
   */
  private sendRaw(client: WebSocketClient, data: string): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(data);
      } catch (error) {
        this.logger.error(`Failed to send to client ${client.id}`, error as Error);
      }
    }
  }

  /**
   * Send error to client
   */
  private sendError(client: WebSocketClient, error: string): void {
    this.sendToClient(client, {
      type: 'error',
      payload: { error },
      timestamp: Date.now()
    });
  }

  /**
   * Generate client ID
   */
  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Start ping interval
   */
  startPingInterval(): void {
    setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      queuedMessages: this.messageQueue.length,
      clients: Array.from(this.clients.values()).map(c => ({
        id: c.id,
        subscriptions: Array.from(c.subscriptions),
        connectedFor: Date.now() - c.joinedAt.getTime()
      }))
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down WebSocket server...');
    
    // Notify all clients
    const shutdownMessage: WebSocketMessage = {
      type: 'server_shutdown',
      payload: { message: 'Server is shutting down' },
      timestamp: Date.now()
    };
    
    for (const client of this.clients.values()) {
      this.sendToClient(client, shutdownMessage);
      client.ws.close(1001, 'Server shutdown');
    }
    
    // Close server
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}