import '../styles/metadata.css';
import {
  pickProjectDirectory,
  detectProjectLayout,
  runMetadataAnalysis,
} from '../metadata/index.js';

let currentSignals = [];
let currentDirHandle = null;

// ============ Section & Pattern Metadata ============

const ANALYZER_SECTIONS = {
  apexCpuAnalyzer: { sectionId: 'apex', sectionLabel: 'Apex' },
  apexRowLockAnalyzer: { sectionId: 'apex', sectionLabel: 'Apex' },
  flowAnalyzer: { sectionId: 'flow', sectionLabel: 'Flow' },
};

const PATTERN_METADATA = {
  SOQL_IN_LOOP: {
    displayName: 'SOQL in loop',
    explanation:
      'SOQL queries inside for-loops hit the 100 queries-per-transaction governor limit.',
  },
  DML_IN_LOOP: {
    displayName: 'DML in loop',
    explanation: 'DML operations inside for-loops hit the 150 DML-per-transaction limit.',
  },
  DATABASE_DML_IN_LOOP: {
    displayName: 'Database.DML() in loop',
    explanation: 'Database DML calls inside loops hit the same governor limits as direct DML.',
  },
  NESTED_LOOP: {
    displayName: 'Nested loops',
    explanation:
      'Nested for-loops often hide O(n^2) complexity and amplify other issues inside them.',
  },
  UPDATE_WITHOUT_FOR_UPDATE: {
    displayName: 'Read-then-write without FOR UPDATE',
    explanation:
      'Records queried then updated without FOR UPDATE lock can cause row lock contention.',
  },
  BATCH_WITHOUT_ORDER_BY: {
    displayName: 'Batch query without ORDER BY',
    explanation:
      'Batch Apex queries without ORDER BY produce non-deterministic ordering, increasing row lock risk.',
  },
  RT_FLOW_NO_ENTRY_FILTER: {
    displayName: 'RT Flow without entry condition',
    explanation: 'RT Flow fires on every save. Entry filters reduce unnecessary executions.',
  },
  FLOW_RECORD_OP_IN_LOOP: {
    displayName: 'Record operation inside Flow loop',
    explanation:
      'Flow loop contains Get/Create/Update/Delete nodes — Flow equivalent of SOQL-in-loop.',
  },
  MULTIPLE_RT_FLOWS_SAME_TRIGGER: {
    displayName: 'Multiple RT Flows on same trigger',
    explanation:
      'Multiple active RT Flows compound CPU cost on every save. Consolidate via orchestrating Flow.',
  },
  FLOW_SYNC_CALLOUT: {
    displayName: 'Synchronous callout in RT Flow',
    explanation:
      'Synchronous callouts in RT Flows block transactions and cause callout_time spikes.',
  },
};

function getPatternMeta(key) {
  return PATTERN_METADATA[key] || { displayName: key, explanation: '' };
}

// ============ Init ============

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
  const container = document.getElementById('metadata-findings');
  progress.textContent = 'Analyzing...';
  container.innerHTML = '';

  try {
    const result = await runMetadataAnalysis(
      currentSignals,
      (p) => {
        progress.textContent = p.message;
      },
      currentDirHandle
    );
    progress.textContent = `Done. Scanned ${result.fileCount} files, analyzed ${result.analyzedCount}, found ${result.findings.length} findings.`;
    renderGroupedFindings(result.findings, container);
  } catch (err) {
    progress.textContent = `Error: ${err.message}`;
  }
}

// ============ Causal Summary ============

function buildCausalSummary(signals, findings) {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const signalBreakdown = [];

  for (const signal of signals) {
    const related = findings.filter((f) => f.relatedSignals && f.relatedSignals.includes(signal));
    if (related.length === 0) continue;
    const patternCounts = {};
    for (const f of related) {
      const p = f.pattern || 'UNKNOWN';
      patternCounts[p] = (patternCounts[p] || 0) + 1;
    }
    signalBreakdown.push({
      signal,
      count: related.length,
      topPatterns: Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([p, c]) => ({ name: getPatternMeta(p).displayName, count: c })),
    });
  }

  return { total: findings.length, criticalCount, warningCount, infoCount, signalBreakdown };
}

