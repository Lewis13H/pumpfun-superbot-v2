#!/bin/bash

echo "🧹 Deep cleaning all Node.js processes and connections..."
echo ""

# 1. Kill ALL Node.js related processes
echo "1. Killing all Node.js processes..."
pkill -9 -f "node" || true
pkill -9 -f "tsx" || true
pkill -9 -f "npm" || true
sleep 2

# 2. Clear any port bindings
echo "2. Checking for processes on common ports..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
lsof -ti:8545 | xargs kill -9 2>/dev/null || true

# 3. Flush DNS cache (macOS)
echo "3. Flushing DNS cache..."
sudo dscacheutil -flushcache 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true

# 4. Check remaining connections
echo ""
echo "4. Checking for remaining connections..."
CONNECTIONS=$(lsof -i | grep -E 'node|tsx|npm' | grep -v grep | wc -l)
if [ $CONNECTIONS -eq 0 ]; then
    echo "   ✅ All local connections closed"
else
    echo "   ⚠️  Found $CONNECTIONS remaining connections"
    lsof -i | grep -E 'node|tsx|npm' | grep -v grep
fi

echo ""
echo "5. Next steps:"
echo "   - Wait 10-15 minutes for Shyft server to release connections"
echo "   - The Shyft server needs time to detect that connections are closed"
echo "   - Their timeout is typically 5-10 minutes"
echo ""
echo "6. Alternative solutions:"
echo "   a) Use a VPN to get a different IP address"
echo "   b) Use a different SHYFT_GRPC_TOKEN if available"
echo "   c) Contact Shyft support:"
echo "      - Email: support@shyft.to"
echo "      - Discord: https://discord.gg/shyft"
echo "      - Request to increase connection limit for your token"
echo ""
echo "7. To test if connections are cleared:"
echo "   npm run start"
echo ""
echo "💡 Connection limit details:"
echo "   - Shyft typically allows 2-5 concurrent connections per token"
echo "   - Each monitor creates 1 connection"
echo "   - Running 4 monitors = 4 connections"
echo "   - Consider running fewer monitors if hitting limits"