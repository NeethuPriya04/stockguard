import { getAllLedger, getAllAudit } from './db.js';

export async function bridgeToOfficeKit() {
  const ledger = await getAllLedger();
  const audit = await getAllAudit();
  const report = formatReport({ ledger, audit, generatedAt: new Date().toISOString() });

  if (navigator.share) {
    try { await navigator.share({ title: 'StockGuard Audit', text: report }); return; }
    catch {}
  }
  try { await navigator.clipboard.writeText(report); alert('✓ Audit copied to clipboard'); return; }
  catch {}
  const blob = new Blob([report], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stockguard-audit-${Date.now()}.txt`;
  a.click();
}

function formatReport({ ledger, audit, generatedAt }) {
  const L = [];
  L.push('════════════════════════════════════════');
  L.push('  STOCKGUARD — AUDIT REPORT');
  L.push('  Generated: ' + generatedAt);
  L.push('════════════════════════════════════════');
  L.push('');
  L.push('SUMMARY');
  L.push('  Batches tracked:   ' + ledger.length);
  L.push('  Total scans:       ' + ledger.reduce((s, e) => s + e.scans, 0));
  L.push('  Red interceptions: ' + audit.filter(a => a.type === 'DUPLICATE_ALERT' || a.type === 'REJECTED_SCAN' || a.type === 'FORMAT_FAIL').length);
  L.push('');
  L.push('LEDGER');
  ledger.forEach(e => L.push(`  ${e.id} · intake=${e.intake} · sold=${e.sold} · scans=${e.scans}`));
  L.push('');
  L.push('AUDIT TRAIL');
  audit.slice(-20).reverse().forEach(a => L.push(`  [${new Date(a.ts).toLocaleTimeString()}] ${a.type} · ${a.batchId || '-'}`));
  L.push('');
  L.push('— END —');
  return L.join('\n');
}
