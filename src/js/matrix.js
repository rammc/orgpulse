import { initSettings } from './settings.js';
import { analyzeWithOCR } from './ocr.js';
import { analyzeWithVision, getVisionErrorMessage } from './vision.js';
import {
  calculateCellScores,
  generateSignals,
  filterRecommendations,
  getAIInsightsForCell,
} from './recommendations.js';

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

const MODERN_PATTERN_TAGS = new Set([
  'GraphQL',
  'Data Cloud',
  'Zero Copy',
  'USER_MODE',
  'Named Credentials',
  'Platform Events',
  'CDC',
  'Pub/Sub API',
  'Permission Set Groups',
  'Dynamic Forms',
  'Trigger Actions Framework',
]);

// State
let recommendationsData = [];
let selectedFile = null;
let analysisMode = 'basic';
let currentScoreResult = null;
let accumulatedResults = [];
let lastFileKey = null;
let isSampleLoaded = false;

// Matrix layout: rows (top=high impact) x cols (left=low effort)
const MATRIX_LAYOUT = [
  ['quick-wins', 'prioritize', 'strategic'],
  ['take-along', 'evaluate', 'weigh-up'],
  ['opportunistic', 'defer', 'skip'],
];

// ============ Init ============

async function init() {
  initSettings();
  initOnboarding();
  await loadRecommendations();
  renderMatrix();
  bindUpload();
  bindModeToggle();
  bindDetailPanel();

  // Load metadata section in local mode (tree-shaken out of public builds)
  try {
    const { isLocalMode } = await import('../features.js');
    if (isLocalMode()) {
      const { initMetadataSection } = await import('../ui/metadataSection.js');
      initMetadataSection();
    }
  } catch {
    /* features.js not available or not local mode */
  }
}

function initOnboarding() {
  const section = document.getElementById('onboarding');
  const toggle = document.getElementById('onboarding-toggle');
  if (!section || !toggle) return;

  const dismissed = localStorage.getItem('orgpulse_onboarding_dismissed') === 'true';
  setOnboardingState(section, toggle, !dismissed);

  toggle.addEventListener('click', () => {
    const expanded = section.getAttribute('aria-expanded') === 'true';
    setOnboardingState(section, toggle, !expanded);
    localStorage.setItem('orgpulse_onboarding_dismissed', expanded ? 'false' : 'true');
  });

  section.querySelector('.onboarding__header').addEventListener('click', (e) => {
    if (e.target === toggle) return;
    toggle.click();
  });
}

function setOnboardingState(section, toggle, expanded) {
  section.setAttribute('aria-expanded', expanded);
  toggle.setAttribute('aria-expanded', expanded);
  toggle.innerHTML = expanded ? 'Collapse &#9650;' : 'Expand &#9660;';
}

