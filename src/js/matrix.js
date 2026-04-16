import { initSettings } from './settings.js';
import { analyzeWithOCR } from './ocr.js';
import { analyzeWithVision, getVisionErrorMessage } from './vision.js';
import { matchRecommendations, generateSignals } from './recommendations.js';

// SVG Icons (Lucide-style, stroke-based)
const ICONS = {
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  target:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  package:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  scale:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  'x-circle':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};

// State
let recommendationsData = [];
let selectedFile = null;
let analysisMode = 'basic';
let currentHighlights = [];

// Matrix layout: rows (top=high impact) x cols (left=low effort)
const MATRIX_LAYOUT = [
  ['quick-wins', 'prioritize', 'strategic'],
  ['take-along', 'evaluate', 'weigh-up'],
  ['opportunistic', 'defer', 'skip'],
];

// ============ Init ============

async function init() {
  initSettings();
  await loadRecommendations();
  renderMatrix();
  bindUpload();
  bindModeToggle();
  bindDetailPanel();
}

async function loadRecommendations() {
  const res = await fetch('./data/recommendations.json');
  recommendationsData = await res.json();
}

// ============ Matrix Rendering ============

function renderMatrix() {
  const grid = document.getElementById('matrix-grid');
  grid.innerHTML = '';

  for (const row of MATRIX_LAYOUT) {
    for (const cellId of row) {
      const data = recommendationsData.find((r) => r.id === cellId);
      if (!data) continue;

      const cell = document.createElement('div');
      cell.className = `matrix-cell matrix-cell--${data.color}`;
      cell.dataset.cellId = cellId;

      const iconSvg = ICONS[data.icon] || '';

      cell.innerHTML = `
        <div class="matrix-cell__hit-count" id="hit-${cellId}">0</div>
        <div class="matrix-cell__icon">${iconSvg}</div>
        <div class="matrix-cell__title">${data.title}</div>
        <div class="matrix-cell__label">${data.priority_label}</div>
      `;

      cell.addEventListener('click', () => openDetailPanel(cellId));
      grid.appendChild(cell);
    }
  }
}

function highlightCells(highlights) {
  document.querySelectorAll('.matrix-cell--highlighted').forEach((el) => {
    el.classList.remove('matrix-cell--highlighted');
  });

  currentHighlights = highlights;

  for (const { cellId, reasons } of highlights) {
    const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
    if (cell) {
      cell.classList.add('matrix-cell--highlighted');
      const hitCount = cell.querySelector('.matrix-cell__hit-count');
      if (hitCount) {
        hitCount.textContent = reasons.length;
      }
    }
  }
}

// ============ Detail Panel ============

function bindDetailPanel() {
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.remove('detail-panel--visible');
  });
}

