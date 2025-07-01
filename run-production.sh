#!/bin/bash

# Run monitors in production mode
# Optimized for long-running sessions with minimal logging

echo "Starting Pump.fun Monitor System in Production Mode..."

# Load production environment
export NODE_ENV=production
export $(cat .env.production | grep -v '^#' | xargs)

# Run with production settings
npm run start