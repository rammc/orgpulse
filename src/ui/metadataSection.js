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
    whyItMatters:
      'SOQL queries inside for-loops execute once per iteration. With 10 records in the loop and one query per iteration, you have 10 queries. At 100 records, you hit the Apex governor limit and the transaction fails with a runtime exception visible to end users. In bulk contexts (data loads, batch updates, API imports), this pattern reliably breaks production.',
    scaleCenterSymptoms:
      'Scale Center surfaces this as total_cpu_time spikes during bulk operations, apex_execution_time correlated with specific save windows, and in severe cases concurrent_apex_errors as governor limit exceptions pile up.',
    howToFix:
      'Move the SOQL outside the loop. Query once with a WHERE clause using a Set<Id> that collects all iteration targets, then store results in a Map<Id, SObject> for O(1) lookup inside the loop. For Triggers, follow the Trigger Handler pattern and keep all SOQL in the handler constructor or dedicated setup methods.',
  },
  DML_IN_LOOP: {
    displayName: 'DML in loop',
    explanation: 'DML operations inside for-loops hit the 150 DML-per-transaction limit.',
    whyItMatters:
      'Each DML statement inside a loop counts against the 150 DML-per-transaction governor limit. At 150 records in the loop, the transaction fails. Beyond the governor limit, individual DML statements are extremely inefficient — each opens a database transaction. Bulk DML on a collection is 10-100x faster than one DML per record.',
    scaleCenterSymptoms:
      'Scale Center shows elevated total_cpu_time during bulk saves, apex_execution_time spikes correlated with data loads, and concurrent_apex_errors when the governor limit is hit under load.',
    howToFix:
      'Collect modified records into a List or Map inside the loop, then execute a single DML statement after the loop completes. For upserts against large volumes, batch into chunks of 200 records using Database.upsert with allOrNone=false.',
  },
  DATABASE_DML_IN_LOOP: {
    displayName: 'Database.DML() in loop',
    explanation: 'Database DML calls inside loops hit the same governor limits as direct DML.',
    whyItMatters:
      'Database.insert(), Database.update(), and related methods count identically against the 150 DML-per-transaction limit. The only functional difference is the ability to handle partial failures via allOrNone=false. Putting them in a loop amplifies the same governor issue.',
    scaleCenterSymptoms:
      'Same symptoms as regular DML-in-loop: total_cpu_time spikes, apex_execution_time correlated with bulk operations, concurrent_apex_errors at governor boundaries.',
    howToFix:
      'Collect records into a List before the loop, then execute a single Database.upsert(records, false) after the loop. Process the List<Database.SaveResult> returned to handle per-record outcomes.',
  },
  NESTED_LOOP: {
    displayName: 'Nested loops',
    explanation: 'Nested for-loops often hide O(n^2) complexity and amplify other issues.',
    whyItMatters:
      'A loop inside a loop performs O(n x m) operations — with 200 records in each, that is 40,000 iterations. If anything inside the inner loop touches CPU or memory meaningfully, the total transaction cost compounds quickly.',
    scaleCenterSymptoms:
      'Scale Center shows sustained total_cpu_time (not spikes — continuous elevation), sometimes heap_size_errors for large intermediate collections, and slow_transactions correlated with the affected operation.',
    howToFix:
      'If joining two collections, use a Map for O(1) lookup instead of a second loop. If computing a cross product, evaluate whether the algorithm can be rewritten as two sequential passes. If nesting is unavoidable, ensure no SOQL/DML inside.',
  },
  UPDATE_WITHOUT_FOR_UPDATE: {
    displayName: 'Read-then-write without FOR UPDATE',
    explanation: 'Records queried then updated without FOR UPDATE can cause row lock contention.',
    whyItMatters:
      'When multiple transactions read the same records and then update them without an explicit lock, race conditions emerge. The second write either overwrites the first (lost update) or fails with UNABLE_TO_LOCK_ROW.',
    scaleCenterSymptoms:
      'Scale Center shows row_lock_errors as the primary signal. The count may be low in absolute terms, but each instance represents a failed transaction.',
    howToFix:
      'Add FOR UPDATE to the SOQL query: [SELECT Id FROM ... WHERE ... FOR UPDATE]. This explicitly locks the rows for the transaction duration. Alternatively, redesign to avoid read-modify-write sequences.',
  },
  BATCH_WITHOUT_ORDER_BY: {
    displayName: 'Batch query without ORDER BY',
    explanation:
      'Batch Apex queries without ORDER BY produce non-deterministic ordering, increasing row lock risk.',
    whyItMatters:
      'When two batch jobs run against the same object without ORDER BY, records may return in different orders on each execution. If both modify overlapping records, the non-deterministic processing order creates lock contention.',
    scaleCenterSymptoms:
      'row_lock_errors clustered around scheduled batch job execution windows. The errors may be sporadic, making them hard to reproduce.',
    howToFix:
      'Add ORDER BY Id (or another stable key) to the Database.getQueryLocator call. This ensures deterministic processing order, eliminating concurrency-related lock races.',
  },
  RT_FLOW_NO_ENTRY_FILTER: {
    displayName: 'RT Flow without entry condition',
    explanation: 'RT Flow fires on every save. Entry filters reduce unnecessary executions.',
    whyItMatters:
      'A Record-Triggered Flow without entry filters executes on every save of the target object — even when no relevant field changed. On high-volume objects, this multiplies CPU overhead across millions of saves per month.',
    scaleCenterSymptoms:
      'total_cpu_time elevated proportionally to the save volume of the target object. apex_execution_time correlated with any save operation. slow_transactions if the flow itself is non-trivial.',
    howToFix:
      'Add entry condition filters in the Flow Start element. At minimum, check that relevant fields actually changed using ISCHANGED() formulas. Entry filters that exclude 90% of saves reduce the flow cost by 90%.',
  },
  FLOW_RECORD_OP_IN_LOOP: {
    displayName: 'Record operation inside Flow loop',
    explanation:
      'Flow loop contains Get/Create/Update/Delete nodes — Flow equivalent of SOQL-in-loop.',
    whyItMatters:
      'Each Get Records, Create Records, Update Records, or Delete Records node inside a Flow loop executes once per iteration. The same governor limits that apply to Apex apply to Flow. A loop over 50 items with a Get Records inside issues 50 queries.',
    scaleCenterSymptoms:
      'total_cpu_time and apex_execution_time spikes during bulk saves on the trigger object. Governor limit breaches in Flow surface as Apex errors in Scale Center.',
    howToFix:
      'Use a Get Records node BEFORE the loop with a WHERE condition matching all iteration targets. Store results in a collection variable. Inside the loop, filter from the pre-fetched collection. For Create/Update, build a collection inside the loop and use a single node AFTER the loop.',
  },
  MULTIPLE_RT_FLOWS_SAME_TRIGGER: {
    displayName: 'Multiple RT Flows on same trigger',
    explanation: 'Multiple active RT Flows compound CPU cost on every save.',
    whyItMatters:
      'When three RT Flows fire on every Account save, each adds its own CPU cost, decision evaluations, and potential record operations. The flows run sequentially, and their costs sum up.',
    scaleCenterSymptoms:
      'Cumulative total_cpu_time and apex_execution_time that exceeds what any single flow would produce. Compound effect amplified if one flow contains inefficient patterns.',
    howToFix:
      'Consolidate into a single orchestrating flow per trigger-object pair. The orchestrator uses Decision elements to route based on record state. Benefits: deterministic order, shared data access, easier debugging.',
  },
  FLOW_SYNC_CALLOUT: {
    displayName: 'Synchronous callout in RT Flow',
    explanation:
      'Synchronous callouts in RT Flows block transactions and cause callout_time spikes.',
    whyItMatters:
      'A synchronous callout blocks the entire save transaction until the external service responds — up to 120 seconds. During bulk saves, hundreds of callouts execute sequentially. A 500ms callout on an Account save is imperceptible for one save; the same callout during a 1000-record data load takes 500 seconds.',
    scaleCenterSymptoms:
      'callout_time spikes correlated with save operations. total_callout_errors when the external service times out. average_request_time and ui_request_time degrade proportionally to callout latency.',
    howToFix:
      'Move the callout to an asynchronous context. Best option: Platform Events. The flow publishes an event; a separate subscriber handles the callout outside the save transaction. Alternative: Queueable Apex triggered from the flow.',
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

        const DEFAULT_VISIBLE = 5;
        const visibleFindings = pg.findings.slice(0, DEFAULT_VISIBLE);
        const overflowFindings = pg.findings.slice(DEFAULT_VISIBLE);

        const visibleCardsHtml = visibleFindings.map((f) => renderFindingCard(f)).join('');
        const overflowHtml =
          overflowFindings.length > 0
            ? `<details class="pattern-overflow">
      <summary class="pattern-overflow__toggle">Show ${overflowFindings.length} more finding${overflowFindings.length === 1 ? '' : 's'}</summary>
      <div class="pattern-overflow__content">${overflowFindings.map((f) => renderFindingCard(f)).join('')}</div>
    </details>`
            : '';

        return `
        <details class="pattern-group" id="pattern-${pg.pattern.toLowerCase().replace(/_/g, '-')}"${isOpen}>
          <summary class="pattern-group__header">
            <span class="pattern-chevron">&#9660;</span>
            <span class="pattern-name">${meta.displayName}</span>
            <span class="pattern-count">${pg.findings.length}</span>
            ${criticalLabel}
          </summary>
          <div class="pattern-explanation">${meta.explanation}</div>
          ${
            meta.whyItMatters
              ? `
          <details class="pattern-deep-dive">
            <summary class="pattern-deep-dive__toggle">Read more about this pattern</summary>
            <div class="pattern-deep-dive__content">
              <section><h5>Why this matters</h5><p>${meta.whyItMatters}</p></section>
              <section><h5>What Scale Center shows</h5><p>${meta.scaleCenterSymptoms}</p></section>
              <section><h5>How to fix it</h5><p>${meta.howToFix}</p></section>
            </div>
          </details>`
              : ''
          }
          <div class="pattern-findings">${visibleCardsHtml}${overflowHtml}</div>
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