function openDetailPanel(cellId) {
  const data = recommendationsData.find((r) => r.id === cellId);
  if (!data) return;

  const panel = document.getElementById('detail-panel');
  const title = document.getElementById('detail-title');
  const body = document.getElementById('detail-body');

  const colorStyle = {
    green:
      'background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border)',
    yellow:
      'background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow-border)',
    orange:
      'background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border)',
    red: 'background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border)',
  };

  const iconSvg = ICONS[data.icon] || '';

  title.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:0.4rem">
      <span style="display:inline-flex;width:20px;height:20px;color:var(--${data.color})">${iconSvg}</span>
      ${data.title}
    </span>
    <span class="detail-panel__priority" style="${colorStyle[data.color]}">${data.priority_label}</span>
  `;

  const highlight = currentHighlights.find((h) => h.cellId === cellId);
  const highlightHtml = highlight
    ? `<div class="detail-panel__signals">
        <div class="detail-panel__signals-title">Detected signals</div>
        <ul class="detail-panel__signals-list">
          ${highlight.reasons.map((r) => `<li>${r}</li>`).join('')}
        </ul>
      </div>`
    : '';

  body.innerHTML = `
    ${highlightHtml}
    <div class="detail-panel__hint">${data.scale_center_hint}</div>
    <p style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 1rem; line-height: 1.6;">${data.subtitle}</p>
    ${data.recommendations
      .map(
        (rec) => `
      <div class="recommendation-card">
        <div class="recommendation-card__title">${rec.title}</div>
        <div class="recommendation-card__body">${rec.body}</div>
        <div class="recommendation-card__tags">
          ${rec.tags.map((t) => `<span class="tag">${t}</span>`).join('')}
        </div>
        ${
          rec.references && rec.references.length > 0
            ? `<div class="recommendation-card__refs">
                ${rec.references
                  .map(
                    (ref) =>
                      `<a class="recommendation-card__ref" href="${ref.url}" target="_blank" rel="noopener noreferrer">${ref.type === 'official_docs' ? 'Salesforce Docs' : 'Reference'} &#8599;</a>`
                  )
                  .join(' ')}
              </div>`
            : ''
        }
      </div>
    `
      )
      .join('')}
  `;

  panel.classList.add('detail-panel--visible');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============ Upload ============

function bindUpload() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const previewBar = document.getElementById('preview-bar');
  const analyzeBtn = document.getElementById('analyze-btn');
  const clearBtn = document.getElementById('clear-btn');

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('upload-zone--dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('upload-zone--dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('upload-zone--dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  analyzeBtn.addEventListener('click', runAnalysis);

  clearBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    previewBar.classList.remove('preview-bar--visible');
    document.getElementById('progress-bar').classList.remove('progress-bar--visible');
    document.getElementById('detection-summary').classList.remove('detection-summary--visible');
    document.getElementById('detail-panel').classList.remove('detail-panel--visible');
    highlightCells([]);
  });
}

function handleFile(file) {
  selectedFile = file;

  const thumb = document.getElementById('preview-thumb');
  const name = document.getElementById('preview-name');
  const size = document.getElementById('preview-size');
  const previewBar = document.getElementById('preview-bar');

  thumb.src = URL.createObjectURL(file);
  name.textContent = file.name;
  size.textContent = `${(file.size / 1024).toFixed(1)} KB`;
  previewBar.classList.add('preview-bar--visible');
}

// ============ Mode Toggle ============

function bindModeToggle() {
  const basicBtn = document.getElementById('mode-basic');
  const deepBtn = document.getElementById('mode-deep');

  basicBtn.addEventListener('click', () => {
    analysisMode = 'basic';
    basicBtn.classList.add('mode-toggle__option--active');
    deepBtn.classList.remove('mode-toggle__option--active');
  });

  deepBtn.addEventListener('click', () => {
    analysisMode = 'deep';
    deepBtn.classList.add('mode-toggle__option--active');
    basicBtn.classList.remove('mode-toggle__option--active');
  });
}

// ============ Analysis ============

async function runAnalysis() {
  if (!selectedFile) return;

  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressFill = document.getElementById('progress-fill');
  const analyzeBtn = document.getElementById('analyze-btn');

  // Reset progress bar styling
  progressFill.style.background = '';
  progressBar.classList.add('progress-bar--visible');
  analyzeBtn.disabled = true;

  function onProgress(value, label) {
    progressFill.style.width = `${Math.round(value * 100)}%`;
    if (label) progressLabel.textContent = label;
  }

  try {
    let result;

    if (analysisMode === 'basic') {
      result = await analyzeWithOCR(selectedFile, onProgress);
    } else {
      result = await analyzeWithVision(selectedFile, onProgress);
    }

    displayResults(result);
  } catch (error) {
    progressLabel.textContent =
      analysisMode === 'deep' ? getVisionErrorMessage(error) : `Analysis failed: ${error.message}`;
    progressFill.style.width = '100%';
    progressFill.style.background = 'var(--red)';

    if (error.message === 'NO_API_KEY') {
      setTimeout(() => {
        document.getElementById('settings-btn').click();
      }, 1500);
    }
  } finally {
    analyzeBtn.disabled = false;
  }
}

function displayResults(result) {
  document.getElementById('progress-bar').classList.remove('progress-bar--visible');

  const summary = document.getElementById('detection-summary');
  summary.classList.add('detection-summary--visible');

  const counterContainer = document.getElementById('counter-cards');
  if (result.mode === 'basic') {
    const counterLabels = {
      successful_logins: 'Successful Logins',
      failed_logins: 'Failed Logins',
      concurrent_apex_errors: 'Concurrent Apex Errors',
      concurrent_ui_errors: 'Concurrent UI Errors',
      row_lock_errors: 'Row Lock Errors',
      total_callout_errors: 'Total Callout Errors',
    };

    counterContainer.innerHTML = Object.entries(result.counters)
      .map(([key, value]) => {
        let severity = 'ok';
        if (key !== 'successful_logins' && value > 0) {
          severity = value > 10 ? 'critical' : 'warning';
        }
        return `
          <div class="counter-card counter-card--${severity}">
            <div class="counter-card__label">${counterLabels[key]}</div>
            <div class="counter-card__value">${value.toLocaleString()}</div>
          </div>
        `;
      })
      .join('');
  } else {
    counterContainer.innerHTML = `
      <div style="grid-column: 1 / -1; font-size: 0.85rem; color: var(--text-dim); line-height: 1.6;">
        ${result.summary || 'Analysis complete.'}
      </div>
    `;
  }

  const signals = generateSignals(result);
  const signalContainer = document.getElementById('signal-tags');
  signalContainer.innerHTML = signals
    .map((s) => `<span class="signal-tag signal-tag--${s.severity}">${s.text}</span>`)
    .join('');

  const confidenceEl = document.getElementById('confidence-text');
  if (result.confidence !== undefined) {
    confidenceEl.textContent = `OCR Confidence: ${Math.round(result.confidence * 100)}%`;
  } else if (result.findings) {
    const avgConf =
      result.findings.reduce((sum, f) => sum + (f.confidence || 0), 0) /
      (result.findings.length || 1);
    confidenceEl.textContent = `AI Confidence (avg): ${Math.round(avgConf * 100)}%`;
  }

  const highlights = matchRecommendations(result, recommendationsData);
  highlightCells(highlights);

  document.getElementById('matrix-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ Start ============

document.addEventListener('DOMContentLoaded', init);
