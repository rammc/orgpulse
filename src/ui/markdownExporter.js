// ============ Markdown Report Exporter ============

const PATTERN_INFO = {
  SOQL_IN_LOOP: {
    displayName: 'SOQL in loop',
    whyItMatters:
      'SOQL queries inside for-loops execute once per iteration. With 10 records and one query per iteration, you have 10 queries. At 100, you hit the governor limit.',
    scaleCenterSymptoms:
      'Scale Center shows total_cpu_time spikes during bulk operations, apex_execution_time correlated with save windows.',
    howToFix:
      'Move the SOQL outside the loop. Query once with WHERE using a Set<Id>, store in a Map for O(1) lookup inside the loop.',
  },
  DML_IN_LOOP: {
    displayName: 'DML in loop',
    whyItMatters:
      'Each DML inside a loop counts against the 150 DML-per-transaction limit. Bulk DML is 10-100x faster.',
    scaleCenterSymptoms:
      'Elevated total_cpu_time during bulk saves, concurrent_apex_errors at governor boundaries.',
    howToFix:
      'Collect records into a List inside the loop, execute a single DML after the loop completes.',
  },
  DATABASE_DML_IN_LOOP: {
    displayName: 'Database.DML() in loop',
    whyItMatters:
      'Database.insert/update methods hit the same 150 DML limit. Putting them in loops amplifies the issue.',
    scaleCenterSymptoms: 'Same as DML-in-loop: total_cpu_time spikes, concurrent_apex_errors.',
    howToFix:
      'Collect records before the loop, execute single Database.upsert(records, false) after.',
  },
  NESTED_LOOP: {
    displayName: 'Nested loops',
    whyItMatters:
      'O(n*m) complexity — with 200 records in each loop, 40,000 iterations compound any per-iteration cost.',
    scaleCenterSymptoms: 'Sustained total_cpu_time elevation, slow_transactions.',
    howToFix: 'Use a Map for O(1) lookup instead of a second loop. Ensure no SOQL/DML inside.',
  },
  UPDATE_WITHOUT_FOR_UPDATE: {
    displayName: 'Read-then-write without FOR UPDATE',
    whyItMatters:
      'Multiple transactions reading then updating same records without locks cause race conditions and UNABLE_TO_LOCK_ROW.',
    scaleCenterSymptoms: 'row_lock_errors as the primary signal.',
    howToFix: 'Add FOR UPDATE to the SOQL query, or redesign to avoid read-modify-write sequences.',
  },
  BATCH_WITHOUT_ORDER_BY: {
    displayName: 'Batch query without ORDER BY',
    whyItMatters:
      'Non-deterministic ordering creates lock contention when multiple batch jobs run concurrently.',
    scaleCenterSymptoms: 'row_lock_errors clustered around batch execution windows.',
    howToFix: 'Add ORDER BY Id to the Database.getQueryLocator call.',
  },
  RT_FLOW_NO_ENTRY_FILTER: {
    displayName: 'RT Flow without entry condition',
    whyItMatters:
      'Executes on every save of the target object, even when no relevant field changed.',
    scaleCenterSymptoms: 'total_cpu_time elevated proportionally to save volume.',
    howToFix: 'Add entry condition filters in the Flow Start element using ISCHANGED() formulas.',
  },
  FLOW_RECORD_OP_IN_LOOP: {
    displayName: 'Record operation inside Flow loop',
    whyItMatters:
      'Each Get/Create/Update/Delete node inside a loop executes per iteration, hitting governor limits.',
    scaleCenterSymptoms: 'total_cpu_time and apex_execution_time spikes during bulk saves.',
    howToFix:
      'Use Get Records BEFORE the loop, store in a collection, filter inside the loop without queries.',
  },
  MULTIPLE_RT_FLOWS_SAME_TRIGGER: {
    displayName: 'Multiple RT Flows on same trigger',
    whyItMatters:
      'Multiple flows compound CPU cost on every save. Costs sum, ordering is unpredictable.',
    scaleCenterSymptoms: 'Cumulative total_cpu_time exceeding what any single flow produces.',
    howToFix: 'Consolidate into a single orchestrating flow per trigger-object pair.',
  },
  FLOW_SYNC_CALLOUT: {
    displayName: 'Synchronous callout in RT Flow',
    whyItMatters:
      'Blocks the entire save transaction until the external service responds. A 500ms callout on 1000 records takes 500 seconds.',
    scaleCenterSymptoms:
      'callout_time spikes, total_callout_errors, average_request_time degradation.',
    howToFix:
      'Move to Platform Events for async callout. The flow publishes an event; a subscriber handles the callout outside the transaction.',
  },
};

