let tesseractLoaded = false;

async function loadTesseract() {
  if (tesseractLoaded) return;
  const { createWorker } = await import('tesseract.js');
  window.__tesseractCreateWorker = createWorker;
  tesseractLoaded = true;
}

function cropTopRegion(imageFile) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Crop top 30% of the image where counters typically appear
      const cropHeight = Math.round(img.height * 0.3);
      canvas.width = img.width;
      canvas.height = cropHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, img.width, cropHeight, 0, 0, img.width, cropHeight);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.src = url;
  });
}

function parseCounters(text) {
  const counters = {
    successful_logins: 0,
    failed_logins: 0,
    concurrent_apex_errors: 0,
    concurrent_ui_errors: 0,
    row_lock_errors: 0,
    total_callout_errors: 0,
  };

  const patterns = [
    { key: 'successful_logins', regex: /successful\s*logins?\s*[:\u002d]?\s*(\d[\d,]*)/i },
    { key: 'failed_logins', regex: /failed\s*logins?\s*[:\u002d]?\s*(\d[\d,]*)/i },
    {
      key: 'concurrent_apex_errors',
      regex: /concurrent\s*apex\s*errors?\s*[:\u002d]?\s*(\d[\d,]*)/i,
    },
    {
      key: 'concurrent_ui_errors',
      regex: /concurrent\s*(?:ui|u\.?i\.?)\s*errors?\s*[:\u002d]?\s*(\d[\d,]*)/i,
    },
    { key: 'row_lock_errors', regex: /row\s*lock\s*errors?\s*[:\u002d]?\s*(\d[\d,]*)/i },
    {
      key: 'total_callout_errors',
      regex: /(?:total\s*)?callout\s*errors?\s*[:\u002d]?\s*(\d[\d,]*)/i,
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
 * Analyze a screenshot using Tesseract.js OCR.
 * @param {File} imageFile - The image file to analyze
 * @param {function} onProgress - Progress callback (0-1)
 * @returns {Promise<object>} Structured analysis result
 */
export async function analyzeWithOCR(imageFile, onProgress = () => {}) {
  onProgress(0.05, 'Loading OCR engine...');
  await loadTesseract();

  onProgress(0.1, 'Preparing image...');
  const croppedBlob = await cropTopRegion(imageFile);

  onProgress(0.15, 'Starting text recognition...');
  const createWorker = window.__tesseractCreateWorker;
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(0.15 + m.progress * 0.7, 'Recognizing text...');
      }
    },
  });

  const {
    data: { text, confidence },
  } = await worker.recognize(croppedBlob);
  await worker.terminate();

  onProgress(0.9, 'Parsing results...');
  const counters = parseCounters(text);

  onProgress(1, 'Complete');

  return {
    mode: 'basic',
    counters,
    raw_text: text,
    confidence: Math.round(confidence) / 100,
    timestamp: new Date().toISOString(),
  };
}
