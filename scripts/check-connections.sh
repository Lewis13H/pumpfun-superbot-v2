#!/bin/bash

echo "🔍 Checking for active connections and processes..."
echo ""

# Check for Node.js processes
echo "1. Node.js processes:"
PROCS=$(ps aux | grep -E 'node|tsx|npm' | grep -v grep | grep -v '/Applications/' | grep -v 'Code Helper' | wc -l)
if [ $PROCS -eq 0 ]; then
    echo "   ✅ No Node.js processes running"
else
    echo "   ⚠️  Found $PROCS Node.js processes:"
    ps aux | grep -E 'node|tsx|npm' | grep -v grep | grep -v '/Applications/' | grep -v 'Code Helper'
fi
echo ""

# Check for network connections
echo "2. Network connections to port 443 (HTTPS):"
CONNS=$(lsof -i :443 | grep -E 'node|tsx' | grep -v grep | wc -l)
if [ $CONNS -eq 0 ]; then
    echo "   ✅ No Node.js HTTPS connections"
else
    echo "   ⚠️  Found $CONNS HTTPS connections:"
    lsof -i :443 | grep -E 'node|tsx' | grep -v grep
fi
echo ""

# Check for gRPC specific connections
echo "3. gRPC/Shyft connections:"
GRPC=$(lsof -i | grep -E 'grpc|shyft|yellowstone' | grep -v grep | wc -l)
if [ $GRPC -eq 0 ]; then
    echo "   ✅ No gRPC connections found"
else
    echo "   ⚠️  Found $GRPC gRPC connections:"
    lsof -i | grep -E 'grpc|shyft|yellowstone' | grep -v grep
fi
echo ""

echo "4. Summary:"
if [ $PROCS -eq 0 ] && [ $CONNS -eq 0 ] && [ $GRPC -eq 0 ]; then
    echo "   ✅ All connections appear to be closed locally"
    echo "   ⏳ However, Shyft's server may still show active connections"
    echo "   ⏱️  Wait 5-10 minutes for server-side timeout"
else
    echo "   ⚠️  Active connections detected"
    echo "   Run ./scripts/deep-clean-connections.sh to force close all"
fi