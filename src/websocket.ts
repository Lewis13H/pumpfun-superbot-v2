import WebSocket from 'ws';  
import { config } from './config';  
import { pool } from './database';


export class DashboardServer {  
  private wss: WebSocket.Server;  
  private clients = new Map<WebSocket, Set<string>>(); // ws -> subscribed tokens  
  private tokenSubscribers = new Map<string, Set<WebSocket>>(); // token -> subscribers

  constructor() {  
    this.wss = new WebSocket.Server({   
      port: config.websocket.port   
    });

    this.wss.on('connection', (ws) => {  
      this.clients.set(ws, new Set());  
      console.log('✅ Dashboard client connected');

      // Send initial data  
      this.sendActiveTokens(ws);

      // Handle incoming messages  
      ws.on('message', (message) => {  
        try {  
          const msg = JSON.parse(message.toString());  
          this.handleClientMessage(ws, msg);  
        } catch (error) {  
          console.error('Invalid message:', error);  
        }  
      });

      ws.on('close', () => {  
        // Clean up subscriptions  
        const subscriptions = this.clients.get(ws);  
        if (subscriptions) {  
          subscriptions.forEach(token => {  
            const subscribers = this.tokenSubscribers.get(token);  
            if (subscribers) {  
              subscribers.delete(ws);  
              if (subscribers.size === 0) {  
                this.tokenSubscribers.delete(token);  
              }  
            }  
          });  
        }  
        this.clients.delete(ws);  
        console.log('Dashboard client disconnected');  
      });

      ws.on('error', (error) => {  
        console.error('WebSocket error:', error);  
      });  
    });  
  }

  // Handle client messages  
  private handleClientMessage(ws: WebSocket, msg: any) {  
    switch (msg.type) {  
      case 'subscribe_token':  
        this.subscribeToToken(ws, msg.address);  
        break;  
      case 'unsubscribe_token':  
        this.unsubscribeFromToken(ws, msg.address);  
        break;  
      case 'get_token':  
        this.sendTokenDetails(ws, msg.address);  
        break;  
    }  
  }

  // Subscribe to specific token updates  
  private subscribeToToken(ws: WebSocket, address: string) {  
    const subscriptions = this.clients.get(ws);  
    if (subscriptions) {  
      subscriptions.add(address);  
    }

    if (!this.tokenSubscribers.has(address)) {  
      this.tokenSubscribers.set(address, new Set());  
    }  
    this.tokenSubscribers.get(address)?.add(ws);

    // Send initial token data  
    this.sendTokenDetails(ws, address);  
  }

  // Unsubscribe from token updates  
  private unsubscribeFromToken(ws: WebSocket, address: string) {  
    const subscriptions = this.clients.get(ws);  
    if (subscriptions) {  
      subscriptions.delete(address);  
    }

    const subscribers = this.tokenSubscribers.get(address);  
    if (subscribers) {  
      subscribers.delete(ws);  
      if (subscribers.size === 0) {  
        this.tokenSubscribers.delete(address);  
      }  
    }  
  }

  // Send token details with stats  
  private async sendTokenDetails(ws: WebSocket, address: string) {  
    try {  
      const token = await this.getTokenWithStats(address);  
      if (token && ws.readyState === WebSocket.OPEN) {  
        ws.send(JSON.stringify({  
          type: 'token_update',  
          data: token,  
          timestamp: new Date()  
        }));  
      }  
    } catch (error) {  
      console.error('Error sending token details:', error);  
    }  
  }
  
  // In your src/websocket.ts file, replace the entire getTokenWithStats method with this:

private async getTokenWithStats(address: string): Promise<any> {
  try {
    // Get basic token info
    const tokenResult = await pool.query(`
      SELECT 
        t.*,
        p.price_usd as current_price,
        p.price_sol as current_price_sol,
        p.market_cap_usd as current_mcap,
        p.liquidity_usd as current_liquidity,
        p.liquidity_sol as current_liquidity_sol,
        p.bonding_complete
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT * FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE t.address = $1
    `, [address]);

    if (tokenResult.rows.length === 0) {
      return null;
    }

    const token = tokenResult.rows[0];

    // Get 24h stats with fixed volume calculation
    const statsResult = await pool.query(`
      WITH current_data AS (
        SELECT price_usd, time
        FROM price_updates
        WHERE token = $1
        ORDER BY time DESC
        LIMIT 1
      ),
      data_24h_ago AS (
        SELECT price_usd
        FROM price_updates
        WHERE token = $1 
        AND time >= NOW() - INTERVAL '24 hours' - INTERVAL '1 hour'
        AND time <= NOW() - INTERVAL '24 hours' + INTERVAL '1 hour'
        ORDER BY time DESC
        LIMIT 1
      ),
      data_1h_ago AS (
        SELECT price_usd
        FROM price_updates
        WHERE token = $1 
        AND time >= NOW() - INTERVAL '1 hour' - INTERVAL '5 minutes'
        AND time <= NOW() - INTERVAL '1 hour' + INTERVAL '5 minutes'
        ORDER BY time DESC
        LIMIT 1
      ),
      liquidity_changes AS (
        SELECT 
          time,
          liquidity_usd,
          liquidity_usd - LAG(liquidity_usd) OVER (ORDER BY time) as liquidity_change
        FROM price_updates
        WHERE token = $1 
        AND time >= NOW() - INTERVAL '24 hours'
      )
      SELECT 
        c.price_usd as current_price,
        COALESCE(d24.price_usd, 0) as price_24h_ago,
        COALESCE(d1.price_usd, 0) as price_1h_ago,
        (SELECT COUNT(*) FROM liquidity_changes WHERE liquidity_change IS NOT NULL) as trade_count,
        (SELECT COALESCE(SUM(ABS(liquidity_change)), 0) FROM liquidity_changes WHERE liquidity_change IS NOT NULL) as volume_estimate,
        CASE 
          WHEN d24.price_usd > 0 THEN ((c.price_usd - d24.price_usd) / d24.price_usd * 100)
          ELSE 0
        END as price_change_24h,
        CASE 
          WHEN d1.price_usd > 0 THEN ((c.price_usd - d1.price_usd) / d1.price_usd * 100)
          ELSE 0
        END as price_change_1h
      FROM current_data c
      LEFT JOIN data_24h_ago d24 ON true
      LEFT JOIN data_1h_ago d1 ON true
    `, [address]);

    const stats = statsResult.rows[0] || {};

    // Calculate bonding curve progress
    let bondingProgress = 0;
    if (!token.graduated && token.current_liquidity_sol) {
      bondingProgress = (token.current_liquidity_sol / 85000) * 100;
    }

    return {
      ...token,
      ...stats,
      bonding_progress: bondingProgress,
      volume_24h: stats.volume_estimate || 0,
      trade_count_24h: stats.trade_count || 0
    };
  } catch (error) {
    console.error('Error getting token stats:', error);
    return null;
  }
}


