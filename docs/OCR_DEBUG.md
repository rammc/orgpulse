# OCR Debug Mode

OrgPulse's Basic Mode uses Tesseract.js to extract the six Scale Center counter values from a screenshot. When OCR results look wrong — counters showing zero for a screenshot that clearly contains non-zero values, or values that don't match the screenshot — the debug mode surfaces what the OCR pipeline is actually seeing.

## Activating debug mode

In the browser DevTools Console:

```
localStorage.setItem('orgpulse-ocr-debug', 'true')
```

Then reload the page and analyze a screenshot (or click "Try with a sample screenshot"). Below the Detection Summary, a new section appears showing:

- The source image with magenta bounding boxes drawn where each counter is expected to be extracted
- A table with the preprocessed region image, raw text output, parsed value, and confidence score for each counter
- Mismatched values highlighted in amber (compared against the sample ground truth)

The browser console additionally logs the full Tesseract result for each counter, including word-level confidence data.

## Deactivating debug mode

```
localStorage.removeItem('orgpulse-ocr-debug')
```

Or in DevTools Application tab, delete the `orgpulse-ocr-debug` key from Local Storage.

## When to use debug mode

**You're troubleshooting OCR results on a specific screenshot.** The boxes in the debug overlay show whether extraction regions are correctly positioned over the numbers. The preprocessed images show whether the numbers arrive at Tesseract cleanly or are distorted by preprocessing. The raw text column shows exactly what Tesseract read before parsing.

**A user reports OCR problems and you're helping them diagnose.** Ask them to enable debug mode, reload, and share a screenshot of the diagnostic section plus the browser console output.

**You're adding support for a new Scale Center layout.** The debug overlay lets you visually calibrate region ratios against the actual layout by iterating on the ratio values and checking where the magenta boxes land.

## What the diagnostic output tells you

Each row in the debug table represents one of the six counters:

| Column | Meaning |
|---|---|
| Counter | Which counter slot this row represents |
| Box (x, y, w, h) | Pixel coordinates of the extraction region |
| Preprocessed | The image actually fed to Tesseract (after grayscale + contrast + upscale) |
| Raw text | Tesseract's raw output before parsing |
| Parsed | The integer value our parser extracted |
| Confidence | Tesseract's confidence percentage |
| Expected (sample) | Ground truth for the sample screenshot |

**If raw text contains labels** like "Successful Logins" instead of digits, the extraction box is positioned over the label row, not the number row. Fix: adjust `numberRowTop` in `ORG_PERF_LAYOUT`.

**If the preprocessed image shows a blurry or broken digit**, preprocessing is destroying the number (likely contrast boost is too aggressive). Fix: adjust the contrast parameters in `ocrCounterTile`.

**If the raw text is clean digits but parsed value is wrong**, the bug is in the regex parser logic in `ocrCounterTile`.

**If a box overlaps two tiles** (raw text contains parts of two labels), the horizontal ratios are wrong. Fix: adjust `tileLeft`, `tileRight`, or `numberInTileEnd` in `ORG_PERF_LAYOUT`.

## Related files

| File | Contains |
|---|---|
| `src/js/ocr.js` | OCR pipeline, region definitions (`ORG_PERF_LAYOUT`), preprocessing, per-tile extraction, layout detection, debug data collection |
| `src/js/matrix.js` | Debug panel rendering (`renderOcrDiagnosticPanel` function), box overlay canvas generation |
| `src/styles/main.css` | Diagnostic panel styles (`.ocr-diagnostic`, `.ocr-diag__*` classes) |

## Calibration workflow

When Salesforce changes the Org Performance layout (font size, spacing, tile arrangement), the OCR extraction boxes may need recalibration:

1. Enable debug mode: `localStorage.setItem('orgpulse-ocr-debug', 'true')`
2. Analyze a screenshot with known counter values
3. Check the magenta boxes in the debug overlay — do they sit on the numbers?
4. If misaligned, adjust the ratios in `ORG_PERF_LAYOUT` in `src/js/ocr.js`:
   - `numberRowTop` / `numberRowBottom` — vertical position of the number row
   - `tileLeft` / `tileRight` — horizontal extent of the tile strip
   - `numberInTileStart` / `numberInTileEnd` — how much of each tile to crop
5. Rebuild, reload, re-analyze, check the debug overlay
6. Repeat until all six boxes land squarely on their numbers

## History

The debug infrastructure was added in April 2026 during calibration of the Org Performance layout (the post-2025 Scale Center replacement). It remains permanently in the codebase because Salesforce UI changes periodically require OCR recalibration, and this tool is the primary means of diagnosing when that happens.
