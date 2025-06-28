import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { EventEmitter } from 'events';

export interface BroadcastMessage {
  type: 'trade' | 'graduation' | 'new_token' | 'stats' | 'error';
  data: any;
  timestamp: Date;
}

export class BCWebSocketServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private pingInterval: NodeJS.Timer | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize WebSocket server on existing HTTP server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket client connected');
      this.clients.add(ws);

      // Send initial connection message
      this.sendToClient(ws, {
        type: 'connected',
        data: { message: 'Connected to BC Monitor WebSocket' },
        timestamp: new Date()
      });

      // Handle client messages
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      // Handle disconnection
      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Pong response for keepalive
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });
    });

    // Start ping interval for keepalive
    this.startPingInterval();
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: BroadcastMessage): void {
    const payload = JSON.stringify(message);
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocket, message: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming client messages
   */
  private handleClientMessage(client: WebSocket, data: any): void {
    switch (data.type) {
      case 'subscribe':
        // Client wants to subscribe to specific events
        (client as any).subscriptions = data.events || ['all'];
        this.sendToClient(client, {
          type: 'subscribed',
          data: { events: (client as any).subscriptions },
          timestamp: new Date()
        });
        break;

      case 'ping':
        // Respond to client ping
        this.sendToClient(client, {
          type: 'pong',
          timestamp: new Date()
        });
        break;

      default:
        console.log('Unknown client message type:', data.type);
    }
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.clients.forEach((ws) => {
        if ((ws as any).isAlive === false) {
          ws.terminate();
          this.clients.delete(ws);
          return;
        }

        (ws as any).isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  /**
   * Broadcast a new trade event
   */
  broadcastTrade(trade: any): void {
    this.broadcast({
      type: 'trade',
      data: trade,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast a graduation event
   */
  broadcastGraduation(graduation: any): void {
    this.broadcast({
      type: 'graduation',
      data: graduation,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast a new token discovery
   */
  broadcastNewToken(token: any): void {
    this.broadcast({
      type: 'new_token',
      data: token,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast statistics update
   */
  broadcastStats(stats: any): void {
    this.broadcast({
      type: 'stats',
      data: stats,
      timestamp: new Date()
    });
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((client) => {
      client.close();
    });

    if (this.wss) {
      this.wss.close();
    }
  }
}

// Singleton instance
export const bcWebSocketServer = new BCWebSocketServer();