let tesseractLoaded = false;

async function loadTesseract() {
  if (tesseractLoaded) return;
  const { createWorker } = await import('tesseract.js');
  window.__tesseractCreateWorker = createWorker;
  tesseractLoaded = true;
}

function loadImageToCanvas(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// ============ Layout definitions ============

const COUNTER_KEYS = [
  'successful_logins',
  'failed_logins',
  'concurrent_apex_errors',
  'concurrent_ui_errors',
  'row_lock_errors',
  'total_callout_errors',
];

/**
 * Org Performance layout: 6 counter tiles in a horizontal row.
 * All coordinates are ratios (0-1) relative to image dimensions.
 *
 * Calibrated against: 2952x4648 sample (scale-center-sample.png)
 * Counter labels at ~8.5-9.5%, counter numbers at ~10.5-12.5%
 */
const ORG_PERF_LAYOUT = {
  // Vertical band: ONLY the large counter numbers, excluding labels above.
  // Numbers sit at y ≈ 11.3%-12.8% of image height (calibrated on 2952x4648 sample).
  numberRowTop: 0.113,
  numberRowBottom: 0.128,
  // Tile positions measured from actual number start positions.
  // Tile 0 number starts at x/w=2.2%, tiles are ~10.6% apart.
  // We place the left edge slightly before each number for tolerance.
  tileLeft: 0.018,
  tileRight: 0.654,
  tileCount: 6,
  // Within each tile, take the left 30% where the number sits.
  // Numbers are 1-4 digits (0, 2, 23, 1247), left-aligned.
  numberInTileStart: 0.0,
  numberInTileEnd: 0.3,
};

function getCounterTileBox(tileIndex, imgWidth, imgHeight) {
  const rowW = (ORG_PERF_LAYOUT.tileRight - ORG_PERF_LAYOUT.tileLeft) * imgWidth;
  const tileW = rowW / ORG_PERF_LAYOUT.tileCount;
  const tileLeftAbs = ORG_PERF_LAYOUT.tileLeft * imgWidth + tileIndex * tileW;

  const x = Math.round(tileLeftAbs + ORG_PERF_LAYOUT.numberInTileStart * tileW);
  const w = Math.round(
    (ORG_PERF_LAYOUT.numberInTileEnd - ORG_PERF_LAYOUT.numberInTileStart) * tileW
  );
  const y = Math.round(ORG_PERF_LAYOUT.numberRowTop * imgHeight);
  const h = Math.round(
    (ORG_PERF_LAYOUT.numberRowBottom - ORG_PERF_LAYOUT.numberRowTop) * imgHeight
  );

  return { x, y, w, h };
}

// ============ Layout detection ============

async function detectLayout(canvas, worker) {
  const hCanvas = document.createElement('canvas');
  hCanvas.width = canvas.width;
  hCanvas.height = Math.round(canvas.height * 0.05);
  hCanvas
    .getContext('2d')
    .drawImage(canvas, 0, 0, canvas.width, hCanvas.height, 0, 0, canvas.width, hCanvas.height);
  const { data } = await worker.recognize(hCanvas);
  const t = data.text.toLowerCase();
  if (t.includes('org performance') || t.includes('performance metrics')) return 'org-performance';
  if (t.includes('scale center')) return 'scale-center-legacy';
  return 'unknown';
}

// ============ Per-tile OCR ============

/**
 * Extract a single counter tile, preprocess it, and run OCR.
 * Returns { value: number|null, confidence: number, raw: string }
 */
function isDebugMode() {
  return (
    typeof localStorage !== 'undefined' && localStorage.getItem('orgpulse-ocr-debug') === 'true'
  );
}

async function ocrCounterTile(canvas, tileIndex, worker) {
  const box = getCounterTileBox(tileIndex, canvas.width, canvas.height);

  // Crop tile at 4x scale for maximum digit recognition accuracy
  const scale = 4;
  const tile = document.createElement('canvas');
  tile.width = box.w * scale;
  tile.height = box.h * scale;
  const ctx = tile.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, tile.width, tile.height);

  // Grayscale + strong contrast boost
  const id = ctx.getImageData(0, 0, tile.width, tile.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const v = gray < 128 ? Math.max(0, gray - 60) : Math.min(255, gray + 60);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);

  const result = await worker.recognize(tile);
  const raw = result.data.text.trim();
  const match = raw.match(/\d[\d,]*/);
  const value = match ? parseInt(match[0].replace(/,/g, ''), 10) : null;

  // Stash debug data
  if (isDebugMode()) {
    console.log(
      `[OrgPulse OCR] Tile ${tileIndex} (${COUNTER_KEYS[tileIndex]}): "${raw}" → ${value}`
    );
    window.__orgpulseOcrDebug = window.__orgpulseOcrDebug || [];
    window.__orgpulseOcrDebug.push({
      counterName: COUNTER_KEYS[tileIndex],
      box,
      preprocessedImage: tile.toDataURL('image/png'),
      rawText: raw,
      confidence: result.data.confidence,
      parsedValue: value,
      words: result.data.words,
    });

    console.group(`[OCR Debug] ${COUNTER_KEYS[tileIndex]}`);
    console.log('Box:', box);
    console.log('Raw text:', JSON.stringify(raw));
    console.log('Confidence:', result.data.confidence);
    console.log('Parsed value:', value);
    console.log('Words:', result.data.words);
    console.groupEnd();
  }

  return { value, confidence: result.data.confidence, raw };
}

