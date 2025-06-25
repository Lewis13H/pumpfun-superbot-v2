import Client from '@triton-one/yellowstone-grpc';

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
    
    
    this.client = new Client(formattedEndpoint, token, undefined);
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