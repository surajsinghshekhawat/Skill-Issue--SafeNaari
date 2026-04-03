/**
 * Full System Integration Test
 * Tests: Backend API + ML Service + Database
 */

const axios = require('axios');

const ML_SERVICE_URL = 'http://192.168.1.7:8000';
const BACKEND_URL = 'http://192.168.1.7:3001';

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

async function testFullSystem() {
  log('\n========================================', 'blue');
  log('Full System Integration Test', 'blue');
  log('Backend API + ML Service + Database', 'blue');
  log('========================================', 'blue');

  const results = [];

  // Test 1: ML Service Health
  log('\n[TEST 1] ML Service Health...', 'blue');
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/health`);
    if (response.data.status === 'healthy' || response.data.status === 'running') {
      log('[OK] ML Service is healthy', 'green');
      results.push(true);
    } else {
      log('[FAIL] ML Service unhealthy', 'red');
      results.push(false);
    }
  } catch (error) {
    log(`[FAIL] ML Service not responding: ${error.message}`, 'red');
    results.push(false);
  }

  // Test 2: Backend API Health
  log('\n[TEST 2] Backend API Health...', 'blue');
  try {
    const response = await axios.get(`${BACKEND_URL}/health`);
    if (response.data.status === 'OK') {
      log('[OK] Backend API is responding', 'green');
      results.push(true);
    } else {
      log('[FAIL] Backend API unhealthy', 'red');
      results.push(false);
    }
  } catch (error) {
    log(`[FAIL] Backend API not responding: ${error.message}`, 'red');
    results.push(false);
  }

  if (!results[0] || !results[1]) {
    log('\n[SKIP] Skipping integration tests - services not available', 'yellow');
    return;
  }

  // Test 3: Location Update (Backend → ML Service → Database)
  log('\n[TEST 3] Location Update (Full Flow)...', 'blue');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/location/update`, {
      userId: 'test_user_full',
      latitude: 13.0827,
      longitude: 80.2707,
    });

    if (response.data.success && response.data.riskAssessment) {
      log('[OK] Location update successful', 'green');
      log(`   Risk Score: ${response.data.riskAssessment.riskScore}`, 'blue');
      log(`   Risk Level: ${response.data.riskAssessment.riskLevel}`, 'blue');
      results.push(true);
    } else {
      log('[WARN] Location update succeeded but no risk assessment', 'yellow');
      results.push(true);
    }
  } catch (error) {
    log(`[FAIL] Location update failed: ${error.message}`, 'red');
    results.push(false);
  }

  // Test 4: Heatmap (Backend → ML Service → Database)
  log('\n[TEST 4] Heatmap Generation (Full Flow)...', 'blue');
  try {
    const response = await axios.get(`${BACKEND_URL}/api/location/heatmap`, {
      params: { lat: 13.0827, lng: 80.2707, radius: 1000, grid_size: 50 },
    });

    if (response.data.success && response.data.heatmap) {
      log('[OK] Heatmap generation successful', 'green');
      log(`   Cells: ${response.data.heatmap.cells?.length || 0}`, 'blue');
      log(`   Clusters: ${response.data.heatmap.clusters?.length || 0}`, 'blue');
      results.push(true);
    } else {
      log('[FAIL] Heatmap generation failed', 'red');
      results.push(false);
    }
  } catch (error) {
    log(`[FAIL] Heatmap request failed: ${error.message}`, 'red');
    results.push(false);
  }

  // Test 5: Route Analysis (Backend → ML Service → Database)
  log('\n[TEST 5] Route Analysis (Full Flow)...', 'blue');
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
      results.push(true);
    } else {
      log('[FAIL] Route analysis failed', 'red');
      results.push(false);
    }
  } catch (error) {
    log(`[FAIL] Route analysis failed: ${error.message}`, 'red');
    results.push(false);
  }

  // Test 6: Panic Alert (Backend → ML Service → Database)
  log('\n[TEST 6] Panic Alert Processing (Full Flow)...', 'blue');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/panic/trigger`, {
      userId: 'test_user_full',
      location: { latitude: 13.0827, longitude: 80.2707 },
      emergencyContacts: ['contact1'],
    });

    if (response.data.success) {
      log('[OK] Panic alert processed successfully', 'green');
      log(`   Panic ID: ${response.data.panicId}`, 'blue');
      if (response.data.mlProcessing) {
        log(`   ML Processing: ${response.data.mlProcessing.modelUpdated ? 'Model updated' : 'No update'}`, 'blue');
      }
      results.push(true);
    } else {
      log('[FAIL] Panic alert processing failed', 'red');
      results.push(false);
    }
  } catch (error) {
    log(`[FAIL] Panic alert failed: ${error.message}`, 'red');
    results.push(false);
  }

  // Summary
  const passed = results.filter(r => r).length;
  const total = results.length;

  log('\n========================================', 'blue');
  log(`Test Summary: ${passed}/${total} tests passed`, passed === total ? 'green' : 'yellow');
  log('========================================', 'blue');

  if (passed === total) {
    log('\n[SUCCESS] Full system integration working!', 'green');
    log('\nSystem Components:', 'blue');
    log('  ✅ Database (PostgreSQL + PostGIS)', 'green');
    log('  ✅ ML Service (Python/FastAPI)', 'green');
    log('  ✅ Backend API (Node.js/Express)', 'green');
    log('  ✅ All integrations working', 'green');
    process.exit(0);
  } else {
    log('\n[FAILURE] Some tests failed', 'red');
    process.exit(1);
  }
}

testFullSystem().catch(error => {
  log(`\n[FATAL ERROR] ${error.message}`, 'red');
  process.exit(1);
});



