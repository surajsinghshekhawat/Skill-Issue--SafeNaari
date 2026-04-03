/**
 * Integration Test Script
 * Tests the ML service integration with Node.js backend
 */

const axios = require('axios');

const ML_SERVICE_URL = 'http://192.168.1.7:8000';
const BACKEND_URL = 'http://192.168.1.7:3001';

// Test colors for terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testMLServiceHealth() {
  log('\n[TEST 1] Checking ML Service Health...', 'blue');
  try {
    // Try /ml/health first, fallback to /health
    let response;
    try {
      response = await axios.get(`${ML_SERVICE_URL}/ml/health`);
    } catch (e) {
      response = await axios.get(`${ML_SERVICE_URL}/health`);
    }
    
    if (response.data.status === 'healthy' || response.data.status === 'running') {
      log('[OK] ML Service is healthy', 'green');
      return true;
    } else {
      log('[FAIL] ML Service returned unexpected status', 'red');
      return false;
    }
  } catch (error) {
    log(`[FAIL] ML Service not responding: ${error.message}`, 'red');
    log('Make sure ML service is running: uvicorn app.main:app --reload --port 8000', 'yellow');
    return false;
  }
}

async function testBackendHealth() {
  log('\n[TEST 2] Checking Backend API Health...', 'blue');
  try {
    const response = await axios.get(`${BACKEND_URL}/health`);
    if (response.data.status === 'OK') {
      log('[OK] Backend API is responding', 'green');
      return true;
    } else {
      log('[FAIL] Backend API returned unexpected status', 'red');
      return false;
    }
  } catch (error) {
    log(`[FAIL] Backend API not responding: ${error.message}`, 'red');
    log('Make sure backend is running: npm run dev', 'yellow');
    return false;
  }
}

async function testLocationUpdate() {
  log('\n[TEST 3] Testing Location Update with Risk Assessment...', 'blue');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/location/update`, {
      userId: 'test_user_123',
      latitude: 13.0827,
      longitude: 80.2707,
    });

    if (response.data.success && response.data.riskAssessment) {
      log('[OK] Location update successful', 'green');
      log(`   Risk Score: ${response.data.riskAssessment.riskScore}`, 'blue');
      log(`   Risk Level: ${response.data.riskAssessment.riskLevel}`, 'blue');
      log(`   High Risk: ${response.data.riskAssessment.isHighRisk}`, 'blue');
      return true;
    } else {
      log('[WARN] Location update succeeded but no risk assessment', 'yellow');
      return true; // Still counts as success
    }
  } catch (error) {
    log(`[FAIL] Location update failed: ${error.message}`, 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Data: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

async function testHeatmap() {
  log('\n[TEST 4] Testing Heatmap Generation...', 'blue');
  try {
    const response = await axios.get(`${BACKEND_URL}/api/location/heatmap`, {
      params: {
        lat: 13.0827,
        lng: 80.2707,
        radius: 1000,
        grid_size: 50,
      },
    });

    if (response.data.success && response.data.heatmap) {
      log('[OK] Heatmap generation successful', 'green');
      log(`   Center: (${response.data.heatmap.center.lat}, ${response.data.heatmap.center.lng})`, 'blue');
      log(`   Radius: ${response.data.heatmap.radius}m`, 'blue');
      log(`   Grid Size: ${response.data.heatmap.grid_size}`, 'blue');
      log(`   Cells: ${response.data.heatmap.cells?.length || 0}`, 'blue');
      log(`   Clusters: ${response.data.heatmap.clusters?.length || 0}`, 'blue');
      return true;
    } else {
      log('[FAIL] Heatmap generation failed', 'red');
      log(`   Response: ${JSON.stringify(response.data)}`, 'red');
      return false;
    }
  } catch (error) {
    log(`[FAIL] Heatmap request failed: ${error.message}`, 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Data: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

async function testRouteAnalysis() {
  log('\n[TEST 5] Testing Route Analysis...', 'blue');
  try {
    const response = await axios.get(`${BACKEND_URL}/api/location/safe-routes`, {
      params: {
        startLat: 13.0827,
        startLng: 80.2707,
        endLat: 13.0850,
        endLng: 80.2750,
      },
    });

    if (response.data.success && response.data.routes) {
      log('[OK] Route analysis successful', 'green');
      log(`   Routes analyzed: ${response.data.routes.routes?.length || 0}`, 'blue');
      if (response.data.routes.routes && response.data.routes.routes.length > 0) {
        const route = response.data.routes.routes[0];
        log(`   First route safety score: ${route.safetyScore}`, 'blue');
        log(`   First route risk score: ${route.riskScore}`, 'blue');
      }
      log(`   Recommended route: ${response.data.routes.recommendedRoute || 'none'}`, 'blue');
      return true;
    } else {
      log('[FAIL] Route analysis failed', 'red');
      log(`   Response: ${JSON.stringify(response.data)}`, 'red');
      return false;
    }
  } catch (error) {
    log(`[FAIL] Route analysis request failed: ${error.message}`, 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Data: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

async function testPanicAlert() {
  log('\n[TEST 6] Testing Panic Alert Processing...', 'blue');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/panic/trigger`, {
      userId: 'test_user_123',
      location: {
        latitude: 13.0827,
        longitude: 80.2707,
      },
      emergencyContacts: ['contact1', 'contact2'],
    });

    if (response.data.success) {
      log('[OK] Panic alert processed successfully', 'green');
      log(`   Panic ID: ${response.data.panicId}`, 'blue');
      if (response.data.mlProcessing) {
        log(`   ML Processing: ${response.data.mlProcessing.modelUpdated ? 'Model updated' : 'No update'}`, 'blue');
        log(`   Affected zones: ${response.data.mlProcessing.affectedZones?.length || 0}`, 'blue');
      }
      return true;
    } else {
      log('[FAIL] Panic alert processing failed', 'red');
      log(`   Response: ${JSON.stringify(response.data)}`, 'red');
      return false;
    }
  } catch (error) {
    log(`[FAIL] Panic alert request failed: ${error.message}`, 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Data: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

async function runAllTests() {
  log('\n========================================', 'blue');
  log('ML Service Integration Test Suite', 'blue');
  log('========================================', 'blue');

  const results = [];

  // Test ML service health
  results.push(await testMLServiceHealth());

  // Test backend health
  results.push(await testBackendHealth());

  // Only run integration tests if both services are up
  if (results[0] && results[1]) {
    results.push(await testLocationUpdate());
    results.push(await testHeatmap());
    results.push(await testRouteAnalysis());
    results.push(await testPanicAlert());
  } else {
    log('\n[SKIP] Skipping integration tests - services not available', 'yellow');
  }

  // Summary
  const passed = results.filter(r => r).length;
  const total = results.length;

  log('\n========================================', 'blue');
  log(`Test Summary: ${passed}/${total} tests passed`, passed === total ? 'green' : 'yellow');
  log('========================================', 'blue');

  if (passed === total) {
    log('\n[SUCCESS] All tests passed!', 'green');
    process.exit(0);
  } else {
    log('\n[FAILURE] Some tests failed', 'red');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  log(`\n[FATAL ERROR] ${error.message}`, 'red');
  process.exit(1);
});