async function loadRecommendations() {
  const module = await import('../data/recommendations.json');
  recommendationsData = module.default;
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
        <div class="matrix-cell__score-badge" id="badge-${cellId}"></div>
        <div class="matrix-cell__icon">${iconSvg}</div>
        <div class="matrix-cell__title">${data.title}</div>
        <div class="matrix-cell__label">${data.priority_label}</div>
      `;

      cell.addEventListener('click', () => openDetailPanel(cellId));
      grid.appendChild(cell);
    }
  }
}

function applySeverityToMatrix(scoreResult) {
  // Clear all severity classes
  const severityClasses = [
    'matrix-cell--severity-low',
    'matrix-cell--severity-medium',
    'matrix-cell--severity-high',
  ];
  document.querySelectorAll('.matrix-cell').forEach((el) => {
    severityClasses.forEach((cls) => el.classList.remove(cls));
  });

  // Apply severity classes based on scores
  for (const cellScore of scoreResult.cells) {
    if (cellScore.score === 0) continue;
    const cellEl = document.querySelector(`[data-cell-id="${cellScore.id}"]`);
    if (!cellEl) continue;

    cellEl.classList.add(`matrix-cell--severity-${cellScore.severityLevel}`);

    const badge = cellEl.querySelector('.matrix-cell__score-badge');
    if (badge) {
      badge.textContent = cellScore.score;
    }
  }

  // Healthy banner
  const banner = document.getElementById('healthy-banner');
  if (banner) {
    banner.classList.toggle('healthy-banner--visible', scoreResult.healthStatus === 'healthy');
  }
}

// ============ Priority Ranking ============

function renderPriorityRanking(scoreResult) {
  const container = document.getElementById('priority-ranking');
  const rankedCells = scoreResult.cells
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (rankedCells.length === 0) {
    container.innerHTML = '';
    container.classList.remove('priority-ranking--visible');
    return;
  }

  const severityDotClass = {
    high: 'severity-dot--high',
    medium: 'severity-dot--medium',
    low: 'severity-dot--low',
  };

  const items = rankedCells
    .map((cellScore, index) => {
      const cellData = recommendationsData.find((r) => r.id === cellScore.id);
      if (!cellData) return '';

      const signals = cellScore.matchedSignals
        .map((s) => {
          const val = s.value !== null ? ` (${s.value})` : '';
          return `<span class="ranking-signal ranking-signal--${s.severity}">${s.metric}${val}</span>`;
        })
        .join('');

      return `
        <div class="ranking-item" data-cell-id="${cellScore.id}">
          <div class="ranking-item__rank">${index + 1}</div>
          <div class="ranking-item__dot ${severityDotClass[cellScore.severityLevel] || ''}"></div>
          <div class="ranking-item__content">
            <div class="ranking-item__header">
              <span class="ranking-item__name">${cellData.title}</span>
              <span class="ranking-item__score">Score: ${cellScore.score}</span>
            </div>
            <div class="ranking-item__signals">${signals}</div>
          </div>
        </div>
      `;
    })
    .join('');

  const sourcesHtml =
    scoreResult.sources.length > 0
      ? `<div class="ranking-sources">${scoreResult.sources.map((s) => `<span class="ranking-source">${s === 'basic' ? 'OCR Analysis' : 'Deep Analysis'}</span>`).join('')}</div>`
      : '';

  container.innerHTML = `
    <div class="ranking-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      Priority Ranking
      ${sourcesHtml}
    </div>
    ${items}
  `;
  container.classList.add('priority-ranking--visible');

  // Bind click handlers to ranking items
  container.querySelectorAll('.ranking-item').forEach((el) => {
    el.addEventListener('click', () => {
      const cellId = el.dataset.cellId;
      openDetailPanel(cellId);
    });
  });
}

// ============ Detail Panel ============

function bindDetailPanel() {
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.remove('detail-panel--visible');
  });
}

function renderRecommendationCard(rec, dimmed) {
  // Build reference links with human-readable labels
  let refsHtml = '';
  if (rec.references && rec.references.length > 0) {
    const refLinks = rec.references
      .map((ref) => {
        const typeIcon =
          ref.type === 'official_docs'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
        // Derive label from URL
        let label = ref.type === 'official_docs' ? 'Salesforce Docs' : 'Community Resource';
        try {
          const url = new URL(ref.url);
          const path = url.pathname.split('/').filter(Boolean);
          if (path.length > 0) {
            const lastSegment = path[path.length - 1]
              .replace(/\.htm$/, '')
              .replace(/[_-]/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());
            if (lastSegment.length > 3 && lastSegment.length < 60) {
              label = lastSegment;
            }
          }
        } catch {
          /* keep default label */
        }
        return `<a class="recommendation-card__ref" href="${ref.url}" target="_blank" rel="noopener noreferrer">${typeIcon} ${label} &#8599;</a>`;
      })
      .join('');
    refsHtml = `<div class="recommendation-card__refs">${refLinks}</div>`;
  }

  return `
    <div class="recommendation-card${dimmed ? ' recommendation-card--dimmed' : ''}">
      <div class="recommendation-card__title">${rec.title}</div>
      <div class="recommendation-card__body">${rec.body}</div>
      <div class="recommendation-card__tags">
        ${rec.tags.map((t) => `<span class="tag${MODERN_PATTERN_TAGS.has(t) ? ' tag--modern' : ''}">${t}</span>`).join('')}
      </div>
      ${refsHtml}
    </div>
  `;
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
  const cellScore = currentScoreResult
    ? currentScoreResult.cells.find((c) => c.id === cellId)
    : null;
  const hasScore = cellScore && cellScore.score > 0;

  const scoreHtml = hasScore
    ? `<span class="detail-panel__score detail-panel__score--${cellScore.severityLevel}">Score: ${cellScore.score}</span>`
    : '';

  title.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:0.4rem">
      <span style="display:inline-flex;width:20px;height:20px;color:var(--${data.color})">${iconSvg}</span>
      ${data.title}
      ${scoreHtml}
    </span>
    <span class="detail-panel__priority" style="${colorStyle[data.color]}">${data.priority_label}</span>
  `;

  // Detected signals section
  let signalsHtml = '';
  if (hasScore) {
    const rows = cellScore.matchedSignals
      .map((s) => {
        const valStr = s.value !== null ? s.value.toLocaleString() : 'detected';
        const sourceLabel = s.source === 'vision' ? ' (AI)' : '';
        return `
          <div class="signal-row">
            <span class="signal-row__metric">${s.metric}${sourceLabel}</span>
            <span class="signal-row__value">${valStr}</span>
            <span class="signal-row__severity signal-row__severity--${s.severity}">${s.severity}</span>
            <span class="signal-row__points">+${s.points} pts</span>
          </div>
        `;
      })
      .join('');

    signalsHtml = `
      <div class="detail-panel__signals">
        <div class="detail-panel__signals-title">Detected signals</div>
        ${rows}
      </div>
    `;
  }

  // AI Insights section (only for deep mode results)
  let aiInsightsHtml = '';
  if (accumulatedResults.length > 0) {
    const { hints, correlations } = getAIInsightsForCell(cellId, accumulatedResults);
    if (hints.length > 0) {
      aiInsightsHtml = `
        <div class="ai-insights">
          <div class="ai-insights__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
            AI Insights
            <span class="ai-insights__label">Based on Deep Analysis</span>
          </div>
          <div class="ai-insights__content">
            ${hints.map((h) => `<p class="ai-insights__hint">${h}</p>`).join('')}
            ${correlations.length > 0 ? `<div class="ai-insights__correlations"><strong>Correlations:</strong> ${correlations.join(' · ')}</div>` : ''}
          </div>
        </div>
      `;
    }
  }

  // Recommendation filtering
  let recsHtml = '';
  if (hasScore && cellScore.matchedSignals.length > 0) {
    const filtered = filterRecommendations(data, cellScore.matchedSignals);
    const countLabel = `<div class="recs-count">${filtered.relevant.length} of ${filtered.totalCount} recommendations relevant to detected signals</div>`;

    const relevantCards = filtered.relevant
      .map((rec) => renderRecommendationCard(rec, false))
      .join('');

    let hiddenSection = '';
    if (filtered.hidden.length > 0) {
      const hiddenCards = filtered.hidden
        .map((rec) => renderRecommendationCard(rec, true))
        .join('');
      const modernHidden = filtered.hidden.filter((rec) =>
        rec.tags.some((t) => MODERN_PATTERN_TAGS.has(t))
      );
      const modernHint =
        modernHidden.length > 0
          ? `<div class="recs-count" style="margin-top:0.25rem; opacity:0.7">+ ${modernHidden.length} additional modern pattern${modernHidden.length > 1 ? 's' : ''} not matched by current signals</div>`
          : '';
      hiddenSection = `
        ${modernHint}
        <button class="show-all-toggle" onclick="this.closest('.detail-panel__body').querySelector('.hidden-recs').classList.toggle('hidden-recs--visible'); this.textContent = this.textContent.includes('Show') ? 'Hide additional recommendations' : 'Show all recommendations for this cell'">
          Show all recommendations for this cell
        </button>
        <div class="hidden-recs">${hiddenCards}</div>
      `;
    }

    recsHtml = countLabel + relevantCards + hiddenSection;
  } else if (data.recommendations.length > 0) {
    recsHtml = data.recommendations.map((rec) => renderRecommendationCard(rec, false)).join('');
  } else {
    recsHtml = `<div class="no-recs-fallback">No specific recommendations for this cell.</div>`;
  }

  // Timestamp at bottom of detail panel
  let timestampHtml = '';
  if (data.added) {
    if (data.updated && data.updated !== data.added) {
      timestampHtml = `<div class="detail-panel__timestamp">Added ${data.added} · Updated ${data.updated}</div>`;
    } else {
      timestampHtml = `<div class="detail-panel__timestamp">Added ${data.added}</div>`;
    }
  }

  body.innerHTML = `
    ${signalsHtml}
    ${aiInsightsHtml}
    <div class="detail-panel__hint">${data.scale_center_hint}</div>
    <p style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 1rem; line-height: 1.6;">${data.subtitle}</p>
    ${recsHtml}
    ${timestampHtml}
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

  // Sample screenshot loader
  const sampleBtn = document.getElementById('load-sample-btn');
  if (sampleBtn) {
    sampleBtn.addEventListener('click', async () => {
      sampleBtn.disabled = true;
      sampleBtn.textContent = 'Loading sample...';
      try {
        const base = import.meta.env.BASE_URL || '/';
        const response = await fetch(`${base}samples/scale-center-sample.png`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const file = new File([blob], 'scale-center-sample.png', { type: 'image/png' });
        isSampleLoaded = true;
        handleFile(file);
        document.getElementById('sample-offer')?.classList.add('sample-offer--hidden');
        // Auto-trigger Basic Mode analysis
        runAnalysis();
      } catch {
        sampleBtn.textContent = 'Error loading sample';
        setTimeout(() => {
          sampleBtn.textContent = 'Try with a sample screenshot';
          sampleBtn.disabled = false;
        }, 3000);
      }
    });
  }

  clearBtn.addEventListener('click', () => {
    selectedFile = null;
    lastFileKey = null;
    isSampleLoaded = false;
    accumulatedResults = [];
    currentScoreResult = null;
    fileInput.value = '';
    previewBar.classList.remove('preview-bar--visible');
    document.getElementById('progress-bar').classList.remove('progress-bar--visible');
    document.getElementById('detection-summary').classList.remove('detection-summary--visible');
    document.getElementById('detail-panel').classList.remove('detail-panel--visible');
    document.getElementById('priority-ranking').classList.remove('priority-ranking--visible');
    document.getElementById('priority-ranking').innerHTML = '';
    document.getElementById('healthy-banner').classList.remove('healthy-banner--visible');
    const clearancesEl = document.getElementById('clearances-section');
    if (clearancesEl) {
      clearancesEl.innerHTML = '';
      clearancesEl.classList.remove('clearances--visible');
    }
    const validationEl = document.getElementById('validation-info');
    if (validationEl) {
      validationEl.innerHTML = '';
      validationEl.classList.remove('validation-info--visible');
    }
    const layoutWarningEl = document.getElementById('layout-warning');
    if (layoutWarningEl) {
      layoutWarningEl.innerHTML = '';
      layoutWarningEl.classList.remove('layout-warning--visible');
    }
    const ocrFallbackEl = document.getElementById('ocr-fallback');
    if (ocrFallbackEl) {
      ocrFallbackEl.innerHTML = '';
      ocrFallbackEl.classList.remove('ocr-uncertain--visible');
    }
    applySeverityToMatrix({
      cells: recommendationsData.map((r) => ({
        id: r.id,
        score: 0,
        severityLevel: 'none',
        matchedSignals: [],
      })),
      healthStatus: 'none',
    });
    // Restore sample offer
    document.getElementById('sample-offer')?.classList.remove('sample-offer--hidden');
  });
}

