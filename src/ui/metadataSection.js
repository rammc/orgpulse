import '../styles/metadata.css';
import {
  pickProjectDirectory,
  detectProjectLayout,
  runMetadataAnalysis,
} from '../metadata/index.js';

let currentSignals = [];
let currentDirHandle = null;

export function initMetadataSection() {
  renderSection();
  window.addEventListener('orgpulse:screenshot-analysis-complete', (e) => {
    currentSignals = e.detail.signals || [];
    updateSignalsDisplay();
  });
}

function renderSection() {
  const section = document.createElement('section');
  section.id = 'metadata-section';
  section.className = 'metadata-section';
  section.innerHTML = `
    <div class="metadata-section__header">
      <h2 class="metadata-section__title">Metadata Analysis</h2>
      <span class="metadata-section__badge">Local Mode</span>
    </div>
    <p class="metadata-section__subtitle">Pinpoint specific Apex classes, triggers, and Flows causing the detected performance issues.</p>
    <div class="metadata-section__signals" id="metadata-signals">
      <p style="color:var(--text-muted);font-size:0.8rem">Upload and analyze a screenshot to auto-populate signals.</p>
    </div>
    <div class="metadata-section__actions">
      <button class="btn btn--primary" id="metadata-pick-btn" disabled>Pick SFDX project folder</button>
      <button class="btn btn--accent" id="metadata-analyze-btn" disabled>Run metadata analysis</button>
    </div>
    <div class="metadata-section__info" id="metadata-info"></div>
    <div class="metadata-section__progress" id="metadata-progress"></div>
    <div class="metadata-section__findings" id="metadata-findings"></div>
  `;

  const detailPanel = document.getElementById('detail-panel');
  if (detailPanel) {
    detailPanel.parentNode.insertBefore(section, detailPanel.nextSibling);
  } else {
    document.querySelector('.main').appendChild(section);
  }

  document.getElementById('metadata-pick-btn').addEventListener('click', handlePick);
  document.getElementById('metadata-analyze-btn').addEventListener('click', handleAnalyze);

  const footerP = document.querySelector('.footer p');
  if (footerP) {
    const indicator = document.createElement('span');
    indicator.className = 'metadata-mode-indicator';
    indicator.textContent = ' · Local mode · metadata analysis enabled';
    footerP.appendChild(indicator);
  }
}

function updateSignalsDisplay() {
  const el = document.getElementById('metadata-signals');
  if (!el) return;
  if (currentSignals.length === 0) {
    el.innerHTML =
      '<p style="color:var(--text-muted);font-size:0.8rem">Upload and analyze a screenshot to auto-populate signals.</p>';
    return;
  }
  el.innerHTML = currentSignals.map((s) => `<span class="signal-pill">${s}</span>`).join(' ');
  document.getElementById('metadata-pick-btn').disabled = false;
}

async function handlePick() {
  try {
    currentDirHandle = await pickProjectDirectory();
    if (!currentDirHandle) return;
    const layout = await detectProjectLayout(currentDirHandle);
    document.getElementById('metadata-info').textContent =
      `Layout: ${layout.layout} (${layout.confidence})${layout.warning ? ' — ' + layout.warning : ''}`;
    document.getElementById('metadata-analyze-btn').disabled = currentSignals.length === 0;
  } catch (err) {
    document.getElementById('metadata-info').textContent = `Error: ${err.message}`;
  }
}

async function handleAnalyze() {
  const progress = document.getElementById('metadata-progress');
  const findings = document.getElementById('metadata-findings');
  progress.textContent = 'Analyzing...';
  findings.innerHTML = '';

  try {
    const result = await runMetadataAnalysis(
      currentSignals,
      (p) => {
        progress.textContent = p.message;
      },
      currentDirHandle
    );
    progress.textContent = `Done. Scanned ${result.fileCount} files, analyzed ${result.analyzedCount}, found ${result.findings.length} findings.`;
    renderMetadataFindings(result.findings, findings);
  } catch (err) {
    progress.textContent = `Error: ${err.message}`;
  }
}

function renderMetadataFindings(list, container) {
  if (list.length === 0) {
    container.innerHTML =
      '<div style="color:var(--green);font-size:0.85rem;padding:0.75rem">No anti-patterns detected for the selected signals.</div>';
    return;
  }
  container.innerHTML = list
    .map(
      (f) => `
    <div class="finding-card">
      <div class="finding-card__header">
        <span class="finding-card__severity finding-card__severity--${f.severity}">${f.severity}</span>
        <span class="finding-card__confidence">${f.confidence}</span>
        <span class="finding-card__confidence">score: ${f.score}</span>
      </div>
      <div class="finding-card__title">${f.name}</div>
      <div class="finding-card__file">${f.file}${f.line ? ':' + f.line : ''}${f.method ? ' (' + f.method + ')' : ''}</div>
      <div class="finding-card__desc">${f.description}</div>
      ${f.contextNote ? '<div class="finding-card__context">' + f.contextNote + '</div>' : ''}
      ${f.snippet ? '<details><summary style="font-size:0.72rem;color:var(--accent);cursor:pointer">Show snippet</summary><pre class="finding-card__snippet finding-card__snippet--visible">' + escapeHtml(f.snippet) + '</pre></details>' : ''}
    </div>
  `
    )
    .join('');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
