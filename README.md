# 🛡️ StockGuard

**On-Device Counterfeit & Duplicate-Batch Detection for Kirana Retail**

[![Live Demo](https://img.shields.io/badge/Live_Demo-stockguard--xi.vercel.app-10b981?style=for-the-badge)](https://stockguard-xi.vercel.app)
[![Track](https://img.shields.io/badge/iQOO_Hackathon_2026-FinTech_%26_Commerce-blue?style=for-the-badge)]()

## 📌 The Problem
Kirana and small retail shops in India unknowingly restock and resell counterfeit or duplicate-batch products. When a customer returns a fake, the shopkeeper eats the loss — not the distributor, not the brand. 
Counterfeit FMCG costs Indian retail over ₹1.2 lakh crore annually. 13 million kirana shops have zero verification tools because existing verify apps require manufacturer cooperation, and enterprise SaaS is priced for retail chains.

## 💡 The Solution
**StockGuard** is an on-device counterfeit detector that runs entirely in the phone's browser. 
* **Zero setup.** 
* **Zero subscription.** 
* **Zero manufacturer cooperation.** 

It works on the phone the shopkeeper already owns, requiring no app install or IT staff. 

## ⚙️ How It Works
1. **Scan:** The shopkeeper scans a product's QR or barcode at billing.
2. **Decode:** On-device decode via `BarcodeDetector` API (with a `ZXing` fallback for older devices).
3. **Verify:** A deterministic rule engine runs four instant checks:
   * **Format plausibility:** Matches batch ID against per-brand regex patterns.
   * **Date coherence:** Ensures MFG < EXP, and EXP is in the future.
   * **Shelf-life plausibility:** Validates dates against category norms (e.g., biscuits expire in 6 months, not 4 years).
   * **Auto-ledger diff:** Has this exact batch been scanned more times than it was purchased?
4. **Alert:** Displays a **Green** (safe) or **Red** (duplicate/expired) alert in under 1 second, accompanied by native haptic feedback and voice warnings.

## 🧠 The Novelty & Anti-Hallucination Architecture
Existing verify apps check one code against the manufacturer's database in isolation. **StockGuard cross-checks against the retailer's OWN scan history.**

* **Self-Populating Ledger:** No manual data entry. First scan = intake, repeat scan = sale, over-sale = RED duplicate alert.
* **Deterministic Safety:** Perception (barcode decode) is cleanly separated from decision logic. There are **no LLMs in the safety decision path**. The green/red outcome is pure JavaScript that any judge or auditor can whiteboard-verify. 
* **Privacy First:** No cloud calls. No hallucinations. No data leaks.

## 📱 Phone-Native Features
* **Camera Scanning:** `getUserMedia` with `facingMode: environment`.
* **Haptic Alerts:** Distinct vibration patterns for green (short) vs red (long/pulsing).
* **Voice Warnings:** Native `Web Speech API` integration for hands-free alerts.
* **Fully Offline:** Progressive Web App (PWA) architecture; works without network after the first load.
* **On-Device Storage:** `IndexedDB` ensures all ledger data stays strictly on the shopkeeper's phone.

## 🖥️ Office Kit Integration
Every scan streams to a laptop-based reconciliation dashboard via iQOO Office Kit screen mirror. The audit report exports to the back-office via Web Share API, clipboard, or file transfer, bridging the gap between the counter phone and the back-office PC.

## 🛠️ Tech Stack
* **Frontend:** React (Vite)
* **Styling:** Tailwind CSS v4
* **Database:** IndexedDB (local browser storage)
* **Scanner:** `BarcodeDetector` API / `@zxing/library`
* **Audio/Haptics:** Web Speech API / `navigator.vibrate`
* **Deployment:** Vercel

## 🚀 Run Locally

```bash
# Clone the repository
git clone https://github.com/NeethuPriya04/stockguard.git

# Navigate into the directory
cd stockguard

# Install dependencies
npm install

# Start the development server
npm run dev
