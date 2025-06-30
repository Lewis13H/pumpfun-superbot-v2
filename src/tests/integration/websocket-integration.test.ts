/**
 * Integration tests for WebSocket server and client
 */

import { createServer } from 'http';
import { WebSocketServer } from '../../websocket/websocket-server';
import { EventBus, EVENTS } from '../../core/event-bus';
import { ConfigService } from '../../core/config';
import { WebSocket } from 'ws';

describe('WebSocket Integration Tests', () => {
  let httpServer: any;
  let wsServer: WebSocketServer;
  let eventBus: EventBus;
  let config: ConfigService;
  let wsClient: WebSocket;
  const port = 3456; // Test port

  beforeEach(async () => {
    // Create services
    eventBus = new EventBus();
    config = new ConfigService();
    
    // Override config for testing
    (config as any).config.api.webSocketPath = '/ws';
    
    // Create HTTP server
    httpServer = createServer();
    
    // Create WebSocket server
    wsServer = new WebSocketServer(httpServer, eventBus, config);
    
    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => resolve());
    });
  });

  afterEach(async () => {
    // Close client if connected
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Clear all event listeners
    eventBus.removeAllListeners();
  });
  
  afterAll(async () => {
    // Shutdown server after all tests
    await wsServer.shutdown();
    
    // Close HTTP server
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe('Connection Management', () => {
    it('should accept client connections', (done) => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      
      wsClient.on('open', () => {
        expect(wsClient.readyState).toBe(WebSocket.OPEN);
        done();
      });
    });

    it('should send welcome message on connection', (done) => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        expect(message.type).toBe('connected');
        expect(message.payload.clientId).toBeDefined();
        expect(message.payload.availableEvents).toBeInstanceOf(Array);
        done();
      });
    });

    it('should handle multiple clients', async () => {
      const clients: WebSocket[] = [];
      const messagePromises: Promise<any>[] = [];
      
      // Connect 5 clients
      for (let i = 0; i < 5; i++) {
        const client = new WebSocket(`ws://localhost:${port}/ws`);
        clients.push(client);
        
        // Create promise for welcome message
        const messagePromise = new Promise<any>((resolve) => {
          client.once('message', (data) => {
            resolve(JSON.parse(data.toString()));
          });
        });
        messagePromises.push(messagePromise);
        
        await new Promise<void>((resolve) => {
          client.on('open', () => resolve());
        });
      }
      
      // Wait for all welcome messages
      const messages = await Promise.all(messagePromises);
      
      // All should be connected
      expect(clients.every(c => c.readyState === WebSocket.OPEN)).toBe(true);
      
      // All should have received welcome messages
      const welcomeMessages = messages.filter(m => m.type === 'connected');
      expect(welcomeMessages).toHaveLength(5);
      
      // Clean up
      clients.forEach(c => c.close());
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should track client disconnections', async () => {
      const disconnectEvents: any[] = [];
      
      eventBus.on(EVENTS.WS_CLIENT_DISCONNECTED, (data) => {
        disconnectEvents.push(data);
      });
      
      // Connect and disconnect client
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      // Get client ID from welcome message
      let clientId: string | undefined;
      await new Promise<void>((resolve) => {
        wsClient.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'connected') {
            clientId = message.payload.clientId;
            resolve();
          }
        });
      });
      
      expect(clientId).toBeDefined();
      
      // Disconnect
      wsClient.close();
      
      // Wait for disconnect event
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(disconnectEvents).toHaveLength(1);
      expect(disconnectEvents[0].clientId).toBe(clientId!);
    });
  });

  describe('Message Broadcasting', () => {
    it('should broadcast trade events to all clients', async () => {
      const clients: WebSocket[] = [];
      const receivedMessages: any[] = [];
      
      // Connect 3 clients
      for (let i = 0; i < 3; i++) {
        const client = new WebSocket(`ws://localhost:${port}/ws`);
        clients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('open', () => resolve());
        });
        
        client.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === EVENTS.BC_TRADE) {
            receivedMessages.push({ clientIndex: i, message });
          }
        });
      }
      
      // Emit trade event
      const tradeData = {
        trade: {
          signature: 'test123',
          mintAddress: 'TestToken111111111111111111111111111111111',
          type: 'buy',
          solAmount: BigInt(1000000000),
          tokenAmount: BigInt(1000000)
        },
        monitor: 'BC Monitor'
      };
      
      eventBus.emit(EVENTS.BC_TRADE, tradeData);
      
      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // All clients should receive the message
      expect(receivedMessages).toHaveLength(3);
      expect(receivedMessages.every(m => m.message.payload.trade.signature === 'test123')).toBe(true);
      
      // Clean up
      clients.forEach(c => c.close());
    });

    it('should broadcast multiple event types', async () => {
      const messages: any[] = [];
      
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      wsClient.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });
      
      // Emit different event types
      eventBus.emit(EVENTS.BC_TRADE, { trade: { type: 'bc' } });
      eventBus.emit(EVENTS.AMM_TRADE, { trade: { type: 'amm' } });
      eventBus.emit(EVENTS.TOKEN_DISCOVERED, { mintAddress: 'new-token' });
      eventBus.emit(EVENTS.TOKEN_GRADUATED, { mintAddress: 'graduated-token' });
      eventBus.emit(EVENTS.SOL_PRICE_UPDATED, 180.50);
      
      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Should receive all event types
      const eventTypes = messages.map(m => m.type);
      expect(eventTypes).toContain(EVENTS.BC_TRADE);
      expect(eventTypes).toContain(EVENTS.AMM_TRADE);
      expect(eventTypes).toContain(EVENTS.TOKEN_DISCOVERED);
      expect(eventTypes).toContain(EVENTS.TOKEN_GRADUATED);
      expect(eventTypes).toContain(EVENTS.SOL_PRICE_UPDATED);
    });
  });

  describe('Client Commands', () => {
    it('should handle ping/pong', async () => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      const pongPromise = new Promise<void>((resolve) => {
        wsClient.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'pong') {
            expect(message.payload.timestamp).toBeDefined();
            resolve();
          }
        });
      });
      
      // Send ping
      wsClient.send(JSON.stringify({ type: 'ping' }));
      
      await pongPromise;
    });

    it('should handle subscription management', async () => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      let subscribedMessage: any;
      
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'subscribed') {
          subscribedMessage = message;
        }
      });
      
      // Subscribe to specific events
      wsClient.send(JSON.stringify({
        type: 'subscribe',
        events: [EVENTS.BC_TRADE, EVENTS.TOKEN_GRADUATED]
      }));
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(subscribedMessage).toBeDefined();
      expect(subscribedMessage.payload.events).toEqual([EVENTS.BC_TRADE, EVENTS.TOKEN_GRADUATED]);
      expect(subscribedMessage.payload.subscriptions).toContain(EVENTS.BC_TRADE);
      expect(subscribedMessage.payload.subscriptions).toContain(EVENTS.TOKEN_GRADUATED);
    });

    it('should filter events based on subscription', async () => {
      const messages: any[] = [];
      
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type !== 'connected' && 
            message.type !== 'subscribed' && 
            message.type !== 'unsubscribed') {
          messages.push(message);
        }
      });
      
      // Subscribe only to BC trades
      wsClient.send(JSON.stringify({
        type: 'subscribe',
        events: [EVENTS.BC_TRADE]
      }));
      
      // Unsubscribe from 'all'
      wsClient.send(JSON.stringify({
        type: 'unsubscribe',
        events: ['all']
      }));
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Emit various events
      eventBus.emit(EVENTS.BC_TRADE, { trade: { type: 'bc' } });
      eventBus.emit(EVENTS.AMM_TRADE, { trade: { type: 'amm' } });
      eventBus.emit(EVENTS.TOKEN_DISCOVERED, { mintAddress: 'new' });
      
      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Should only receive BC trade
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(EVENTS.BC_TRADE);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON messages', async () => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      let errorMessage: any;
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          errorMessage = message;
        }
      });
      
      // Send invalid JSON
      wsClient.send('invalid json {');
      
      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(errorMessage).toBeDefined();
      expect(errorMessage.payload.error).toContain('Invalid message format');
    });

    it('should handle unknown message types', async () => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      let errorMessage: any;
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          errorMessage = message;
        }
      });
      
      // Send unknown command
      wsClient.send(JSON.stringify({ type: 'unknown-command' }));
      
      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(errorMessage).toBeDefined();
      expect(errorMessage.payload.error).toContain('Unknown message type');
    });
  });

  describe('Performance', () => {
    it('should handle rapid message broadcasting', async () => {
      const messageCount = 1000;
      const receivedMessages: any[] = [];
      
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === EVENTS.BC_TRADE) {
          receivedMessages.push(message);
        }
      });
      
      // Broadcast many messages rapidly
      const startTime = Date.now();
      for (let i = 0; i < messageCount; i++) {
        eventBus.emit(EVENTS.BC_TRADE, {
          trade: { signature: `sig${i}` },
          monitor: 'BC Monitor'
        });
      }
      
      // Wait for all messages
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (receivedMessages.length >= messageCount) {
            clearInterval(checkInterval);
            resolve(undefined);
          }
        }, 10);
      });
      
      const duration = Date.now() - startTime;
      
      expect(receivedMessages).toHaveLength(messageCount);
      expect(duration).toBeLessThan(1000); // Should handle 1000 messages in < 1 second
    });

    it('should batch messages efficiently', async () => {
      const stats = wsServer.getStats();
      expect(stats.queuedMessages).toBe(0);
      
      // Emit many events without clients
      for (let i = 0; i < 100; i++) {
        eventBus.emit(EVENTS.BC_TRADE, { trade: { id: i } });
      }
      
      // Queue should process efficiently
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const newStats = wsServer.getStats();
      expect(newStats.queuedMessages).toBe(0); // Should be processed
    });
  });

  describe('Graceful Shutdown', () => {
    it('should notify clients on shutdown', async () => {
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });
      
      let shutdownMessage: any;
      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'server_shutdown') {
          shutdownMessage = message;
        }
      });
      
      // Initiate shutdown
      wsServer.shutdown();
      
      // Wait for shutdown message
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(shutdownMessage).toBeDefined();
      expect(shutdownMessage.payload.message).toContain('shutting down');
    });
  });
});