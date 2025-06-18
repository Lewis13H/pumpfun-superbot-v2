import express from 'express';
import path from 'path';
import { config } from './config';

export class WebServer {
  private app: express.Application;
  private server: any;
  
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // Parse JSON bodies
    this.app.use(express.json());
    
    // Serve static files from dashboard directory
    this.app.use(express.static(path.join(__dirname, '../dashboard')));
    
    // CORS headers for API requests
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }

  private setupRoutes() {
    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../dashboard/index.html'));
    });

    // Token detail page route
    this.app.get('/token/:address', (req, res) => {
      res.sendFile(path.join(__dirname, '../dashboard/token.html'));
    });

    // API endpoint for token data (optional, for future use)
    this.app.get('/api/token/:address', async (req, res) => {
      try {
        const { address } = req.params;
        // You can add token fetching logic here if needed
        res.json({ 
          message: 'Token API endpoint', 
          address 
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch token data' });
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date() 
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).sendFile(path.join(__dirname, '../dashboard/404.html'));
    });
  }

  async start(port: number = 3000) {
    return new Promise<void>((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`✅ Web server started on http://localhost:${port}`);
        resolve();
      });
    });
  }

  async stop() {
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Web server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}