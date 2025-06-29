import WebSocket = require('ws');
import { Server } from 'http';
import { EventEmitter } from 'events';

const WSServer = WebSocket.Server;

export type EventType = 
  | 'trade' 
  | 'graduation' 
  | 'new_token' 
  | 'stats' 
  | 'error'
  | 'amm_trade'
  | 'pool_state_change'
  | 'amm_stats'
  | 'price_update';

export type EventSource = 'bc' | 'amm' | 'amm_account' | 'unified';

export interface BroadcastMessage {
  type: EventType;
  source: EventSource;
  data: any;
  timestamp: Date;
}

export interface TradeEvent {
  signature: string;
  mintAddress: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: number;
  tokenAmount: number;
  priceUsd: number;
  marketCapUsd: number;
  program: 'bonding_curve' | 'amm_pool';
}

export interface PoolStateEvent {
  mintAddress: string;
  poolAddress: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves?: bigint;
  realTokenReserves?: bigint;
  pricePerToken: number;
  slot: bigint;
}

export interface StatsEvent {
  source: EventSource;
  transactions: number;
  trades: number;
  errors: number;
  uniqueTokens: number;
  uptime: number;
  [key: string]: any;
}

export class UnifiedWebSocketServer extends EventEmitter {
  private wss: any = null;
  private clients: Map<any, Set<EventType>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private stats: Map<EventSource, StatsEvent> = new Map();

  constructor() {
    super();
  }

  /**
   * Initialize WebSocket server on existing HTTP server
   */
  initialize(server: Server): void {
    console.log('Initializing Unified WebSocket Server on path /ws-unified');
    
    this.wss = new WSServer({ 
      server, 
      path: '/ws-unified',
      perMessageDeflate: false, // Disable compression to fix RSV1 errors
      clientTracking: true,
      verifyClient: (info) => {
        console.log('Verifying client connection:');
        console.log('  Origin:', info.origin);
        console.log('  URL:', info.req.url);
        console.log('  Secure:', info.secure);
        // Accept all connections for now
        return true;
      }
    });

    // Add error handler for the server itself
    this.wss.on('error', (error) => {
      console.error('WebSocket Server error:', error);
    });

    // Log that we're setting up the handler
    console.log('Setting up connection handler for unified WebSocket...');
    
    this.wss.on('connection', (ws: any, req: any) => {
      console.log('🔥 UNIFIED WebSocket client connected!');
      console.log('From:', req?.headers?.origin || 'unknown origin');
      console.log('URL:', req?.url);
      console.log('ReadyState:', ws.readyState);
      this.clients.set(ws, new Set(['all'] as any));

      // Send initial connection message after a short delay
      setTimeout(() => {
        if (ws.readyState === 1) { // WebSocket.OPEN = 1
          this.sendToClient(ws, {
            type: 'connected',
            source: 'unified',
            data: { 
              message: 'Connected to Unified Monitor WebSocket',
              availableEvents: [
                'trade', 'graduation', 'new_token', 'stats', 'error',
                'amm_trade', 'pool_state_change', 'amm_stats', 'price_update'
              ]
            },
            timestamp: new Date()
          });
        }
      }, 100);

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
   * Handle incoming client messages
   */
  private handleClientMessage(client: WebSocket, data: any): void {
    switch (data.type) {
      case 'subscribe':
        // Client wants to subscribe to specific events
        const events = new Set<EventType>(data.events || ['all'] as any);
        this.clients.set(client, events);
        this.sendToClient(client, {
          type: 'subscribed',
          source: 'unified',
          data: { events: Array.from(events) },
          timestamp: new Date()
        });
        break;

      case 'unsubscribe':
        // Remove specific event subscriptions
        const currentEvents = this.clients.get(client) || new Set();
        (data.events || []).forEach((event: EventType) => {
          currentEvents.delete(event);
        });
        this.clients.set(client, currentEvents);
        this.sendToClient(client, {
          type: 'unsubscribed',
          source: 'unified',
          data: { events: data.events },
          timestamp: new Date()
        });
        break;

      case 'ping':
        // Respond to client ping
        this.sendToClient(client, {
          type: 'pong',
          source: 'unified',
          timestamp: new Date()
        });
        break;

      case 'get_stats':
        // Send current stats
        this.sendToClient(client, {
          type: 'stats',
          source: 'unified',
          data: {
            sources: Object.fromEntries(this.stats),
            connectedClients: this.clients.size
          },
          timestamp: new Date()
        });
        break;

      default:
        console.log('Unknown client message type:', data.type);
    }
  }

  /**
   * Broadcast message to subscribed clients
   */
  broadcast(message: BroadcastMessage): void {
    const payload = JSON.stringify(message);
    
    this.clients.forEach((subscriptions, client) => {
      // Check if client is subscribed to this event type or 'all'
      if (subscriptions.has(message.type) || subscriptions.has('all' as any)) {
        if (client.readyState === 1) { // WebSocket.OPEN = 1
          client.send(payload);
        }
      }
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: any, message: any): void {
    if (client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.clients.forEach((subscriptions, ws) => {
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
   * Broadcast a trade event (BC or AMM)
   */
  broadcastTrade(trade: TradeEvent, source: EventSource = 'bc'): void {
    const eventType = source === 'amm' ? 'amm_trade' : 'trade';
    this.broadcast({
      type: eventType,
      source,
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
      source: 'bc',
      data: graduation,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast a new token discovery
   */
  broadcastNewToken(token: any, source: EventSource = 'bc'): void {
    this.broadcast({
      type: 'new_token',
      source,
      data: token,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast pool state change
   */
  broadcastPoolStateChange(poolState: PoolStateEvent): void {
    this.broadcast({
      type: 'pool_state_change',
      source: 'amm_account',
      data: poolState,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast price update
   */
  broadcastPriceUpdate(priceData: any): void {
    this.broadcast({
      type: 'price_update',
      source: 'unified',
      data: priceData,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast statistics update
   */
  broadcastStats(stats: StatsEvent, source: EventSource): void {
    this.stats.set(source, stats);
    this.broadcast({
      type: source === 'amm' ? 'amm_stats' : 'stats',
      source,
      data: stats,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast error event
   */
  broadcastError(error: any, source: EventSource): void {
    this.broadcast({
      type: 'error',
      source,
      data: error,
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
   * Get client subscriptions summary
   */
  getSubscriptionSummary(): Map<EventType, number> {
    const summary = new Map<EventType, number>();
    
    this.clients.forEach((subscriptions) => {
      subscriptions.forEach((event) => {
        summary.set(event, (summary.get(event) || 0) + 1);
      });
    });
    
    return summary;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((_, client) => {
      client.close();
    });

    if (this.wss) {
      this.wss.close();
    }
  }
}

// Singleton instance
export const unifiedWebSocketServer = new UnifiedWebSocketServer();