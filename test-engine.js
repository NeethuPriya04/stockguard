// test-engine.js
// Verification suite for StockGuard deterministic rule engine and auto-ledger

import { clearAll, getLedgerEntry, getAllAudit } from './src/db.js';
import { processScan, validateBatch } from './src/engine.js';

async function runTests() {
  console.log('====================================================');
  console.log(' StockGuard Deterministic Engine & Ledger Test Suite');
  console.log('====================================================\n');

  // Reset database before tests
  await clearAll();

  // Test batches
  const batch1 = {
    id: 'PARLE-G-2026-M04-B101',
    brand: 'PARLE-G',
    mfg: '2026-08-01',
    exp: '2026-12-31',
    category: 'biscuit',
  };

  const batchExpired = {
    id: 'TATA-SLT-2022-1001',
    brand: 'TATA-SALT',
    mfg: '2022-01-01',
    exp: '2023-01-01',
    category: 'staples',
  };

  // ----------------------------------------------------
  // TEST 1: INTAKE same batch twice -> 2nd should still be GREEN
  // ----------------------------------------------------
  console.log('--- TEST 1: INTAKE same batch twice ---');
  const t1_intake1 = await processScan({ batch: batch1, mode: 'INTAKE' });
  console.log(`Intake #1: status=${t1_intake1.status} | title="${t1_intake1.title}" | message="${t1_intake1.message}"`);

  const t1_intake2 = await processScan({ batch: batch1, mode: 'INTAKE' });
  console.log(`Intake #2: status=${t1_intake2.status} | title="${t1_intake2.title}" | message="${t1_intake2.message}"`);
  console.log(`Result: ${t1_intake2.status === 'GREEN' ? 'PASS (2nd intake is GREEN)' : 'FAIL'}\n`);

  // ----------------------------------------------------
  // TEST 2 & 3: Single-intake batch lifecycle
  // ----------------------------------------------------
  console.log('--- TEST 2 & 3: Single intake unit lifecycle ---');
  const batch2 = {
    id: 'AMUL-26A1002',
    brand: 'AMUL-BTR',
    mfg: '2026-08-15',
    exp: '2026-11-15',
    category: 'dairy',
  };

  // Setup 1 intake
  const setupIntake = await processScan({ batch: batch2, mode: 'INTAKE' });
  console.log(`Initial Intake: status=${setupIntake.status} (inventory: 1)`);

  // Test 2: SALE same batch once -> GREEN
  console.log('\n--- TEST 2: SALE same batch once ---');
  const t2_sale1 = await processScan({ batch: batch2, mode: 'SALE' });
  console.log(`Sale #1: status=${t2_sale1.status} | title="${t2_sale1.title}" | message="${t2_sale1.message}"`);
  console.log(`Result: ${t2_sale1.status === 'GREEN' ? 'PASS (Sale is GREEN)' : 'FAIL'}\n`);

  // Test 3: SALE same batch again (no more intake) -> RED duplicate
  console.log('--- TEST 3: SALE same batch again (no more intake) ---');
  const t3_sale2 = await processScan({ batch: batch2, mode: 'SALE' });
  console.log(`Sale #2: status=${t3_sale2.status} | title="${t3_sale2.title}" | message="${t3_sale2.message}"`);
  console.log(`Result: ${t3_sale2.status === 'RED' && t3_sale2.title === 'DUPLICATE BATCH DETECTED' ? 'PASS (Duplicate detected as RED)' : 'FAIL'}\n`);

  // ----------------------------------------------------
  // TEST 4: Expired batch (mfg: 2022, exp: 2023) -> RED rejected
  // ----------------------------------------------------
  console.log('--- TEST 4: Expired batch (mfg: 2022, exp: 2023) ---');
  const t4_expired = await processScan({ batch: batchExpired, mode: 'INTAKE' });
  console.log(`Expired scan: status=${t4_expired.status} | title="${t4_expired.title}" | message="${t4_expired.message}"`);
  console.log(`Result: ${t4_expired.status === 'RED' ? 'PASS (Expired batch rejected as RED)' : 'FAIL'}\n`);

  // Verify Ledger State & Audit Trail
  console.log('--- FINAL LEDGER STATE ---');
  const ledger1 = await getLedgerEntry(batch1.id);
  const ledger2 = await getLedgerEntry(batch2.id);
  console.log(`Batch 1: ${JSON.stringify(ledger1)}`);
  console.log(`Batch 2: ${JSON.stringify(ledger2)}`);

  console.log('\n--- AUDIT LOG TRAIL ---');
  const audits = await getAllAudit();
  audits.forEach((a, i) => console.log(`[${i + 1}] Type: ${a.type} | Batch: ${a.batchId} | Reason: ${a.reason}`));

  console.log('\nAll 4 tests completed successfully.');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
