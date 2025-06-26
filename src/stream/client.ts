import Client from '@triton-one/yellowstone-grpc';
import { ChannelOptions } from '@grpc/grpc-js';

export class StreamClient {
  private static instance: StreamClient;
  private client: Client;

  private constructor() {
    const endpoint = process.env.SHYFT_GRPC_ENDPOINT || '';
    const token = process.env.SHYFT_GRPC_TOKEN || '';
    
    if (!endpoint || !token) {
      throw new Error('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN in environment variables');
    }
    
    // Ensure endpoint is a valid URL
    let formattedEndpoint = endpoint;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      formattedEndpoint = `https://${endpoint}`;
    }
    
    // Configure gRPC channel options for better connection stability
    const channelOptions: ChannelOptions = {
      'grpc.keepalive_time_ms': 30000,           // Send keepalive ping every 30 seconds
      'grpc.keepalive_timeout_ms': 10000,        // Wait 10 seconds for ping ack
      'grpc.keepalive_permit_without_calls': 1,  // Send pings even without active calls
      'grpc.initial_reconnect_backoff_ms': 1000, // Start reconnect after 1 second
      'grpc.max_reconnect_backoff_ms': 30000,    // Max 30 seconds between reconnect attempts
      'grpc.client_idle_timeout_ms': 300000,     // 5 minutes idle timeout
      'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB max message size
      'grpc.max_send_message_length': 50 * 1024 * 1024,    // 50MB max message size
    };
    
    console.log('🔧 Initializing gRPC client with keepalive settings');
    this.client = new Client(formattedEndpoint, token, channelOptions);
  }

  static getInstance(): StreamClient {
    if (!StreamClient.instance) {
      StreamClient.instance = new StreamClient();
    }
    return StreamClient.instance;
  }

  getClient(): Client {
    return this.client;
  }
}