const ANALYZER_SECTIONS = {
  apexCpuAnalyzer: 'Apex',
  apexRowLockAnalyzer: 'Apex',
  flowAnalyzer: 'Flow',
};

function getInfo(pattern) {
  return PATTERN_INFO[pattern] || { displayName: pattern };
}

// ============ Header ============

function buildHeader(result) {
  const date = result.analyzedAt
    ? new Date(result.analyzedAt).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : 'unknown';
  return [
    '# OrgPulse Findings Report',
    '',
    `**Project:** \`${result.projectName || 'unknown-project'}\`  `,
    `**Generated:** ${date}  `,
    `**Layout:** ${result.layout?.layout || 'unknown'} (${result.layout?.confidence || 'unknown'})  `,
    `**Files scanned:** ${result.fileCount ?? 0} | **Analyzed:** ${result.analyzedCount ?? 0}  `,
    `**Analyzers:** ${(result.analyzersUsed || []).join(', ') || 'none'}`,
    '',
    '---',
    '',
  ].join('\n');
}

// ============ Executive Summary ============

function buildExecutiveSummary(findings) {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;

  const lines = [
    '## Executive Summary',
    '',
    `**Total findings:** ${findings.length}`,
    '',
    '| Severity | Count |',
    '|----------|-------|',
    `| Critical | ${critical} |`,
    `| Warning  | ${warning} |`,
    `| Info     | ${info} |`,
    '',
  ];

  // Hotspot files — top 5 files with the most findings
  const fileCounts = {};
  for (const f of findings) {
    const file = f.file || '(unknown)';
    fileCounts[file] = (fileCounts[file] || 0) + 1;
  }
  const hotspots = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (hotspots.length > 0) {
    lines.push('### Hotspot Files');
    lines.push('');
    for (const [file, count] of hotspots) {
      lines.push(`- \`${file}\` — ${count} finding${count === 1 ? '' : 's'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============ Causal Summary ============

function buildCausalSummary(findings, screenshotSignals) {
  const lines = ['## Causal Summary', ''];

  if (!screenshotSignals || screenshotSignals.length === 0) {
    lines.push('No screenshot signals were provided for causal mapping.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`**Screenshot signals:** ${screenshotSignals.map((s) => '`' + s + '`').join(', ')}`);
  lines.push('');

  for (const signal of screenshotSignals) {
    const related = findings.filter((f) => f.relatedSignals && f.relatedSignals.includes(signal));
    if (related.length === 0) continue;

    const patternCounts = {};
    for (const f of related) {
      const p = f.pattern || 'UNKNOWN';
      patternCounts[p] = (patternCounts[p] || 0) + 1;
    }

    lines.push(`### \`${signal}\` — ${related.length} finding${related.length === 1 ? '' : 's'}`);
    lines.push('');
    for (const [pattern, count] of Object.entries(patternCounts).sort((a, b) => b[1] - a[1])) {
      const name = getInfo(pattern).displayName;
      lines.push(`- **${name}** x${count}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============ Detailed Findings ============

function buildFindingTitle(f) {
  const info = getInfo(f.pattern);
  const base = info.displayName;

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

function buildFindingBlock(f) {
  const title = buildFindingTitle(f);
  const info = getInfo(f.pattern);
  const lines = [];

  lines.push(`#### ${title}`);
  lines.push('');
  lines.push(
    `**Severity:** ${f.severity} | **Confidence:** ${f.confidence} | **Score:** ${f.score}${f.scoreModifiers?.length > 0 ? ` (base ${f.baseScore})` : ''}`
  );

  if (f.scoreModifiers?.length > 0) {
    const mods = f.scoreModifiers.map((m) => `${m.delta > 0 ? '+' : ''}${m.delta} ${m.reason}`);
    lines.push(`**Modifiers:** ${mods.join(', ')}`);
  }

  if (f.file) {
    lines.push(`**File:** \`${f.file}${f.line ? ':' + f.line : ''}\``);
  }

  if (f.contextNote) {
    lines.push(`**Context:** ${f.contextNote}`);
  }

  lines.push('');

  if (info.whyItMatters) {
    lines.push('> **Why this matters:** ' + info.whyItMatters);
    lines.push('');
  }

  if (info.howToFix) {
    lines.push('> **How to fix:** ' + info.howToFix);
    lines.push('');
  }

  if (f.snippet) {
    const lang = f.analyzer === 'flowAnalyzer' ? 'xml' : 'apex';
    lines.push('```' + lang);
    lines.push(f.snippet);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function buildDetailedFindings(findings) {
  if (findings.length === 0) {
    return '## Detailed Findings\n\nNo findings to report.\n\n';
  }

  const lines = ['## Detailed Findings', ''];

  // Group by section (Apex / Flow / Other)
  const sections = {};
  for (const f of findings) {
    const section = ANALYZER_SECTIONS[f.analyzer] || 'Other';
    if (!sections[section]) sections[section] = [];
    sections[section].push(f);
  }

  const sectionOrder = ['Apex', 'Flow', 'Other'];
  for (const sectionName of sectionOrder) {
    const sectionFindings = sections[sectionName];
    if (!sectionFindings || sectionFindings.length === 0) continue;

    lines.push(`### ${sectionName}`);
    lines.push('');

    // Group by pattern within section
    const patternGroups = {};
    for (const f of sectionFindings) {
      const p = f.pattern || 'UNKNOWN';
      if (!patternGroups[p]) patternGroups[p] = [];
      patternGroups[p].push(f);
    }

    const sortedPatterns = Object.entries(patternGroups)
      .map(([pattern, pFindings]) => ({
        pattern,
        findings: pFindings.sort((a, b) => (b.score || 0) - (a.score || 0)),
        totalScore: pFindings.reduce((sum, f) => sum + (f.score || 0), 0),
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    for (const pg of sortedPatterns) {
      const info = getInfo(pg.pattern);
      lines.push(
        `**Pattern: ${info.displayName}** (${pg.findings.length} finding${pg.findings.length === 1 ? '' : 's'}, total score ${pg.totalScore})`
      );
      lines.push('');
      for (const f of pg.findings) {
        lines.push(buildFindingBlock(f));
      }
    }
  }

  return lines.join('\n');
}

// ============ Appendix ============

function buildAppendix(result, screenshotSignals) {
  const lines = ['## Appendix', ''];

  lines.push('### Screenshot Signals');
  lines.push('');
  if (screenshotSignals && screenshotSignals.length > 0) {
    for (const s of screenshotSignals) {
      lines.push(`- \`${s}\``);
    }
  } else {
    lines.push('No screenshot signals were provided.');
  }
  lines.push('');

  lines.push('### Analyzers Used');
  lines.push('');
  for (const a of result.analyzersUsed || []) {
    lines.push(`- ${a}`);
  }
  lines.push('');

  if (result.diagnostics?.skippedFiles?.length > 0) {
    lines.push('### Skipped Files');
    lines.push('');
    for (const sf of result.diagnostics.skippedFiles) {
      lines.push(`- \`${sf.path}\` — ${sf.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============ Footer ============

function buildFooter() {
  return [
    '---',
    '',
    '*Generated by [OrgPulse](https://github.com/rammc/orgpulse) — diagnose your Salesforce org from a single Scale Center screenshot.*',
    '',
  ].join('\n');
}

// ============ Public API ============

export function buildMarkdownReport(analysisResult, screenshotSignals) {
  const findings = analysisResult.findings || [];
  const signals = screenshotSignals || [];

  return [
    buildHeader(analysisResult),
    buildExecutiveSummary(findings),
    buildCausalSummary(findings, signals),
    buildDetailedFindings(findings),
    buildAppendix(analysisResult, signals),
    buildFooter(),
  ].join('');
}

export function downloadMarkdownReport(analysisResult, screenshotSignals) {
  const markdown = buildMarkdownReport(analysisResult, screenshotSignals);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orgpulse-report-${analysisResult.projectName || 'report'}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
