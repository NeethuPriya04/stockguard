// src/engine.js
// Deterministic on-device verification and ledger state machine for StockGuard

import { getLedgerEntry, setLedgerEntry, appendAuditLog } from './db.js';

export const BRAND_PATTERNS = {
  'PARLE-G': /^PARLE-G-\d{4}-M\d{2}-B\d{3}$/i,
  'TATA-SALT': /^TATA-SLT-\d{4}-\d{4}$/i,
  'AMUL-BTR': /^AMUL-\d{2}[A-Z]\d{4}$/i,
  'DEFAULT': /^[A-Z0-9\-]{6,40}$/i,
};

export const SHELF_LIFE = {
  biscuit: 6,
  dairy: 6,
  soap: 24,
  staples: 12,
  default: 18,
};

/**
 * Validates batch metadata using deterministic rules without cloud calls or checksums.
 * @param {Object} batch - { id, brand, mfg, exp, category }
 * @returns {{ checks: Object, allPass: boolean, reason?: string }}
 */
export function validateBatch(batch) {
  if (!batch || !batch.id) {
    return {
      checks: {
        formatMatch: false,
        mfgBeforeExp: false,
        expInFuture: false,
        shelfLifePlausible: false,
      },
      allPass: false,
      reason: 'Batch ID is missing or empty.',
    };
  }

  // 1. Format plausibility (per-brand regex)
  const brandKey = batch.brand ? batch.brand.toUpperCase() : '';
  const regex = BRAND_PATTERNS[brandKey] || BRAND_PATTERNS['DEFAULT'];
  const formatMatch = Boolean(regex.test(batch.id));

  // Date parsing
  const mfgDate = new Date(batch.mfg);
  const expDate = new Date(batch.exp);
  const now = new Date();

  const isValidMfg = !isNaN(mfgDate.getTime());
  const isValidExp = !isNaN(expDate.getTime());

  // 2. Date coherence (MFG < EXP)
  const mfgBeforeExp = isValidMfg && isValidExp && mfgDate < expDate;

  // 3. Expiry in future (EXP > today)
  const expInFuture = isValidExp && expDate > now;

  // 4. Shelf-life plausibility (per category)
  // Expected months: Plausible = months > 0 AND months <= expected * 2
  let shelfLifePlausible = false;
  if (isValidMfg && isValidExp) {
    const diffTimeMs = expDate.getTime() - mfgDate.getTime();
    const months = diffTimeMs / (1000 * 60 * 60 * 24 * 30.4375);
    const catKey = batch.category ? batch.category.toLowerCase() : 'default';
    const expectedMonths = SHELF_LIFE[catKey] ?? SHELF_LIFE.default;
    shelfLifePlausible = months > 0 && months <= expectedMonths * 2;
  }

  const checks = {
    formatMatch,
    mfgBeforeExp,
    expInFuture,
    shelfLifePlausible,
  };

  const allPass = Boolean(formatMatch && mfgBeforeExp && expInFuture && shelfLifePlausible);

  let reason = '';
  if (!formatMatch) {
    reason = 'Format plausibility check failed: ID pattern does not match registered brand format.';
  } else if (!mfgBeforeExp) {
    reason = 'Date coherence failed: Manufacturing date must be earlier than expiry date.';
  } else if (!expInFuture) {
    reason = `Date coherence failed: Batch expired on ${batch.exp}. Cannot accept or sell expired stock.`;
  } else if (!shelfLifePlausible) {
    reason = 'Shelf-life plausibility failed: Duration between MFG and EXP is invalid or exceeds category limits.';
  }

  return {
    checks,
    allPass,
    reason,
  };
}

/**
 * Processes a scan against the deterministic rule engine and auto-ledger.
 * @param {{ batch: Object, mode: 'INTAKE'|'SALE' }} params
 * @returns {Promise<{ status: 'GREEN'|'RED'|'AMBER', title: string, message: string }>}
 */
export async function processScan(payload, maybeMode) {
  console.log('>>> processScan received:', JSON.stringify(payload, null, 2));
  const batch = payload?.batch ? payload.batch : payload;
  const mode = payload?.mode ? payload.mode : maybeMode;

  const validation = validateBatch(batch);
  if (!validation.allPass) {
    await appendAuditLog({
      type: 'REJECTED_SCAN',
      batchId: batch?.id || 'UNKNOWN',
      reason: validation.reason,
    });
    return {
      status: 'RED',
      title: !validation.checks.expInFuture ? 'EXPIRED BATCH DETECTED' : 'VALIDATION REJECTED',
      message: validation.reason,
    };
  }

  // Step 2: Load or initialize ledger entry
  let entry = await getLedgerEntry(batch.id);
  if (!entry) {
    entry = {
      id: batch.id,
      brand: batch.brand || 'UNKNOWN',
      intake: 0,
      sold: 0,
      scans: 0,
      firstSeen: Date.now(),
    };
  }

  // Increment total scans
  entry.scans += 1;

  // Step 3: Handle INTAKE mode
  if (mode === 'INTAKE') {
    entry.intake += 1;
    await setLedgerEntry(entry);
    await appendAuditLog({
      type: 'INTAKE',
      batchId: batch.id,
      reason: `Intake recorded (Total intake: ${entry.intake}, in stock: ${entry.intake - entry.sold})`,
    });
    return {
      status: 'GREEN',
      title: 'INTAKE RECORDED',
      message: `Batch ${batch.id} intake logged. Total inventory: ${entry.intake - entry.sold} unit(s).`,
    };
  }

  // Step 4: Handle SALE mode
  if (mode === 'SALE') {
    if (entry.sold + 1 > entry.intake) {
      await appendAuditLog({
        type: 'DUPLICATE_ALERT',
        batchId: batch.id,
        reason: `Over-sale duplicate alert: attempted sale ${entry.sold + 1} of ${entry.intake} intake units`,
      });
      return {
        status: 'RED',
        title: 'DUPLICATE BATCH DETECTED',
        message: `Already sold ${entry.sold} of ${entry.intake} intake units. Selling again implies a counterfeit duplicate in circulation. Estimated loss if returned: ₹40.`,
      };
    }

    entry.sold += 1;
    await setLedgerEntry(entry);
    await appendAuditLog({
      type: 'SALE',
      batchId: batch.id,
      reason: `Sale recorded (Sold: ${entry.sold} of ${entry.intake})`,
    });
    return {
      status: 'GREEN',
      title: 'SALE RECORDED',
      message: `Sale recorded for batch ${batch.id}. Remaining stock: ${entry.intake - entry.sold} unit(s).`,
    };
  }

  return {
    status: 'AMBER',
    title: 'UNKNOWN MODE',
    message: `Mode "${mode}" is not recognized. Please select INTAKE or SALE.`,
  };
}