// ============ Debug overlay ============

function drawDebugOverlay(canvas) {
  if (typeof localStorage === 'undefined' || localStorage.getItem('orgpulse-ocr-debug') !== 'true')
    return;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'magenta';
  ctx.lineWidth = 3;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'magenta';
  for (let i = 0; i < 6; i++) {
    const box = getCounterTileBox(i, canvas.width, canvas.height);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillText(COUNTER_KEYS[i], box.x + 4, box.y - 4);
  }
}

// ============ Certainty assessment ============

function assessOcrCertainty(counters, avgConfidence, layout) {
  if (layout === 'unknown') return { certain: false, reason: 'unknown-layout' };
  const allNull = Object.values(counters).every((v) => v === null);
  if (allNull) return { certain: false, reason: 'no-counters-extracted' };
  const allZeroOrNull = Object.values(counters).every((v) => v === null || v === 0);
  if (allZeroOrNull && avgConfidence < 0.7)
    return { certain: false, reason: 'low-confidence-zeros' };
  return { certain: true };
}

// ============ Main entry point ============

export async function analyzeWithOCR(imageFile, onProgress = () => {}) {
  onProgress(0.05, 'Loading OCR engine...');
  await loadTesseract();

  onProgress(0.1, 'Preparing image...');
  const canvas = await loadImageToCanvas(imageFile);

  const createWorker = window.__tesseractCreateWorker;
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(0.15 + m.progress * 0.3, 'Recognizing text...');
      }
    },
  });

  onProgress(0.15, 'Detecting layout...');
  const layout = await detectLayout(canvas, worker);
  if (isDebugMode()) {
    console.log('[OrgPulse OCR] Layout detected:', layout);
  }

  const counters = {};
  let totalConfidence = 0;
  const rawParts = [];

  // Clear previous debug data
  if (isDebugMode()) {
    window.__orgpulseOcrDebug = [];
    window.__orgpulseOcrSourceCanvas = canvas;
  }

  if (layout === 'org-performance') {
    drawDebugOverlay(canvas);

    // Per-tile OCR: extract each counter individually
    for (let i = 0; i < 6; i++) {
      onProgress(0.3 + (i / 6) * 0.5, `Reading counter ${i + 1}/6...`);
      const result = await ocrCounterTile(canvas, i, worker);
      counters[COUNTER_KEYS[i]] = result.value !== null ? result.value : 0;
      totalConfidence += result.confidence;
      rawParts.push(`${COUNTER_KEYS[i]}: "${result.raw}" → ${result.value}`);
    }
  } else {
    // Fallback: full-region OCR with label matching (legacy approach)
    onProgress(0.3, 'Reading counters...');
    const cropTop = layout === 'scale-center-legacy' ? 0.05 : 0.05;
    const cropBot = layout === 'scale-center-legacy' ? 0.15 : 0.2;
    const y = Math.round(canvas.height * cropTop);
    const h = Math.round(canvas.height * (cropBot - cropTop));
    const region = document.createElement('canvas');
    region.width = canvas.width * 2;
    region.height = h * 2;
    const rctx = region.getContext('2d');
    rctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, region.width, region.height);

    const { data } = await worker.recognize(region);
    rawParts.push(data.text);
    totalConfidence = data.confidence;

    // Label-based regex parsing
    const patterns = [
      { key: 'successful_logins', regex: /successful\s*logins?\s*[^\d]*(\d[\d,]*)/i },
      { key: 'failed_logins', regex: /failed\s*logins?\s*[^\d]*(\d[\d,]*)/i },
      { key: 'concurrent_apex_errors', regex: /concurrent\s*apex\s*errors?\s*[^\d]*(\d[\d,]*)/i },
      {
        key: 'concurrent_ui_errors',
        regex: /concurrent\s*(?:ui|u\.?i\.?)\s*errors?\s*[^\d]*(\d[\d,]*)/i,
      },
      { key: 'row_lock_errors', regex: /row\s*lock\s*errors?\s*[^\d]*(\d[\d,]*)/i },
      { key: 'total_callout_errors', regex: /(?:total\s*)?callout\s*errors?\s*[^\d]*(\d[\d,]*)/i },
    ];
    const fullText = data.text.toLowerCase();
    for (const k of COUNTER_KEYS) counters[k] = null;
    for (const { key, regex } of patterns) {
      const m = fullText.match(regex);
      if (m) counters[key] = parseInt(m[1].replace(/,/g, ''), 10);
    }
    // Fill remaining nulls with null for unknown layout, 0 for known
    for (const k of COUNTER_KEYS) {
      if (counters[k] === null) counters[k] = layout !== 'unknown' ? 0 : null;
    }
  }

  await worker.terminate();

  const avgConfidence =
    Math.round(layout === 'org-performance' ? totalConfidence / 6 : totalConfidence) / 100;
  const certainty = assessOcrCertainty(counters, avgConfidence, layout);

  onProgress(1, 'Complete');

  return {
    mode: 'basic',
    counters,
    raw_text: rawParts.join('\n'),
    confidence: avgConfidence,
    layout,
    ocrCertain: certainty.certain,
    ocrUncertainReason: certainty.reason || null,
    timestamp: new Date().toISOString(),
  };
}
