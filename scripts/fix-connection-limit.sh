#!/bin/bash

echo "🔧 Fixing Shyft connection limit issue..."
echo ""

# Kill any existing Node.js processes running the monitors
echo "1. Killing any existing monitor processes..."
pkill -f "tsx.*monitor" || true
pkill -f "node.*monitor" || true
pkill -f "start-refactored" || true

echo "   ✅ Cleaned up existing processes"
echo ""

# Wait a bit for connections to close
echo "2. Waiting 10 seconds for connections to close..."
sleep 10

echo ""
echo "3. Connection limit solutions:"
echo ""
echo "   Option A: Wait 5-10 minutes for existing connections to timeout"
echo "   Option B: Use a different Shyft API key if available"
echo "   Option C: Contact Shyft support to increase connection limit"
echo ""
echo "4. To prevent this in the future:"
echo "   - Always use Ctrl+C to gracefully shutdown monitors"
echo "   - Don't run multiple instances of the monitoring system"
echo "   - Consider implementing connection pooling"
echo ""
echo "5. When ready, start the monitors again with:"
echo "   npm run start"
echo ""
echo "💡 Pro tip: You can check for running processes with:"
echo "   ps aux | grep -E 'tsx|node' | grep -v grep"