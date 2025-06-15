import WebSocket from 'ws';
import { config } from './config';
import { db } from './database';

export class DashboardServer {
  private wss: WebSocket.Server;
  private clients = new Set<WebSocket>();

  constructor() {
    this.wss = new WebSocket.Server({ 
      port: config.websocket.port 
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log('Dashboard client connected');

      // Send initial data
      this.sendActiveTokens(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  // Add missing start method
  async start() {
    console.log(`🌐 Dashboard server listening on port ${config.websocket.port}`);
  }

  // Add missing stop method
  async stop() {
    this.wss.close();
  }

  async sendActiveTokens(ws?: WebSocket) {
    const tokens = await db.getActiveTokens();
    const message = JSON.stringify({
      type: 'tokens',
      data: tokens,
      timestamp: new Date()
    });

    if (ws) {
      ws.send(message);
    } else {
      this.broadcastString(message);
    }
  }

  broadcastNewToken(token: any) {
    this.broadcastString(JSON.stringify({
      type: 'new_token',
      data: token,
      timestamp: new Date()
    }));
  }

  broadcastPriceUpdate(count: number) {
    this.broadcastString(JSON.stringify({
      type: 'price_update',
      count,
      timestamp: new Date()
    }));
  }

  // NEW: Public method that accepts objects and converts to JSON
  broadcast(data: any) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this.broadcastString(message);
  }

  // RENAMED: The original broadcast method that sends strings
  private broadcastString(message: string) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}