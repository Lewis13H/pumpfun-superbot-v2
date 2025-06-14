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
      this.broadcast(message);
    }
  }

  broadcastNewToken(token: any) {
    this.broadcast(JSON.stringify({
      type: 'new_token',
      data: token,
      timestamp: new Date()
    }));
  }

  broadcastPriceUpdate(count: number) {
    this.broadcast(JSON.stringify({
      type: 'price_update',
      count,
      timestamp: new Date()
    }));
  }

  private broadcast(message: string) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}