function renderCausalSummary(signals, findings) {
  const s = buildCausalSummary(signals, findings);
  if (s.total === 0) return '';

  const severityLine = [
    s.criticalCount > 0 ? `<span class="summary-critical">${s.criticalCount} critical</span>` : '',
    s.warningCount > 0 ? `<span class="summary-warning">${s.warningCount} warning</span>` : '',
    s.infoCount > 0 ? `<span class="summary-info">${s.infoCount} info</span>` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const signalRows = s.signalBreakdown
    .map(
      (sb) => `
    <li class="signal-breakdown__item">
      <code class="signal-breakdown__name">${sb.signal}</code>
      <span class="signal-breakdown__detail">
        ${sb.count} findings · ${sb.topPatterns.map((tp) => `${tp.name} (${tp.count})`).join(', ')}
      </span>
    </li>`
    )
    .join('');

  return `
    <div class="causal-summary">
      <div class="causal-summary__title">${s.total} findings likely contribute to your Scale Center signals</div>
      <div class="causal-summary__severity">${severityLine}</div>
      ${signalRows ? `<ul class="signal-breakdown">${signalRows}</ul>` : ''}
    </div>`;
}

// ============ Grouped Rendering ============

function groupBySection(findings) {
  const groups = {};
  for (const f of findings) {
    const sec = ANALYZER_SECTIONS[f.analyzer] || { sectionId: 'other', sectionLabel: 'Other' };
    if (!groups[sec.sectionId]) groups[sec.sectionId] = { label: sec.sectionLabel, findings: [] };
    groups[sec.sectionId].findings.push(f);
  }
  return groups;
}

function groupByPattern(findings) {
  const groups = {};
  for (const f of findings) {
    const p = f.pattern || 'UNKNOWN';
    if (!groups[p]) groups[p] = [];
    groups[p].push(f);
  }
  return groups;
}

function renderGroupedFindings(findings, container) {
  if (findings.length === 0) {
    container.innerHTML =
      '<div style="color:var(--green);font-size:0.85rem;padding:0.75rem">No anti-patterns detected for the selected signals.</div>';
    return;
  }

  let html = renderCausalSummary(currentSignals, findings);
  const sections = groupBySection(findings);

  // Render Apex first, then Flow, then others
  const sectionOrder = ['apex', 'flow', 'other'];
  for (const sectionId of sectionOrder) {
    const section = sections[sectionId];
    if (!section) continue;

    const patternGroups = groupByPattern(section.findings);
    const sortedPatterns = Object.entries(patternGroups)
      .map(([pattern, pFindings]) => ({
        pattern,
        findings: pFindings.sort((a, b) => (b.score || 0) - (a.score || 0)),
        totalScore: pFindings.reduce((sum, f) => sum + (f.score || 0), 0),
        criticalCount: pFindings.filter((f) => f.severity === 'critical').length,
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const patternGroupsHtml = sortedPatterns
      .map((pg, idx) => {
        const meta = getPatternMeta(pg.pattern);
        const isOpen = idx < 3 ? ' open' : '';
        const criticalLabel =
          pg.criticalCount > 0
            ? `<span class="pattern-critical">${pg.criticalCount} critical</span>`
            : '';

        const cardsHtml = pg.findings.map((f) => renderFindingCard(f)).join('');

        return `
        <details class="pattern-group"${isOpen}>
          <summary class="pattern-group__header">
            <span class="pattern-chevron">&#9660;</span>
            <span class="pattern-name">${meta.displayName}</span>
            <span class="pattern-count">${pg.findings.length}</span>
            ${criticalLabel}
          </summary>
          ${meta.explanation ? `<div class="pattern-explanation">${meta.explanation}</div>` : ''}
          <div class="pattern-findings">${cardsHtml}</div>
        </details>`;
      })
      .join('');

    html += `
      <details class="finding-section" open>
        <summary class="finding-section__header">
          <span class="section-chevron">&#9660;</span>
          <span class="section-label">${section.label}</span>
          <span class="section-count">${section.findings.length} findings</span>
        </summary>
        <div class="finding-section__body">${patternGroupsHtml}</div>
      </details>`;
  }

  container.innerHTML = html;
}

// ============ Finding Cards ============

function buildTitle(f) {
  const base = getPatternMeta(f.pattern).displayName;

  if (f.analyzer === 'apexCpuAnalyzer' || f.analyzer === 'apexRowLockAnalyzer') {
    const cls = extractClassName(f.file);
    if (f.method) return `${cls}.${f.method}()`;
    if (f.line) return `${cls}:${f.line}`;
    return cls;
  }

  if (f.analyzer === 'flowAnalyzer') {
    if (f.pattern === 'FLOW_RECORD_OP_IN_LOOP' && f.loopName && f.operationName) {
      return `${f.operationName} in ${f.loopName}`;
    }
    if (f.pattern === 'FLOW_SYNC_CALLOUT' && f.actionName) {
      return `${f.actionName} (${f.actionType || 'action'})`;
    }
    if (f.pattern === 'MULTIPLE_RT_FLOWS_SAME_TRIGGER') {
      return `${f.flowCount || ''} flows on ${f.triggerObject || 'object'}`;
    }
    if (f.flowLabel) return f.flowLabel;
  }

  return base;
}

function extractClassName(filePath) {
  if (!filePath) return '';
  const parts = filePath.split('/');
  const name = parts[parts.length - 1];
  return name.replace(/\.(cls|trigger)$/, '');
}

function renderFindingCard(f) {
  const title = buildTitle(f);

  // File location
  let locationHtml = '';
  if (f.flowFiles && f.flowFiles.length > 1) {
    locationHtml = f.flowFiles.map((fp) => `<div class="finding-card__file">${fp}</div>`).join('');
  } else if (f.file) {
    locationHtml = `<div class="finding-card__file">${f.file}${f.line ? ':' + f.line : ''}</div>`;
  }

  // Flow labels for multi-flow findings
  const flowLabelsHtml =
    f.flowLabels && f.flowLabels.length > 0
      ? `<div class="finding-card__flow-list">${f.flowLabels.map((l) => `<span class="finding-card__flow-tag">${l}</span>`).join('')}</div>`
      : '';

  return `
    <div class="finding-card">
      <div class="finding-card__header">
        <span class="finding-card__severity finding-card__severity--${f.severity}">${f.severity}</span>
        <span class="finding-card__confidence">${f.confidence}</span>
        <span class="finding-card__confidence">score: ${f.score}${f.scoreModifiers?.length > 0 ? ` (base ${f.baseScore})` : ''}</span>
      </div>
      ${f.scoreModifiers?.length > 0 ? `<div class="finding-card__modifiers">${f.scoreModifiers.map((m) => `<span class="modifier-tag modifier-tag--${m.delta > 0 ? 'up' : 'down'}">${m.delta > 0 ? '+' : ''}${m.delta} ${m.reason}</span>`).join('')}</div>` : ''}
      <div class="finding-card__title">${title}</div>
      ${locationHtml}
      ${f.contextNote ? `<div class="finding-card__context">${f.contextNote}</div>` : ''}
      ${flowLabelsHtml}
      ${f.snippet ? `<details class="finding-card__snippet-wrap"><summary>Show snippet</summary><pre class="finding-card__snippet finding-card__snippet--visible">${escapeHtml(f.snippet)}</pre></details>` : ''}
    </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
