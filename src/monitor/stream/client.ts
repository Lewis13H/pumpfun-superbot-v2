// src/monitor/stream/client.ts

import Client from '@triton-one/yellowstone-grpc';
import { EventEmitter } from 'events';
import { config } from '../../config';

export class StreamClient extends EventEmitter {
  private client: Client;
  private stream: any = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;

  constructor() {
    super();
    this.client = new Client(
      config.shyft.endpoint,
      config.shyft.token,
      undefined
    );
  }

  async connect(): Promise<void> {
    try {
      console.log('🔄 Connecting to Yellowstone gRPC...');
      console.log(`Endpoint: ${config.shyft.endpoint}`);
      
      this.stream = await this.client.subscribe();
      console.log('📡 Stream created successfully');

      this.setupStreamHandlers();
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Failed to connect:', error);
      await this.handleReconnect();
    }
  }

  private setupStreamHandlers(): void {
    this.stream.on('error', (error: any) => {
      console.log('❌ Stream error:', error);
      this.emit('error', error);
      this.handleReconnect();
    });

    this.stream.on('end', () => {
      console.log('Stream ended');
      this.handleReconnect();
    });

    this.stream.on('close', () => {
      console.log('Stream closed');
      this.handleReconnect();
    });

    this.stream.on('data', (data: any) => {
      this.emit('data', data);
    });
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('disconnect');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting in ${this.reconnectDelay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(console.error);
    }, this.reconnectDelay);
  }

  async subscribe(request: any): Promise<void> {
    if (!this.stream) {
      throw new Error('Stream not connected');
    }

    return new Promise((resolve, reject) => {
      this.stream.write(request, (err: any) => {
        if (err === null || err === undefined) {
          console.log('✅ Subscription request sent successfully');
          resolve();
        } else {
          console.log('❌ Failed to send subscription request:', err);
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
