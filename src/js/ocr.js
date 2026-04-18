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
    'org-performance': { top: 0.085, bottom: 0.13 },
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
 * Extract ONLY the numbers row from the counter region.
 * The numbers are in the bottom ~50% of the counter tile area.
 */
function extractNumbersRegion(canvas, layout) {
  const regions = {
    'org-performance': { top: 0.1, bottom: 0.13 },
    'scale-center-legacy': { top: 0.1, bottom: 0.15 },
    unknown: { top: 0.1, bottom: 0.18 },
  };

  const region = regions[layout] || regions.unknown;
  const y = Math.round(canvas.height * region.top);
  const h = Math.round(canvas.height * (region.bottom - region.top));

  // Extract at 3x scale for better OCR on large digits
  const scale = 3;
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = canvas.width * scale;
  regionCanvas.height = h * scale;
  const ctx = regionCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, regionCanvas.width, regionCanvas.height);

  // High-contrast grayscale: make digits black on white
  const imageData = ctx.getImageData(0, 0, regionCanvas.width, regionCanvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    // Tight threshold: <80 = black (text), else white (background)
    const val = gray < 80 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);

  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('orgpulse-ocr-debug') === 'true'
  ) {
    const dbgCtx = canvas.getContext('2d');
    dbgCtx.strokeStyle = 'cyan';
    dbgCtx.lineWidth = 3;
    dbgCtx.strokeRect(0, y, canvas.width, h);
    dbgCtx.fillStyle = 'cyan';
    dbgCtx.font = '14px sans-serif';
    dbgCtx.fillText('Numbers region', 10, y + 16);
  }

  return regionCanvas;
}

/**
 * Parse counter values from OCR text.
 *
 * Strategy 1: Label-based regex — looks for "Successful Logins ... 23"
 * Strategy 2: Two-pass — labels from full OCR, numbers from digits-only OCR
 * Strategy 3: Positional fallback — numbers after last label
 */
