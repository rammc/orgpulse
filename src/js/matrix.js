import { initSettings } from './settings.js';
import { analyzeWithOCR } from './ocr.js';
import { analyzeWithVision, getVisionErrorMessage } from './vision.js';
import { matchRecommendations, generateSignals } from './recommendations.js';

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

      cell.innerHTML = `
        <div class="matrix-cell__hit-count" id="hit-${cellId}">0</div>
        <div class="matrix-cell__icon">${data.icon}</div>
        <div class="matrix-cell__title">${data.title}</div>
        <div class="matrix-cell__label">${data.priority_label}</div>
      `;

      cell.addEventListener('click', () => openDetailPanel(cellId));
      grid.appendChild(cell);
    }
  }
}

function highlightCells(highlights) {
  // Clear previous highlights
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

  // Color class for priority badge
  const colorClass = {
    green:
      'background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border)',
    yellow:
      'background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow-border)',
    orange:
      'background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border)',
    red: 'background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border)',
  };

  title.innerHTML = `
    <span>${data.icon} ${data.title}</span>
    <span class="detail-panel__priority" style="${colorClass[data.color]}">${data.priority_label}</span>
  `;

  // Check if this cell has highlight reasons
  const highlight = currentHighlights.find((h) => h.cellId === cellId);
  const highlightHtml = highlight
    ? `<div style="margin-bottom: 1rem; padding: 0.75rem 1rem; background: var(--green-bg); border: 1px solid var(--green-border); border-radius: var(--radius-sm); font-size: 0.85rem;">
        <strong style="color: var(--green);">Detected signals:</strong>
        <ul style="margin: 0.5rem 0 0 1.25rem; color: var(--text-muted);">
          ${highlight.reasons.map((r) => `<li>${r}</li>`).join('')}
        </ul>
      </div>`
    : '';

  body.innerHTML = `
    ${highlightHtml}
    <div class="detail-panel__hint">${data.scale_center_hint}</div>
    <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">${data.subtitle}</p>
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
                ${rec.references.map((ref) => `<a class="recommendation-card__ref" href="${ref.url}" target="_blank" rel="noopener noreferrer">📄 ${ref.type === 'official_docs' ? 'Salesforce Docs' : 'Reference'} ↗</a>`).join(' ')}
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

    // If it's a missing API key error, open settings
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
  // Hide progress
  document.getElementById('progress-bar').classList.remove('progress-bar--visible');

  // Show detection summary
  const summary = document.getElementById('detection-summary');
  summary.classList.add('detection-summary--visible');

  // Render counter cards (basic mode)
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
    // Deep mode: show summary
    counterContainer.innerHTML = `
      <div style="grid-column: 1 / -1; font-size: 0.9rem; color: var(--text-muted); line-height: 1.6;">
        ${result.summary || 'Analysis complete.'}
      </div>
    `;
  }

  // Render signals
  const signals = generateSignals(result);
  const signalContainer = document.getElementById('signal-tags');
  signalContainer.innerHTML = signals
    .map((s) => `<span class="signal-tag signal-tag--${s.severity}">${s.text}</span>`)
    .join('');

  // Confidence
  const confidenceEl = document.getElementById('confidence-text');
  if (result.confidence !== undefined) {
    confidenceEl.textContent = `OCR Confidence: ${Math.round(result.confidence * 100)}%`;
  } else if (result.findings) {
    const avgConf =
      result.findings.reduce((sum, f) => sum + (f.confidence || 0), 0) /
      (result.findings.length || 1);
    confidenceEl.textContent = `AI Confidence (avg): ${Math.round(avgConf * 100)}%`;
  }

  // Match to matrix and highlight
  const highlights = matchRecommendations(result, recommendationsData);
  highlightCells(highlights);

  // Scroll to matrix
  document.getElementById('matrix-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ Start ============

document.addEventListener('DOMContentLoaded', init);
