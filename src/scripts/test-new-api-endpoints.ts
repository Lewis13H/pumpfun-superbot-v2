/**
 * Test script for new fault tolerance and performance optimization API endpoints
 */

const API_BASE_URL = 'http://localhost:3001/api/v1';

async function testEndpoint(method: string, endpoint: string, body?: any) {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`\n🧪 Testing ${method} ${endpoint}`);
  
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success:', response.status, response.statusText);
      console.log('📊 Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Error:', response.status, response.statusText);
      console.log('📊 Response:', data);
    }
    
    return { success: response.ok, data };
  } catch (error) {
    console.log('❌ Request failed:', error);
    return { success: false, error };
  }
}

async function testSSEEndpoint(endpoint: string, duration: number = 10000) {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`\n🧪 Testing SSE ${endpoint} (listening for ${duration/1000}s)`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/event-stream'
      }
    });
    
    if (!response.ok) {
      console.log('❌ Failed to connect:', response.status, response.statusText);
      return;
    }
    
    console.log('✅ Connected to SSE stream');
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    const timeout = setTimeout(() => {
      console.log('⏱️ Timeout reached, closing connection');
      reader?.cancel();
    }, duration);
    
    while (reader) {
      const { done, value } = await reader.read();
      
      if (done) {
        clearTimeout(timeout);
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('event:')) {
          const event = line.substring(6).trim();
          console.log(`📨 Event: ${event}`);
        } else if (line.startsWith('data:')) {
          const data = line.substring(5).trim();
          try {
            const parsed = JSON.parse(data);
            console.log(`📊 Data:`, JSON.stringify(parsed, null, 2));
          } catch (e) {
            console.log(`📊 Data: ${data}`);
          }
        }
      }
      
      buffer = lines[lines.length - 1];
    }
  } catch (error) {
    console.log('❌ SSE connection failed:', error);
  }
}

async function runTests() {
  console.log('🚀 Starting API endpoint tests...');
  console.log('📍 API Base URL:', API_BASE_URL);
  
  // Test fault tolerance endpoints
  console.log('\n═══════════════════════════════════════');
  console.log('🛡️ FAULT TOLERANCE ENDPOINTS');
  console.log('═══════════════════════════════════════');
  
  await testEndpoint('GET', '/fault-tolerance/status');
  await testEndpoint('GET', '/fault-tolerance/circuit-breakers');
  await testEndpoint('GET', '/fault-tolerance/alerts');
  await testEndpoint('GET', '/fault-tolerance/alerts?limit=10&severity=critical');
  
  // Test performance optimization endpoints
  console.log('\n═══════════════════════════════════════');
  console.log('⚡ PERFORMANCE OPTIMIZATION ENDPOINTS');
  console.log('═══════════════════════════════════════');
  
  await testEndpoint('GET', '/performance/optimization/status');
  await testEndpoint('GET', '/performance/batch/metrics');
  await testEndpoint('GET', '/performance/cache/stats');
  await testEndpoint('GET', '/performance/resources');
  await testEndpoint('GET', '/performance/suggestions');
  
  // Test SSE streaming endpoint
  console.log('\n═══════════════════════════════════════');
  console.log('📡 SSE STREAMING ENDPOINT');
  console.log('═══════════════════════════════════════');
  
  await testSSEEndpoint('/performance/stream', 5000); // Listen for 5 seconds
  
  console.log('\n✅ All tests completed!');
}

// Run tests
runTests().catch(console.error);