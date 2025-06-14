// Test what yellowstone-grpc exports
const yellowstone = require('@triton-one/yellowstone-grpc');

console.log('Default export:', yellowstone);
console.log('Properties:', Object.keys(yellowstone));

// Try different import methods
try {
  const Client = yellowstone.default;
  console.log('Client from default:', Client);
} catch (e) {
  console.log('No default export');
}

try {
  const { Client } = yellowstone;
  console.log('Client from destructure:', Client);
} catch (e) {
  console.log('No Client named export');
}