  // Enhanced sendActiveTokens with 24h changes  
  async sendActiveTokens(ws?: WebSocket) {  
    try {  
      // Get tokens with 24h price changes  
      const result = await pool.query(`  
        WITH token_stats AS (  
          SELECT   
            t.*,  
            p.price_usd as current_price,  
            p.price_sol as current_price_sol,  
            p.market_cap_usd as current_mcap,  
            p.liquidity_usd as current_liquidity,  
            p.bonding_complete,  
            p24.price_usd as price_24h_ago,  
            CASE   
              WHEN p24.price_usd > 0 THEN ((p.price_usd - p24.price_usd) / p24.price_usd * 100)  
              ELSE 0  
            END as price_change_24h  
          FROM tokens t  
          LEFT JOIN LATERAL (  
            SELECT * FROM price_updates   
            WHERE token = t.address   
            ORDER BY time DESC   
            LIMIT 1  
          ) p ON true  
          LEFT JOIN LATERAL (  
            SELECT price_usd FROM price_updates   
            WHERE token = t.address   
            AND time >= NOW() - INTERVAL '24 hours' - INTERVAL '1 hour'  
            AND time <= NOW() - INTERVAL '24 hours' + INTERVAL '1 hour'  
            ORDER BY time DESC   
            LIMIT 1  
          ) p24 ON true  
          WHERE NOT t.archived  
        )  
        SELECT * FROM token_stats  
        ORDER BY current_mcap DESC NULLS LAST  
      `);

      const tokens = result.rows;  
      const message = JSON.stringify({  
        type: 'tokens',  
        data: tokens,  
        timestamp: new Date()  
      });

      if (ws) {  
        if (ws.readyState === WebSocket.OPEN) {  
          ws.send(message);  
        }  
      } else {  
        this.broadcast(message);  
      }  
    } catch (error) {  
      console.error('Error sending active tokens:', error);  
    }  
  }

  // Broadcast new token  
  broadcastNewToken(token: any) {  
    this.broadcast(JSON.stringify({  
      type: 'new_token',  
      data: token,  
      timestamp: new Date()  
    }));  
  }

  // Broadcast price updates with specific token data  
  async broadcastPriceUpdate(updates: any[]) {  
    // Get updated token data for each updated token  
    for (const update of updates) {  
      const subscribers = this.tokenSubscribers.get(update.token);  
      if (subscribers && subscribers.size > 0) {  
        const tokenData = await this.getTokenWithStats(update.token);  
        if (tokenData) {  
          const message = JSON.stringify({  
            type: 'token_update',  
            data: tokenData,  
            timestamp: new Date()  
          });  
            
          subscribers.forEach(ws => {  
            if (ws.readyState === WebSocket.OPEN) {  
              ws.send(message);  
            }  
          });  
        }  
      }  
    }

    // Also send general price update notification  
    this.broadcast(JSON.stringify({  
      type: 'price_update',  
      count: updates.length,  
      timestamp: new Date()  
    }));  
  }

  // Generic broadcast method (for index.ts compatibility)  
  broadcast(data: any) {  
    const message = typeof data === 'string' ? data : JSON.stringify(data);  
    this.clients.forEach((_subscriptions, client) => {  
      if (client.readyState === WebSocket.OPEN) {  
        client.send(message);  
      }  
    });  
  }

  // Start method (for index.ts compatibility)  
  async start() {  
    console.log(`✅ WebSocket server started on port ${config.websocket.port}`);  
  }

  // Stop method for graceful shutdown  
  async stop() {  
    return new Promise<void>((resolve) => {  
      this.wss.close(() => {  
        console.log('WebSocket server stopped');  
        resolve();  
      });  
    });  
  }  
}
