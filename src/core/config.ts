/**
 * Centralized Configuration Service
 */

import 'dotenv/config';

export interface DatabaseConfig {
  url: string;
  poolSize: number;
  idleTimeout: number;
  connectionTimeout: number;
}

export interface MonitorConfig {
  bcSaveThreshold: number;
  ammSaveThreshold: number;
  saveAllTokens: boolean;
  displayInterval: number;
  debugParseErrors: boolean;
}

export interface ServiceConfig {
  solPriceUpdateInterval: number;
  enrichmentBatchSize: number;
  enrichmentInterval: number;
  recoveryInterval: number;
  recoveryBatchSize: number;
}

export interface GrpcConfig {
  endpoint: string;
  token: string;
  reconnectDelay: number;
  maxReconnectDelay: number;
  keepAliveInterval: number;
  keepAliveTimeout: number;
}

export interface ApiConfig {
  port: number;
  corsOrigins: string[];
  enableWebSocket: boolean;
  webSocketPath: string;
}

export interface Config {
  database: DatabaseConfig;
  monitors: MonitorConfig;
  services: ServiceConfig;
  grpc: GrpcConfig;
  api: ApiConfig;
  heliusApiKey?: string;
  shyftApiKey?: string;
}

export class ConfigService {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  private loadConfig(): Config {
    return {
      database: {
        url: process.env.DATABASE_URL || '',
        poolSize: this.parseNumber(process.env.DB_POOL_SIZE, 10),
        idleTimeout: this.parseNumber(process.env.DB_IDLE_TIMEOUT, 30000),
        connectionTimeout: this.parseNumber(process.env.DB_CONNECTION_TIMEOUT, 5000)
      },
      monitors: {
        bcSaveThreshold: this.parseNumber(process.env.BC_SAVE_THRESHOLD, 8888),
        ammSaveThreshold: this.parseNumber(process.env.AMM_SAVE_THRESHOLD, 1000),
        saveAllTokens: process.env.SAVE_ALL_TOKENS === 'true',
        displayInterval: this.parseNumber(process.env.DISPLAY_INTERVAL, 10000),
        debugParseErrors: process.env.DEBUG_PARSE_ERRORS === 'true'
      },
      services: {
        solPriceUpdateInterval: this.parseNumber(process.env.SOL_PRICE_UPDATE_INTERVAL, 5000),
        enrichmentBatchSize: this.parseNumber(process.env.ENRICHMENT_BATCH_SIZE, 50),
        enrichmentInterval: this.parseNumber(process.env.ENRICHMENT_INTERVAL, 30000),
        recoveryInterval: this.parseNumber(process.env.RECOVERY_INTERVAL, 1800000), // 30 minutes
        recoveryBatchSize: this.parseNumber(process.env.RECOVERY_BATCH_SIZE, 10)
      },
      grpc: {
        endpoint: process.env.SHYFT_GRPC_ENDPOINT || '',
        token: process.env.SHYFT_GRPC_TOKEN || '',
        reconnectDelay: this.parseNumber(process.env.GRPC_RECONNECT_DELAY, 5000),
        maxReconnectDelay: this.parseNumber(process.env.GRPC_MAX_RECONNECT_DELAY, 60000),
        keepAliveInterval: this.parseNumber(process.env.GRPC_KEEPALIVE_INTERVAL, 30000),
        keepAliveTimeout: this.parseNumber(process.env.GRPC_KEEPALIVE_TIMEOUT, 5000)
      },
      api: {
        port: this.parseNumber(process.env.API_PORT, 3002),
        corsOrigins: this.parseArray(process.env.CORS_ORIGINS, ['http://localhost:3000']),
        enableWebSocket: process.env.ENABLE_WEBSOCKET !== 'false',
        webSocketPath: process.env.WEBSOCKET_PATH || '/ws'
      },
      heliusApiKey: process.env.HELIUS_API_KEY,
      shyftApiKey: process.env.SHYFT_API_KEY
    };
  }

  private validateConfig(): void {
    const errors: string[] = [];

    // Required fields
    if (!this.config.database.url) {
      errors.push('DATABASE_URL is required');
    }
    if (!this.config.grpc.endpoint) {
      errors.push('SHYFT_GRPC_ENDPOINT is required');
    }
    if (!this.config.grpc.token) {
      errors.push('SHYFT_GRPC_TOKEN is required');
    }

    // Validate URLs
    if (this.config.grpc.endpoint && !this.config.grpc.endpoint.startsWith('https://')) {
      errors.push('SHYFT_GRPC_ENDPOINT must start with https://');
    }

    // Validate numbers
    if (this.config.monitors.bcSaveThreshold < 0) {
      errors.push('BC_SAVE_THRESHOLD must be positive');
    }
    if (this.config.monitors.ammSaveThreshold < 0) {
      errors.push('AMM_SAVE_THRESHOLD must be positive');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n${errors.join('\n')}`);
    }
  }

  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private parseArray(value: string | undefined, defaultValue: string[]): string[] {
    if (!value) return defaultValue;
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Get a specific configuration section
   */
  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  /**
   * Get the entire configuration
   */
  getAll(): Config {
    return { ...this.config };
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(feature: string): boolean {
    switch (feature) {
      case 'websocket':
        return this.config.api.enableWebSocket;
      case 'saveAllTokens':
        return this.config.monitors.saveAllTokens;
      case 'debugParseErrors':
        return this.config.monitors.debugParseErrors;
      default:
        return false;
    }
  }

  /**
   * Get environment
   */
  getEnvironment(): string {
    return process.env.NODE_ENV || 'development';
  }

  /**
   * Check if in production
   */
  isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }

  /**
   * Check if in development
   */
  isDevelopment(): boolean {
    return this.getEnvironment() === 'development';
  }

  /**
   * Log configuration (masks sensitive values)
   */
  logConfig(): void {
    const masked = { ...this.config };
    
    // Mask sensitive values
    if (masked.grpc.token) {
      masked.grpc.token = masked.grpc.token.substring(0, 8) + '...';
    }
    if (masked.heliusApiKey) {
      masked.heliusApiKey = masked.heliusApiKey.substring(0, 8) + '...';
    }
    if (masked.shyftApiKey) {
      masked.shyftApiKey = masked.shyftApiKey.substring(0, 8) + '...';
    }
    if (masked.database.url) {
      const url = new URL(masked.database.url);
      if (url.password) {
        url.password = '***';
      }
      masked.database.url = url.toString();
    }
    
    if (process.env.DISABLE_MONITOR_STATS !== 'true') {
      console.log('Configuration loaded:', JSON.stringify(masked, null, 2));
    }
  }
}

// Export singleton instance
export const configService = new ConfigService();