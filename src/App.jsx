import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';
import { processScan } from './engine.js';
import { getLedgerEntry, setLedgerEntry, appendAuditLog, clearAll, resetBatch } from './db.js';
import { bridgeToOfficeKit } from './bridge.js';

const DEMO_SCENARIOS = {
  legitIntake: async () => {
    // self-contained: fresh batch, just intake
    await resetBatch('PARLE-G-2026-M04-B001');
    return { batch: { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" }, mode: "INTAKE" };
  },
  legitSale: async () => {
    // setup: do an intake first, THEN the sale
    await resetBatch('PARLE-G-2026-M04-B001');
    await processScan({ batch: { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" }, mode: "INTAKE" });
    return { batch: { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" }, mode: "SALE" };
  },
  duplicateSale: async () => {
    // setup: do intake + sale first, THEN the duplicate sale
    await resetBatch('PARLE-G-2026-M04-B001');
    const batch = { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" };
    await processScan({ batch, mode: "INTAKE" });
    await processScan({ batch, mode: "SALE" });
    return { batch, mode: "SALE" };
  },
  expiredBatch: async () => {
    // self-contained: expired batch
    await resetBatch('TATA-SLT-2024-0091');
    return { batch: { id: "TATA-SLT-2024-0091", brand: "TATA-SALT", mfg: "2024-01-01", exp: "2025-01-01", category: "staples" }, mode: "INTAKE" };
  }
};

export default function App() {
  const [mode, setMode] = useState('INTAKE'); // 'INTAKE' or 'SALE'
  const [cameraError, setCameraError] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('INITIALIZING…');
  const [alertInfo, setAlertInfo] = useState(null);
  const [scansToday, setScansToday] = useState(0);
  const [flashReticle, setFlashReticle] = useState(false);

  const videoRef = useRef(null);
  const modeRef = useRef(mode);
  const lastScanRef = useRef({ code: '', time: 0 });
  const isPausedRef = useRef(false);
  const lastVoiceTimestamp = useRef(0);
  const scannerPaused = useRef(false);
  const scanning = useRef(false);

  // Keep modeRef synchronized with current mode for camera callbacks
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Pause camera scanning when an alert is active to improve performance
  useEffect(() => {
    isPausedRef.current = Boolean(alertInfo);
  }, [alertInfo]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Web Speech API helper for RED alerts
  const speakAlert = (title, message) => {
    const now = Date.now();
    if (now - lastVoiceTimestamp.current < 3000) return;
    lastVoiceTimestamp.current = now;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${title}. ${message}`);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.lang = 'en-IN';

    const voices = window.speechSynthesis.getVoices();

    // Prefer clear Google English voices, in order of preference
    const preferred =
      voices.find(v => v.name === 'Google UK English Female') ||
      voices.find(v => v.name === 'Google UK English Male') ||
      voices.find(v => v.name === 'Google US English') ||
      voices.find(v => v.name === 'Google हिन्दी') ||   // Google Hindi if available
      voices.find(v => v.lang === 'en-IN') ||
      voices.find(v => v.lang === 'en-GB') ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;

    if (preferred) u.voice = preferred;

    window.speechSynthesis.speak(u);
  };

  // Decode handling routine (JSON batch or plain string ID)
  const handleDecoded = async (raw) => {
    // Flash reticle border green briefly for visual feedback
    setFlashReticle(true);
    setTimeout(() => setFlashReticle(false), 450);

    const currentMode = modeRef.current;
    let parsed = null;
    try {
      const json = JSON.parse(raw);
      if (json && typeof json === 'object' && json.id) {
        parsed = json;
      }
    } catch {
      parsed = null;
    }

    try {
      if (parsed) {
        // Structured JSON batch payload
        const result = await processScan({ batch: parsed, mode: currentMode });
        setAlertInfo(result);
        setScansToday((prev) => prev + 1);

        console.log('VIBRATE CALLED', result.status);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          if (result.status === 'GREEN') navigator.vibrate(80);
          else if (result.status === 'RED') navigator.vibrate([300, 100, 300, 100, 500]);
          else navigator.vibrate([120, 60, 120]);
        }

        if (result.status === 'RED') {
          speakAlert(result.title, result.message);
        }
      } else {
        // Plain string batch ID fallback
        let entry = await getLedgerEntry(raw);
        if (!entry) {
          entry = {
            id: raw,
            brand: 'GENERIC',
            intake: 0,
            sold: 0,
            scans: 0,
            firstSeen: Date.now(),
          };
        }

        entry.scans += 1;

        if (currentMode === 'SALE' && entry.sold + 1 > entry.intake) {
          await appendAuditLog({
            type: 'DUPLICATE_ALERT',
            batchId: raw,
            reason: `Over-sale duplicate alert: attempted sale ${entry.sold + 1} of ${entry.intake} intake units`,
          });

          const redResult = {
            status: 'RED',
            title: 'DUPLICATE BATCH DETECTED',
            message: `Already sold ${entry.sold} of ${entry.intake} intake units. Selling again implies a counterfeit duplicate in circulation. Estimated loss if returned: ₹40.`,
          };

          setAlertInfo(redResult);
          setScansToday((prev) => prev + 1);

          console.log('VIBRATE CALLED', 'RED');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([300, 100, 300, 100, 500]);
          }
          speakAlert(redResult.title, redResult.message);
        } else {
          if (currentMode === 'INTAKE') {
            entry.intake += 1;
            await setLedgerEntry(entry);
            await appendAuditLog({
              type: 'INTAKE',
              batchId: raw,
              reason: `Intake recorded for plain ID ${raw}`,
            });

            const greenResult = {
              status: 'GREEN',
              title: 'INTAKE RECORDED',
              message: `Batch ${raw} intake logged. Total inventory: ${entry.intake - entry.sold} unit(s).`,
            };

            setAlertInfo(greenResult);
            setScansToday((prev) => prev + 1);

            console.log('VIBRATE CALLED', 'GREEN');
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(80);
            }
          } else {
            entry.sold += 1;
            await setLedgerEntry(entry);
            await appendAuditLog({
              type: 'SALE',
              batchId: raw,
              reason: `Sale recorded for plain ID ${raw}`,
            });

            const greenResult = {
              status: 'GREEN',
              title: 'SALE RECORDED',
              message: `Sale recorded for batch ${raw}. Remaining stock: ${entry.intake - entry.sold} unit(s).`,
            };

            setAlertInfo(greenResult);
            setScansToday((prev) => prev + 1);

            console.log('VIBRATE CALLED', 'GREEN');
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(80);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error handling decoded barcode:', err);
    }
  };

  // Camera stream and Barcode Detector loop initialization
  useEffect(() => {
    let active = true;
    let stream = null;
    let animationFrameId = null;
    let zxingReader = null;

    const DEBOUNCE_MS = 2000;
    const isDebounced = (code) => {
      const now = Date.now();
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.time < DEBOUNCE_MS
      ) {
        return true;
      }
      lastScanRef.current = { code, time: now };
      return false;
    };

    async function startCameraAndScanner() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera API unavailable');
        }

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
          });
        } catch (envErr) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
        }

        if (!active) {
          if (stream) stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraError(false);

          // Wait until video has loaded metadata and can play
          await new Promise((resolve) => {
            if (videoRef.current.readyState >= 2) {
              resolve();
            } else {
              videoRef.current.onloadedmetadata = () => resolve();
            }
          });

          // Check if BarcodeDetector is supported natively in window
          if ('BarcodeDetector' in window) {
            try {
              const detector = new window.BarcodeDetector({
                formats: ['qr_code', 'ean_13', 'code_128'],
              });
              setScannerStatus('SCANNING…');

              let isDetecting = false;

              const tick = async () => {
                if (scannerPaused.current) {
                  requestAnimationFrame(tick);
                  return;
                }
                if (!active) return;

                if (
                  videoRef.current &&
                  videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
                ) {
                  if (!isDetecting) {
                    isDetecting = true;
                    try {
                      const codes = await detector.detect(videoRef.current);
                      if (codes && codes.length > 0) {
                        const rawValue = codes[0].rawValue;
                        if (rawValue && !isDebounced(rawValue)) {
                          handleDecoded(rawValue);
                        }
                      }
                    } catch (detErr) {
                      // Silently skip transient detection frame errors
                    } finally {
                      isDetecting = false;
                    }
                  }
                }
                animationFrameId = requestAnimationFrame(tick);
              };

              animationFrameId = requestAnimationFrame(tick);
              return;
            } catch (detectorErr) {
              console.warn('BarcodeDetector creation failed, using ZXing fallback:', detectorErr);
            }
          }

          // Fallback to @zxing/library
          try {
            setScannerStatus('SCANNING (ZXing)…');
            zxingReader = new BrowserMultiFormatReader();

            zxingReader.decodeFromVideoElement(videoRef.current, (result, err) => {
              if (!active) return;
              if (result) {
                const text = result.getText();
                if (text && !isDebounced(text)) {
                  handleDecoded(text);
                }
              }
            });
          } catch (zxingErr) {
            console.error('ZXing decoder failed:', zxingErr);
            setScannerStatus('BARCODE API MISSING');
          }
        }
      } catch (err) {
        console.warn('Camera failed to start:', err);
        if (active) {
          setCameraError(true);
          setScannerStatus('CAMERA UNAVAILABLE');
        }
      }
    }

    startCameraAndScanner();

    return () => {
      active = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      if (zxingReader) {
        try {
          zxingReader.reset();
        } catch {
          // ignore
        }
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Demo scan handler executing within user tap gesture context
  const DEMO_SCENARIOS = {
  legitIntake: async () => {
    const batch = { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" };
    await resetBatch(batch.id);
    return { batch, mode: "INTAKE" };
  },
  legitSale: async () => {
    const batch = { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" };
    await resetBatch(batch.id);
    await processScan({ batch, mode: "INTAKE" });
    return { batch, mode: "SALE" };
  },
  duplicateSale: async () => {
    const batch = { id: "PARLE-G-2026-M04-B001", brand: "PARLE-G", mfg: "2026-06-01", exp: "2026-12-01", category: "biscuit" };
    await resetBatch(batch.id);
    await processScan({ batch, mode: "INTAKE" });
    await processScan({ batch, mode: "SALE" });
    return { batch, mode: "SALE" };
  },
  expiredBatch: async () => {
    const batch = { id: "TATA-SLT-2024-0091", brand: "TATA-SALT", mfg: "2024-01-01", exp: "2025-01-01", category: "staples" };
    await resetBatch(batch.id);
    return { batch, mode: "INTAKE" };
  }
};

const handleDemoScan = async (scenarioKey) => {
  if (scanning.current) return;
  scanning.current = true;
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  try {
    const scenario = DEMO_SCENARIOS[scenarioKey];
    if (!scenario) return;

    try {
      const payload = await scenario();
      if (payload.mode) setMode(payload.mode);
      const result = await processScan(payload);
      setAlertInfo(result);
      scannerPaused.current = true;
      setTimeout(() => { scannerPaused.current = false; }, 3000);
      setScansToday((prev) => prev + 1);

      console.log('VIBRATE CALLED', result.status);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        if (result.status === 'GREEN') navigator.vibrate(80);
        else if (result.status === 'RED') navigator.vibrate([300, 100, 300, 100, 500]);
        else navigator.vibrate([120, 60, 120]);
      }
      if (result.status === 'RED') speakAlert(result.title, result.message);
    } catch (err) {
      console.error('Scan execution error:', err);
    }
  } finally {
    scanning.current = false;
  }
};
  // Reset all data handler
  const handleResetAll = async () => {
    try {
      await clearAll();
      setAlertInfo(null);
      setScansToday(0);
      lastScanRef.current = { code: '', time: 0 };
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (err) {
      console.error('Failed to reset data:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col items-center justify-start p-4 selection:bg-[#10b981]/30">
      <div className="w-full max-w-[480px] flex flex-col gap-4 pb-6">
        
        {/* 1. Header */}
        <header className="flex items-center justify-between pt-2 pb-1 border-b border-neutral-800/80">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10b981]"></span>
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
              StockGuard
            </h1>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-mono tracking-wider text-[#10b981]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
            EDGE · OFFLINE
          </div>
        </header>

        {/* 2. Camera Viewfinder */}
        <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-800/80 shadow-2xl flex items-center justify-center">
          {!cameraError ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="p-6 text-center flex flex-col items-center gap-2 text-neutral-400">
              <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-1">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3l18 18" />
                </svg>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Camera Unavailable
              </p>
              <p className="text-xs text-neutral-500 max-w-[220px]">
                Please allow camera access or use demo buttons below
              </p>
            </div>
          )}

          {/* Viewfinder Reticle Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8">
            <div
              className={`relative w-full h-full max-w-[260px] max-h-[260px] rounded-2xl flex flex-col items-center justify-end pb-3 transition-all duration-300 ${
                flashReticle
                  ? 'border-2 border-[#10b981] bg-[#10b981]/25 shadow-[0_0_40px_rgba(16,185,129,0.8)] scale-105'
                  : 'border-2 border-dashed border-[#10b981] shadow-[0_0_25px_rgba(16,185,129,0.15)]'
              }`}
            >
              {/* Corner accents */}
              <div className="absolute top-0 left-0 -mt-1 -ml-1 w-4 h-4 border-t-2 border-l-2 border-[#10b981] rounded-tl"></div>
              <div className="absolute top-0 right-0 -mt-1 -mr-1 w-4 h-4 border-t-2 border-r-2 border-[#10b981] rounded-tr"></div>
              <div className="absolute bottom-0 left-0 -mb-1 -ml-1 w-4 h-4 border-b-2 border-l-2 border-[#10b981] rounded-bl"></div>
              <div className="absolute bottom-0 right-0 -mb-1 -mr-1 w-4 h-4 border-b-2 border-r-2 border-[#10b981] rounded-br"></div>
              
              <span className="bg-black/75 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] font-mono tracking-widest text-[#10b981] font-semibold uppercase border border-[#10b981]/30">
                {cameraError ? 'CAMERA UNAVAILABLE' : scannerStatus}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Mode Toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-900/90 border border-neutral-800 rounded-xl">
          <button
            type="button"
            onClick={() => setMode('INTAKE')}
            className={`py-2.5 px-4 rounded-lg font-bold text-sm tracking-wide transition-all ${
              mode === 'INTAKE'
                ? 'bg-[#10b981] text-neutral-950 shadow-md shadow-[#10b981]/20'
                : 'bg-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            INTAKE
          </button>
          <button
            type="button"
            onClick={() => setMode('SALE')}
            className={`py-2.5 px-4 rounded-lg font-bold text-sm tracking-wide transition-all ${
              mode === 'SALE'
                ? 'bg-[#10b981] text-neutral-950 shadow-md shadow-[#10b981]/20'
                : 'bg-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            SALE
          </button>
        </div>

        {/* 4. Alert Box */}
        <div className="min-h-[76px] flex items-center justify-center">
          {alertInfo ? (
            <div
              style={{
                backgroundColor:
                  alertInfo.status === 'GREEN'
                    ? 'rgba(6,78,59,0.85)'
                    : alertInfo.status === 'RED'
                    ? 'rgba(127,29,29,0.9)'
                    : 'rgba(120,53,15,0.85)',
                borderColor:
                  alertInfo.status === 'GREEN'
                    ? '#10b981'
                    : alertInfo.status === 'RED'
                    ? '#ef4444'
                    : '#f59e0b',
              }}
              className={`w-full p-4 rounded-xl border text-white shadow-lg transition-all ${
                alertInfo.status === 'RED' ? 'animate-pulse' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="text-lg leading-none mt-0.5 font-bold">
                  {alertInfo.status === 'GREEN' && '✓'}
                  {alertInfo.status === 'RED' && '⚠'}
                  {alertInfo.status === 'AMBER' && '●'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider">
                    {alertInfo.title}
                  </div>
                  <div className="text-xs font-medium text-neutral-100 mt-1 leading-relaxed">
                    {alertInfo.message}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full py-4 text-center rounded-xl border border-dashed border-neutral-800 text-neutral-600 text-xs italic">
              Ready to scan — align barcode or tap demo below
            </div>
          )}
        </div>

        {/* 5. Demo Buttons & Reset Data */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase">
              Demo Simulator
            </span>
            <button
              type="button"
              onClick={handleResetAll}
              className="text-[11px] font-medium text-neutral-400 hover:text-red-400 bg-neutral-900/60 hover:bg-red-950/30 border border-neutral-800 hover:border-red-900/50 rounded-md px-2 py-0.5 transition"
            >
              Reset all data
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDemoScan('legitIntake')}
              className="py-2.5 px-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-emerald-800 text-neutral-200 text-xs font-medium text-left transition active:scale-[0.98] flex items-center justify-between"
            >
              <span>Demo: Legit intake</span>
              <span className="text-[10px] font-mono text-emerald-400">INTAKE</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoScan('legitSale')}
              className="py-2.5 px-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-blue-800 text-neutral-200 text-xs font-medium text-left transition active:scale-[0.98] flex items-center justify-between"
            >
              <span>Demo: Legit sale</span>
              <span className="text-[10px] font-mono text-blue-400">SALE</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoScan('duplicateSale')}
              className="py-2.5 px-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-red-900/50 text-neutral-200 text-xs font-medium text-left transition active:scale-[0.98] flex items-center justify-between"
            >
              <span>Demo: Duplicate (RED)</span>
              <span className="text-[10px] font-mono text-red-400">SALE</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoScan('expiredBatch')}
              className="py-2.5 px-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-amber-900/50 text-neutral-200 text-xs font-medium text-left transition active:scale-[0.98] flex items-center justify-between"
            >
              <span>Demo: Expired batch</span>
              <span className="text-[10px] font-mono text-amber-400">INTAKE</span>
            </button>
          </div>
        </div>

        {/* 6. Bridge to Office Kit Dashboard Button */}
        <button
          type="button"
          onClick={() => bridgeToOfficeKit()}
          className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm tracking-wide shadow-lg shadow-blue-600/25 transition-all text-center flex items-center justify-center gap-2"
        >
          <span>Bridge to Office Kit Dashboard</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>

        {/* 7. Footer */}
        <footer className="pt-2 border-t border-neutral-900 flex items-center justify-between text-xs text-neutral-500 font-mono">
          <span>Scans today: {scansToday}</span>
          <Link
            to="/dashboard"
            className="text-neutral-400 hover:text-white transition flex items-center gap-1 font-sans"
          >
            open dashboard →
          </Link>
        </footer>

      </div>
    </div>
  );
}
