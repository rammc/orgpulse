let tesseractLoaded = false;

async function loadTesseract() {
  if (tesseractLoaded) return;
  const { createWorker } = await import('tesseract.js');
  window.__tesseractCreateWorker = createWorker;
  tesseractLoaded = true;
}

/**
 * Load an image File into a canvas element.
 */
function loadImageToCanvas(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
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

/**
 * Detect the screenshot layout by OCR-ing the header area.
 */
async function detectLayout(canvas, worker) {
  const headerCanvas = document.createElement('canvas');
  headerCanvas.width = canvas.width;
  headerCanvas.height = Math.round(canvas.height * 0.04);
  const ctx = headerCanvas.getContext('2d');
  ctx.drawImage(
    canvas,
    0,
    0,
    canvas.width,
    headerCanvas.height,
    0,
    0,
    canvas.width,
    headerCanvas.height
  );

  const { data } = await worker.recognize(headerCanvas);
  const text = data.text.toLowerCase();

  if (text.includes('org performance') || text.includes('performance metrics')) {
    return 'org-performance';
  }
  if (text.includes('scale center')) {
    return 'scale-center-legacy';
  }
  return 'unknown';
}

/**
 * Extract and preprocess the counter region from the screenshot.
 * The Org Performance layout places 6 counters in a horizontal row
 * at roughly 7-14% from the top of the image.
 */
function extractCounterRegion(canvas, layout) {
  const regions = {
    'org-performance': { top: 0.07, bottom: 0.14 },
    'scale-center-legacy': { top: 0.05, bottom: 0.15 },
    unknown: { top: 0.05, bottom: 0.2 },
  };

  const region = regions[layout] || regions.unknown;
  const y = Math.round(canvas.height * region.top);
  const h = Math.round(canvas.height * (region.bottom - region.top));

  // Extract region at 2x scale for better OCR accuracy
  const scale = 2;
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = canvas.width * scale;
  regionCanvas.height = h * scale;
  const ctx = regionCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, regionCanvas.width, regionCanvas.height);

  // Grayscale + contrast boost
  const imageData = ctx.getImageData(0, 0, regionCanvas.width, regionCanvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const boosted = gray < 128 ? Math.max(0, gray - 30) : Math.min(255, gray + 30);
    d[i] = d[i + 1] = d[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  // Debug overlay
  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('orgpulse-ocr-debug') === 'true'
  ) {
    const dbgCtx = canvas.getContext('2d');
    dbgCtx.strokeStyle = 'magenta';
    dbgCtx.lineWidth = 3;
    dbgCtx.strokeRect(0, y, canvas.width, h);
    dbgCtx.fillStyle = 'magenta';
    dbgCtx.font = '14px sans-serif';
    dbgCtx.fillText(`Counter region: ${region.top * 100}%-${region.bottom * 100}%`, 10, y + 16);
  }

  return regionCanvas;
}

/**
 * Parse counter values from OCR text using label-based regex matching.
 */
function parseCounters(text) {
  const counters = {
    successful_logins: null,
    failed_logins: null,
    concurrent_apex_errors: null,
    concurrent_ui_errors: null,
    row_lock_errors: null,
    total_callout_errors: null,
  };

  const patterns = [
    { key: 'successful_logins', regex: /successful\s*logins?\s*[^\d]*(\d[\d,]*)/i },
    { key: 'failed_logins', regex: /failed\s*logins?\s*[^\d]*(\d[\d,]*)/i },
    {
      key: 'concurrent_apex_errors',
      regex: /concurrent\s*apex\s*errors?\s*[^\d]*(\d[\d,]*)/i,
    },
    {
      key: 'concurrent_ui_errors',
      regex: /concurrent\s*(?:ui|u\.?i\.?)\s*errors?\s*[^\d]*(\d[\d,]*)/i,
    },
    { key: 'row_lock_errors', regex: /row\s*lock\s*errors?\s*[^\d]*(\d[\d,]*)/i },
    {
      key: 'total_callout_errors',
      regex: /(?:total\s*)?callout\s*errors?\s*[^\d]*(\d[\d,]*)/i,
    },
  ];

  const fullText = text.toLowerCase();

  for (const { key, regex } of patterns) {
    const match = fullText.match(regex);
    if (match) {
      counters[key] = parseInt(match[1].replace(/,/g, ''), 10);
    }
  }

  return counters;
}

/**
 * Determine if OCR results are uncertain enough to warrant a fallback message.
 */
function assessOcrCertainty(counters, confidence, layout) {
  if (layout === 'unknown') {
    return { certain: false, reason: 'unknown-layout' };
  }

  const allNull = Object.values(counters).every((v) => v === null);
  const allZeroOrNull = Object.values(counters).every((v) => v === null || v === 0);

  if (allNull) {
    return { certain: false, reason: 'no-counters-extracted' };
  }

  if (allZeroOrNull && confidence < 0.7) {
    return { certain: false, reason: 'low-confidence-zeros' };
  }

  return { certain: true };
}

/**
 * Analyze a screenshot using Tesseract.js OCR.
 * @param {File} imageFile - The image file to analyze
 * @param {function} onProgress - Progress callback (0-1)
 * @returns {Promise<object>} Structured analysis result
 */
export async function analyzeWithOCR(imageFile, onProgress = () => {}) {
  onProgress(0.05, 'Loading OCR engine...');
  await loadTesseract();

  onProgress(0.1, 'Preparing image...');
  const canvas = await loadImageToCanvas(imageFile);

  onProgress(0.15, 'Detecting layout...');
  const createWorker = window.__tesseractCreateWorker;
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(0.2 + m.progress * 0.6, 'Recognizing text...');
      }
    },
  });

  const layout = await detectLayout(canvas, worker);

  onProgress(0.25, 'Extracting counters...');
  const counterRegion = extractCounterRegion(canvas, layout);

  const {
    data: { text, confidence },
  } = await worker.recognize(counterRegion);
  await worker.terminate();

  onProgress(0.9, 'Parsing results...');
  const counters = parseCounters(text);
  const normalizedConfidence = Math.round(confidence) / 100;

  // Replace null values with 0 for confirmed layouts (null = truly unknown)
  const finalCounters = {};
  for (const [key, value] of Object.entries(counters)) {
    finalCounters[key] = value !== null ? value : layout !== 'unknown' ? 0 : null;
  }

  const certainty = assessOcrCertainty(finalCounters, normalizedConfidence, layout);

  onProgress(1, 'Complete');

  return {
    mode: 'basic',
    counters: finalCounters,
    raw_text: text,
    confidence: normalizedConfidence,
    layout,
    ocrCertain: certainty.certain,
    ocrUncertainReason: certainty.reason || null,
    timestamp: new Date().toISOString(),
  };
}