function handleFile(file) {
  selectedFile = file;
  const fileKey = `${file.name}:${file.size}:${file.lastModified}`;

  // New file → clear accumulated results
  if (fileKey !== lastFileKey) {
    accumulatedResults = [];
    currentScoreResult = null;
    lastFileKey = fileKey;
  }

  const thumb = document.getElementById('preview-thumb');
  const name = document.getElementById('preview-name');
  const size = document.getElementById('preview-size');
  const previewBar = document.getElementById('preview-bar');

  thumb.src = URL.createObjectURL(file);
  name.textContent = file.name;
  const sampleBadge = isSampleLoaded ? ' <span class="sample-badge">SAMPLE</span>' : '';
  size.innerHTML = `${(file.size / 1024).toFixed(1)} KB${sampleBadge}`;
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

const OCR_CONFIDENCE_THRESHOLD = 0.5;

function reconcileCounters(ocrCounters, visionCounters, ocrConfidence) {
  const ALL_COUNTERS = [
    'successful_logins',
    'failed_logins',
    'concurrent_apex_errors',
    'concurrent_ui_errors',
    'row_lock_errors',
    'total_callout_errors',
  ];
  const reconciled = {};

  for (const key of ALL_COUNTERS) {
    const ocrVal = ocrCounters?.[key];
    const visionVal = visionCounters?.[key];
    const hasOcr = ocrVal !== null && ocrVal !== undefined;
    const hasVision = visionVal !== null && visionVal !== undefined;

    if (hasOcr && hasVision) {
      if (ocrVal === visionVal) {
        reconciled[key] = { value: ocrVal, source: 'both', confidence: 'high' };
      } else if (ocrConfidence >= OCR_CONFIDENCE_THRESHOLD) {
        reconciled[key] = {
          value: ocrVal,
          source: 'ocr_preferred',
          confidence: 'medium',
          ocrValue: ocrVal,
          visionValue: visionVal,
        };
      } else {
        reconciled[key] = {
          value: visionVal,
          source: 'vision_preferred',
          confidence: 'medium',
          ocrValue: ocrVal,
          visionValue: visionVal,
        };
      }
    } else if (hasOcr) {
      reconciled[key] = { value: ocrVal, source: 'ocr', confidence: 'medium' };
    } else if (hasVision) {
      reconciled[key] = { value: visionVal, source: 'vision', confidence: 'low' };
    } else {
      reconciled[key] = { value: null, source: 'none', confidence: 'none' };
    }
  }

  return reconciled;
}

async function runAnalysis() {
  if (!selectedFile) return;

  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressFill = document.getElementById('progress-fill');
  const analyzeBtn = document.getElementById('analyze-btn');

  progressFill.style.background = '';
  progressBar.classList.add('progress-bar--visible');
  analyzeBtn.disabled = true;

  function onProgress(value, label) {
    progressFill.style.width = `${Math.round(value * 100)}%`;
    if (label) progressLabel.textContent = label;
  }

  try {
    if (analysisMode === 'basic') {
      const result = await analyzeWithOCR(selectedFile, onProgress);
      accumulatedResults = accumulatedResults.filter((r) => r.mode !== 'basic');
      accumulatedResults.push(result);
    } else {
      // Deep Analysis: auto-run OCR first for counter accuracy, then Vision
      onProgress(0.02, 'Extracting counters via OCR...');
      let ocrResult = null;
      try {
        ocrResult = await analyzeWithOCR(selectedFile, (v, l) => {
          onProgress(v * 0.3, l); // OCR takes first 30% of progress
        });
      } catch (e) {
        console.warn('OrgPulse: OCR pre-scan failed, continuing with Vision only:', e.message);
      }

      const visionResult = await analyzeWithVision(selectedFile, (v, l) => {
        onProgress(0.3 + v * 0.7, l); // Vision takes remaining 70%
      });

      // Reconcile counters: prefer OCR only when confidence is above threshold
      if (ocrResult && visionResult.counters) {
        const reconciled = reconcileCounters(
          ocrResult.counters,
          visionResult.counters,
          ocrResult.confidence
        );
        visionResult.reconciledCounters = reconciled;

        // Build a basic-mode result from reconciled counters for scoring
        const reconciledBasic = {
          mode: 'basic',
          counters: {},
          confidence: ocrResult.confidence,
          timestamp: ocrResult.timestamp,
          source: 'reconciled',
        };
        for (const [key, entry] of Object.entries(reconciled)) {
          reconciledBasic.counters[key] = entry.value !== null ? entry.value : 0;
        }
        accumulatedResults = accumulatedResults.filter((r) => r.mode !== 'basic');
        accumulatedResults.push(reconciledBasic);
      } else if (ocrResult) {
        accumulatedResults = accumulatedResults.filter((r) => r.mode !== 'basic');
        accumulatedResults.push(ocrResult);
      }

      accumulatedResults = accumulatedResults.filter((r) => r.mode !== 'deep');
      accumulatedResults.push(visionResult);
    }

    displayResults();
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

function displayResults() {
  document.getElementById('progress-bar').classList.remove('progress-bar--visible');

  const summary = document.getElementById('detection-summary');
  summary.classList.add('detection-summary--visible');

  // Layout warning from Vision
  const layoutWarningEl = document.getElementById('layout-warning');
  if (layoutWarningEl) {
    const deepWithWarning = accumulatedResults.find((r) => r.mode === 'deep' && r.layout_warning);
    if (deepWithWarning) {
      layoutWarningEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${deepWithWarning.layout_warning}`;
      layoutWarningEl.classList.add('layout-warning--visible');
    } else {
      layoutWarningEl.innerHTML = '';
      layoutWarningEl.classList.remove('layout-warning--visible');
    }
  }

  // Render counter cards from the latest basic result
  const basicResult = accumulatedResults.find((r) => r.mode === 'basic');
  const deepResult = accumulatedResults.find((r) => r.mode === 'deep');
  const counterContainer = document.getElementById('counter-cards');

  if (basicResult) {
    const counterLabels = {
      successful_logins: 'Successful Logins',
      failed_logins: 'Failed Logins',
      concurrent_apex_errors: 'Concurrent Apex Errors',
      concurrent_ui_errors: 'Concurrent UI Errors',
      row_lock_errors: 'Row Lock Errors',
      total_callout_errors: 'Total Callout Errors',
    };

    // Check if we have reconciled counters from deep analysis
    const reconciled = deepResult?.reconciledCounters;

    // OCR uncertainty fallback banner
    const ocrFallbackEl = document.getElementById('ocr-fallback');
    if (ocrFallbackEl) {
      if (basicResult.ocrCertain === false) {
        ocrFallbackEl.innerHTML = `
          <div class="ocr-uncertain__title">OCR couldn't reliably read this screenshot</div>
          <div class="ocr-uncertain__body">The basic OCR works best on the standard Org Performance layout. Your screenshot may use a different layout version or unusual rendering.</div>
          <div class="ocr-uncertain__action">
            <button class="btn btn--accent" id="switch-to-deep-btn">Switch to Deep Analysis (~$0.02)</button>
            <span class="ocr-uncertain__hint">Uses Claude Vision for layout-agnostic interpretation.</span>
          </div>
        `;
        ocrFallbackEl.classList.add('ocr-uncertain--visible');
        document.getElementById('switch-to-deep-btn')?.addEventListener('click', () => {
          analysisMode = 'deep';
          document.getElementById('mode-deep')?.classList.add('mode-toggle__option--active');
          document.getElementById('mode-basic')?.classList.remove('mode-toggle__option--active');
          runAnalysis();
        });
      } else {
        ocrFallbackEl.innerHTML = '';
        ocrFallbackEl.classList.remove('ocr-uncertain--visible');
      }
    }

    counterContainer.innerHTML = Object.entries(basicResult.counters)
      .map(([key, value]) => {
        let severity = 'ok';
        if (value === null) {
          severity = 'unknown';
        } else if (key !== 'successful_logins' && value > 0) {
          severity = value > 10 ? 'critical' : 'warning';
        }

        let confidenceHtml = '';
        if (reconciled && reconciled[key]) {
          const rc = reconciled[key];
          if (rc.source === 'both') {
            confidenceHtml =
              '<span class="counter-confidence counter-confidence--high" title="OCR and AI agree">&#10003;</span>';
          } else if (rc.source === 'ocr_preferred') {
            confidenceHtml = `<span class="counter-confidence counter-confidence--mismatch" title="OCR: ${rc.ocrValue}, AI: ${rc.visionValue} — OCR preferred">&#8800;</span>`;
          } else if (rc.source === 'vision_preferred') {
            confidenceHtml = `<span class="counter-confidence counter-confidence--mismatch" title="AI: ${rc.visionValue}, OCR: ${rc.ocrValue} — AI preferred, OCR confidence low">&#8800;</span>`;
          } else if (rc.source === 'vision') {
            confidenceHtml =
              '<span class="counter-confidence counter-confidence--ai" title="AI reading only">AI</span>';
          }
        }

        const displayVal = value !== null ? value.toLocaleString() : '—';

        return `
          <div class="counter-card counter-card--${severity}">
            <div class="counter-card__label">${counterLabels[key]}</div>
            <div class="counter-card__value">${displayVal} ${confidenceHtml}</div>
          </div>
        `;
      })
      .join('');
  } else if (deepResult) {
    // Deep-only with Vision counters but no OCR
    const counterLabels = {
      successful_logins: 'Successful Logins',
      failed_logins: 'Failed Logins',
      concurrent_apex_errors: 'Concurrent Apex Errors',
      concurrent_ui_errors: 'Concurrent UI Errors',
      row_lock_errors: 'Row Lock Errors',
      total_callout_errors: 'Total Callout Errors',
    };
    if (deepResult.counters && Object.keys(deepResult.counters).length > 0) {
      counterContainer.innerHTML = Object.entries(counterLabels)
        .map(([key, label]) => {
          const value = deepResult.counters[key];
          const displayVal = value !== null && value !== undefined ? value.toLocaleString() : '—';
          let severity = 'ok';
          if (key !== 'successful_logins' && value > 0) {
            severity = value > 10 ? 'critical' : 'warning';
          }
          return `
            <div class="counter-card counter-card--${severity}">
              <div class="counter-card__label">${label}</div>
              <div class="counter-card__value">${displayVal} <span class="counter-confidence counter-confidence--ai" title="AI reading only">AI</span></div>
            </div>
          `;
        })
        .join('');
    } else {
      counterContainer.innerHTML = `
        <div style="grid-column: 1 / -1; font-size: 0.85rem; color: var(--text-dim); line-height: 1.6;">
          ${deepResult.summary || 'Analysis complete.'}
        </div>
      `;
    }
  }

  // Signals from all accumulated results
  const signals = generateSignals(accumulatedResults, recommendationsData);
  const signalContainer = document.getElementById('signal-tags');
  signalContainer.innerHTML = signals
    .map((s) => `<span class="signal-tag signal-tag--${s.severity}">${s.text}</span>`)
    .join('');

  // Confidence
  const confidenceEl = document.getElementById('confidence-text');
  const parts = [];
  if (basicResult && basicResult.confidence !== undefined) {
    parts.push(`OCR Confidence: ${Math.round(basicResult.confidence * 100)}%`);
  }
  if (deepResult && deepResult.findings) {
    const avgConf =
      deepResult.findings.reduce((sum, f) => sum + (f.confidence || 0), 0) /
      (deepResult.findings.length || 1);
    parts.push(`AI Confidence (avg): ${Math.round(avgConf * 100)}%`);
  }
  confidenceEl.textContent = parts.join(' · ');

  // Clearances from deep analysis
  const clearancesContainer = document.getElementById('clearances-section');
  if (clearancesContainer) {
    const allClearances = accumulatedResults.flatMap((r) => r.clearances || []);
    if (allClearances.length > 0) {
      clearancesContainer.innerHTML = `
        <div class="clearances__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Healthy Areas
        </div>
        <div class="clearances__list">
          ${allClearances.map((c) => `<div class="clearance-item"><span class="clearance-item__metric">${c.metric}</span><span class="clearance-item__text">${c.observation}</span></div>`).join('')}
        </div>
      `;
      clearancesContainer.classList.add('clearances--visible');
    } else {
      clearancesContainer.innerHTML = '';
      clearancesContainer.classList.remove('clearances--visible');
    }
  }

  // Validation info (show filtered findings count)
  const validationEl = document.getElementById('validation-info');
  if (validationEl) {
    const deepResults = accumulatedResults.filter((r) => r.mode === 'deep' && r.validation);
    const totalRejected = deepResults.reduce(
      (sum, r) => sum + (r.validation.rejectedFindings?.length || 0),
      0
    );
    const totalOriginal = deepResults.reduce(
      (sum, r) => sum + (r.validation.originalFindingCount || 0),
      0
    );
    if (totalRejected > 0) {
      const rejectedItems = deepResults
        .flatMap((r) => r.validation.rejectedFindings || [])
        .map((f) => `<span class="validation-rejected-item">${f.metric}</span>`)
        .join('');
      validationEl.innerHTML = `
        <div class="validation-info__text">
          ${totalRejected} of ${totalOriginal} AI observations filtered out (unrecognized metrics).
          <button class="validation-info__toggle" onclick="this.parentElement.nextElementSibling.classList.toggle('validation-rejected--visible'); this.textContent = this.textContent.includes('Show') ? 'Hide' : 'Show filtered'">Show filtered</button>
        </div>
        <div class="validation-rejected">${rejectedItems}</div>
      `;
      validationEl.classList.add('validation-info--visible');
    } else {
      validationEl.innerHTML = '';
      validationEl.classList.remove('validation-info--visible');
    }
  }

  // Calculate scores from all accumulated results
  currentScoreResult = calculateCellScores(accumulatedResults, recommendationsData);

  // Apply severity to matrix cells
  applySeverityToMatrix(currentScoreResult);

  // Render priority ranking
  renderPriorityRanking(currentScoreResult);

  // Emit signals for metadata module auto-piping (local mode)
  const detectedSignalNames = currentScoreResult
    ? currentScoreResult.cells
        .filter((c) => c.score > 0)
        .flatMap((c) => c.matchedSignals.map((s) => s.metric))
    : [];
  if (detectedSignalNames.length > 0) {
    window.dispatchEvent(
      new CustomEvent('orgpulse:screenshot-analysis-complete', {
        detail: { signals: [...new Set(detectedSignalNames)] },
      })
    );
  }

  document.getElementById('matrix-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Render OCR diagnostic panel if debug mode is active
  renderOcrDiagnosticPanel();
}

// ============ OCR Diagnostic Panel ============

const SAMPLE_EXPECTED = {
  successful_logins: 23,
  failed_logins: 0,
  concurrent_apex_errors: 0,
  concurrent_ui_errors: 0,
  row_lock_errors: 2,
  total_callout_errors: 0,
};

function renderOcrDiagnosticPanel() {
  const existing = document.getElementById('ocr-diagnostic-panel');
  if (existing) existing.remove();

  if (typeof localStorage === 'undefined' || localStorage.getItem('orgpulse-ocr-debug') !== 'true')
    return;

  const debugData = window.__orgpulseOcrDebug;
  const sourceCanvas = window.__orgpulseOcrSourceCanvas;
  if (!debugData || debugData.length === 0) return;

  const section = document.createElement('section');
  section.id = 'ocr-diagnostic-panel';
  section.className = 'ocr-diagnostic';

  // Build overlay canvas
  let overlayHtml = '';
  if (sourceCanvas) {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = sourceCanvas.width;
    overlayCanvas.height = sourceCanvas.height;
    const octx = overlayCanvas.getContext('2d');
    octx.drawImage(sourceCanvas, 0, 0);
    octx.strokeStyle = 'magenta';
    octx.lineWidth = 4;
    octx.font = `${Math.round(sourceCanvas.height * 0.008)}px sans-serif`;
    octx.fillStyle = 'magenta';
    for (const entry of debugData) {
      const b = entry.box;
      octx.strokeRect(b.x, b.y, b.w, b.h);
      octx.fillText(entry.counterName, b.x + 4, b.y - 6);
    }
    overlayHtml = `<img src="${overlayCanvas.toDataURL('image/png')}" class="ocr-diag__overlay" alt="Source with extraction boxes"/>
      <div class="ocr-diag__dims">Canvas: ${sourceCanvas.width} x ${sourceCanvas.height}px</div>`;
  }

  // Build per-counter table
  const rows = debugData
    .map((entry) => {
      const expected = SAMPLE_EXPECTED[entry.counterName];
      const match = entry.parsedValue === expected;
      const rowClass = match ? '' : ' class="ocr-diag__mismatch"';
      return `<tr${rowClass}>
      <td>${entry.counterName}</td>
      <td class="ocr-diag__mono">${entry.box.x}, ${entry.box.y}, ${entry.box.w}, ${entry.box.h}</td>
      <td><img src="${entry.preprocessedImage}" class="ocr-diag__tile-img" alt="${entry.counterName} preprocessed"/></td>
      <td class="ocr-diag__mono">${JSON.stringify(entry.rawText)}</td>
      <td><strong>${entry.parsedValue ?? 'null'}</strong></td>
      <td>${entry.confidence?.toFixed(1)}%</td>
      <td>${expected}</td>
    </tr>`;
    })
    .join('');

  section.innerHTML = `
    <details open>
      <summary class="ocr-diag__title">OCR Diagnostic Output</summary>
      <div class="ocr-diag__content">
        <h4>Source image with extraction boxes</h4>
        ${overlayHtml}
        <h4>Per-counter extraction results</h4>
        <div class="ocr-diag__table-wrap">
          <table class="ocr-diag__table">
            <thead><tr>
              <th>Counter</th><th>Box (x,y,w,h)</th><th>Preprocessed</th>
              <th>Raw text</th><th>Parsed</th><th>Confidence</th><th>Expected</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </details>
  `;

  const main = document.querySelector('.main');
  main.appendChild(section);
}

// ============ Start ============

document.addEventListener('DOMContentLoaded', init);