function parseCounters(labelText, numberText) {
  const text = numberText ? labelText + '\n' + numberText : labelText;
  const COUNTER_KEYS = [
    'successful_logins',
    'failed_logins',
    'concurrent_apex_errors',
    'concurrent_ui_errors',
    'row_lock_errors',
    'total_callout_errors',
  ];

  const counters = {};
  for (const k of COUNTER_KEYS) counters[k] = null;

  // Log raw text for debugging
  console.log('[OrgPulse OCR] Raw text:', JSON.stringify(text));

  const fullText = text.toLowerCase();

  // Strategy 1: Label-based regex (works when label and number are on same line)
  const labelPatterns = [
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

  let labelMatchCount = 0;
  for (const { key, regex } of labelPatterns) {
    const match = fullText.match(regex);
    if (match) {
      counters[key] = parseInt(match[1].replace(/,/g, ''), 10);
      labelMatchCount++;
    }
  }

  if (labelMatchCount >= 3) {
    console.log('[OrgPulse OCR] Strategy 1 (label-based): matched', labelMatchCount, 'counters');
    return counters;
  }

  // Strategy 2: Positional — detect known labels, then find standalone numbers
  // In Org Performance layout, labels and numbers are on separate lines.
  // The OCR text typically looks like:
  //   "Successful Logins ® Failed Logins ® ... \n 23 0 0 0 2 0"
  // or each label+number on its own block.

  const hasLabels =
    /successful\s*login/i.test(fullText) ||
    /failed\s*login/i.test(fullText) ||
    /row\s*lock/i.test(fullText) ||
    /callout\s*error/i.test(fullText);

  if (hasLabels) {
    // The Org Performance layout has labels on one line and numbers on the next.
    // Find the position of the LAST known label keyword, then extract numbers
    // that appear AFTER it in the text.
    const labelAnchors = [
      /successful\s*logins?/i,
      /failed\s*logins?/i,
      /concurrent\s*apex/i,
      /concurrent\s*u/i,
      /row\s*lock/i,
      /callout\s*errors?/i,
    ];

    let lastLabelEnd = 0;
    for (const anchor of labelAnchors) {
      const match = anchor.exec(fullText);
      if (match) {
        const end = match.index + match[0].length;
        if (end > lastLabelEnd) lastLabelEnd = end;
      }
    }

    // Extract numbers that appear AFTER the last label
    const textAfterLabels = text.substring(lastLabelEnd);
    const numbersAfterLabels = [];
    const numRegex = /\b(\d{1,6})\b/g;
    let m;
    while ((m = numRegex.exec(textAfterLabels)) !== null) {
      // Filter out year-like numbers (2020-2030) and time-like (12:00 → "12", "00")
      const num = parseInt(m[1], 10);
      if (num >= 2020 && num <= 2030) continue; // likely year
      numbersAfterLabels.push(num);
    }

    if (numbersAfterLabels.length >= 6) {
      const first6 = numbersAfterLabels.slice(0, 6);
      for (let i = 0; i < 6; i++) {
        counters[COUNTER_KEYS[i]] = first6[i];
      }
      console.log('[OrgPulse OCR] Strategy 2 (positional, after labels): extracted', first6);
      return counters;
    }

    // If fewer than 6 but some found, still use what we have
    if (numbersAfterLabels.length > 0) {
      for (let i = 0; i < Math.min(numbersAfterLabels.length, 6); i++) {
        counters[COUNTER_KEYS[i]] = numbersAfterLabels[i];
      }
      console.log('[OrgPulse OCR] Strategy 2 (partial): extracted', numbersAfterLabels);
      return counters;
    }
  }

  // Strategy 3: Direct number extraction from digits-only OCR pass
  if (numberText) {
    const directNumbers = numberText
      .trim()
      .split(/[\s\n]+/)
      .map((s) => s.replace(/[^\d]/g, ''))
      .filter((s) => s.length > 0)
      .map(Number);

    if (directNumbers.length >= 6) {
      for (let i = 0; i < 6; i++) {
        counters[COUNTER_KEYS[i]] = directNumbers[i];
      }
      console.log(
        '[OrgPulse OCR] Strategy 3 (direct digits): extracted',
        directNumbers.slice(0, 6)
      );
      return counters;
    }

    if (directNumbers.length > 0) {
      for (let i = 0; i < Math.min(directNumbers.length, 6); i++) {
        counters[COUNTER_KEYS[i]] = directNumbers[i];
      }
      console.log('[OrgPulse OCR] Strategy 3 (partial digits): extracted', directNumbers);
      return counters;
    }
  }

  console.log(
    '[OrgPulse OCR] No strategy matched. Labels found:',
    hasLabels,
    'Text length:',
    text.length
  );
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

  // Two-pass OCR: first get labels, then get numbers separately
  const counterRegion = extractCounterRegion(canvas, layout);

  // Pass 1: Full OCR to get labels
  const { data: labelData } = await worker.recognize(counterRegion);
  console.log('[OrgPulse OCR] Pass 1 (labels):', JSON.stringify(labelData.text));

  // Pass 2: Numbers-only OCR on the bottom half of the counter region
  // (where the large counter values are rendered)
  onProgress(0.6, 'Reading counter values...');
  const numbersRegion = extractNumbersRegion(canvas, layout);

  // Create a fresh worker with digits-only whitelist for number extraction
  const numWorker = await createWorker('eng', 1, {});
  await numWorker.setParameters({
    tessedit_char_whitelist: '0123456789 ',
    tessedit_pageseg_mode: '7',
  });
  const { data: numData } = await numWorker.recognize(numbersRegion);
  await numWorker.terminate();

  console.log('[OrgPulse OCR] Pass 2 (numbers):', JSON.stringify(numData.text));

  await worker.terminate();

  onProgress(0.9, 'Parsing results...');
  const counters = parseCounters(labelData.text, numData.text);
  const normalizedConfidence = Math.round(Math.max(labelData.confidence, numData.confidence)) / 100;

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
    raw_text: labelData.text + '\n' + (numData?.text || ''),
    confidence: normalizedConfidence,
    layout,
    ocrCertain: certainty.certain,
    ocrUncertainReason: certainty.reason || null,
    timestamp: new Date().toISOString(),
  };
}
