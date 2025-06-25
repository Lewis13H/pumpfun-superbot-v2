# Examples

This directory contains examples demonstrating advanced features of the Pump.fun Token Price Monitor.

## modify-subscription.ts

Demonstrates how to modify subscription parameters without disconnecting from the gRPC stream.

```bash
npx tsx src/examples/modify-subscription.ts
```

Features demonstrated:
- Starting with one program filter (Pump.fun)
- Dynamically switching to another program (Jupiter) after 30 seconds
- Switching back to original program after 60 seconds
- All without disconnecting the stream

This follows the pattern from Shyft's `modifying_subscribe_request` example.