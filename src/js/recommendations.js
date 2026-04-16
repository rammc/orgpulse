// Score-to-severity-level mapping
const SEVERITY_LEVELS = { NONE: 'none', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const VISION_SEVERITY_POINTS = { info: 1, warning: 3, critical: 5 };

function scoreTolevel(score) {
  if (score === 0) return SEVERITY_LEVELS.NONE;
  if (score <= 3) return SEVERITY_LEVELS.LOW;
  if (score <= 7) return SEVERITY_LEVELS.MEDIUM;
  return SEVERITY_LEVELS.HIGH;
}

/**
 * Evaluate a counter value against a trigger signal's thresholds.
 * Returns { severity, points } or null if no match.
 */
function evaluateMetricSignal(value, signal) {
  if (value <= 0) return null;

  // New format: thresholds + points
  if (signal.thresholds && signal.points) {
    for (const level of ['critical', 'warning', 'info']) {
      const t = signal.thresholds[level];
      if (!t) continue;
      const min = t.min || 0;
      const max = t.max || Infinity;
      if (value >= min && value <= max) {
        return { severity: level, points: signal.points[level] || 1 };
      }
    }
    return null;
  }

  // Legacy format: no thresholds → binary match, 1 point
  return { severity: 'info', points: 1 };
}

/**
 * Get a counter value from the analysis result by metric name.
 */
function getCounterValue(counters, metric) {
  if (!counters) return 0;
  return counters[metric] || 0;
}

/**
 * Calculate scored results for all matrix cells.
 *
 * @param {object|object[]} analysisInput - Single result or array of results to merge
 * @param {Array} recommendationsData - The full recommendations.json array
 * @returns {object} Scored result with cells, totalScore, healthStatus, etc.
 */
export function calculateCellScores(analysisInput, recommendationsData) {
  // Normalize input: merge multiple results into combined counters + findings
  const results = Array.isArray(analysisInput) ? analysisInput : [analysisInput];
  let counters = null;
  let findings = [];
  const sources = [];

  for (const r of results) {
    if (r.mode === 'basic' && r.counters) {
      counters = r.counters;
      if (!sources.includes('basic')) sources.push('basic');
    }
    if (r.mode === 'deep' && r.findings) {
      findings = findings.concat(r.findings);
      if (!sources.includes('deep')) sources.push('deep');
    }
  }

  let clearances = [];
  for (const r of results) {
    if (r.clearances) {
      clearances = clearances.concat(r.clearances);
    }
  }

  const cells = [];
  let totalScore = 0;
  let highestScore = 0;
  let highestSeverityCell = null;

  for (const cell of recommendationsData) {
    const matchedSignals = [];

    // Evaluate metric-based trigger signals against counters
    if (counters) {
      for (const signal of cell.trigger_signals) {
        if (!signal.metric) continue;
        const value = getCounterValue(counters, signal.metric);
        const result = evaluateMetricSignal(value, signal);
        if (result) {
          matchedSignals.push({
            metric: signal.metric,
            value,
            severity: result.severity,
            points: result.points,
          });
        }
      }
    }

    // Evaluate vision findings that reference this cell
    for (const finding of findings) {
      if (finding.matrix_cell_id !== cell.id) continue;
      const cellExists = recommendationsData.some((r) => r.id === finding.matrix_cell_id);
      if (!cellExists) {
        console.warn(
          `OrgPulse: Vision finding references unknown cell "${finding.matrix_cell_id}"`
        );
        continue;
      }
      const points = VISION_SEVERITY_POINTS[finding.severity] || 1;
      matchedSignals.push({
        metric: finding.metric || finding.observation,
        value: null,
        severity: finding.severity || 'info',
        points,
        source: 'vision',
        rootCauseType: finding.root_cause_type || null,
        recommendationHint: finding.recommendation_hint || null,
      });
    }

    const score = matchedSignals.reduce((sum, s) => sum + s.points, 0);
    const severityLevel = scoreTolevel(score);

    cells.push({
      id: cell.id,
      score,
      severityLevel,
      matchedSignals,
    });

    totalScore += score;
    if (score > highestScore) {
      highestScore = score;
      highestSeverityCell = cell.id;
    }
  }

  const allZero = cells.every((c) => c.score === 0);

  return {
    cells,
    totalScore,
    highestSeverityCell,
    healthStatus: allZero ? 'healthy' : 'issues_detected',
    sources,
    clearances,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate detection signals for the Detection Summary display.
 * Uses JSON thresholds for severity determination.
 */
export function generateSignals(analysisInput, recommendationsData) {
  const results = Array.isArray(analysisInput) ? analysisInput : [analysisInput];
  const signals = [];

  for (const analysisResult of results) {
    if (analysisResult.mode === 'basic' && analysisResult.counters) {
      const c = analysisResult.counters;
      const allSignals = recommendationsData
        ? recommendationsData.flatMap((r) => r.trigger_signals)
        : [];

      const counterLabels = {
        concurrent_apex_errors: 'Concurrent Apex Errors',
        row_lock_errors: 'Row Lock Errors',
        concurrent_ui_errors: 'Concurrent UI Errors',
        total_callout_errors: 'Callout Errors',
        failed_logins: 'Failed Logins',
        successful_logins: 'Active Logins',
      };

      for (const [key, label] of Object.entries(counterLabels)) {
        const value = c[key] || 0;
        if (value <= 0) continue;

        // Find the best matching threshold across all cells for this metric
        let bestSeverity = 'info';
        for (const signal of allSignals) {
          if (signal.metric !== key || !signal.thresholds) continue;
          const result = evaluateMetricSignal(value, signal);
          if (result) {
            const rank = { critical: 3, warning: 2, info: 1 };
            if ((rank[result.severity] || 0) > (rank[bestSeverity] || 0)) {
              bestSeverity = result.severity;
            }
          }
        }

        signals.push({ text: `${label}: ${value}`, severity: bestSeverity });
      }
    }

    if (analysisResult.mode === 'deep' && analysisResult.findings) {
      for (const finding of analysisResult.findings) {
        signals.push({ text: finding.observation, severity: finding.severity || 'info' });
      }
    }
  }

  return signals;
}

/**
 * Filter recommendations within a cell by matched signal relevance.
 * Returns { relevant, hidden, totalCount }.
 */
export function filterRecommendations(cellData, matchedSignals) {
  const detectedMetrics = new Set(matchedSignals.map((s) => s.metric));
  const detectedRootCauses = new Set(
    matchedSignals.filter((s) => s.rootCauseType).map((s) => s.rootCauseType)
  );

  const scored = cellData.recommendations.map((rec) => {
    const signals = rec.relevant_signals || ['*'];
    const rootCauses = rec.root_cause_types || [];
    const isWildcard = signals.includes('*');
    const signalMatch = isWildcard || signals.some((s) => detectedMetrics.has(s));
    const rootCauseMatch =
      rootCauses.length > 0 && rootCauses.some((rc) => detectedRootCauses.has(rc));

    let relevanceScore = 0;
    if (signalMatch && rootCauseMatch) relevanceScore = 3;
    else if (signalMatch && !isWildcard) relevanceScore = 2;
    else if (isWildcard) relevanceScore = 1;

    return { rec, signalMatch, relevanceScore };
  });

  const relevant = scored
    .filter((s) => s.signalMatch)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  const hidden = scored.filter((s) => !s.signalMatch);

  return {
    relevant: relevant.map((s) => s.rec),
    hidden: hidden.map((s) => s.rec),
    totalCount: cellData.recommendations.length,
  };
}

/**
 * Get AI-generated insights (recommendation hints and correlations) for a specific cell.
 */
export function getAIInsightsForCell(cellId, results) {
  const allResults = Array.isArray(results) ? results : [results];
  const hints = [];
  const correlations = [];

  for (const r of allResults) {
    if (r.mode !== 'deep') continue;
    if (r.findings) {
      for (const f of r.findings) {
        if (f.matrix_cell_id === cellId && f.recommendation_hint) {
          hints.push(f.recommendation_hint);
        }
      }
    }
    if (r.correlations) {
      correlations.push(...r.correlations);
    }
  }

  return { hints, correlations };
}

// Keep for backward compatibility — delegates to calculateCellScores
export function matchRecommendations(analysisResult, recommendationsData) {
  const scoreResult = calculateCellScores(analysisResult, recommendationsData);
  return scoreResult.cells
    .filter((c) => c.score > 0)
    .map((c) => ({
      cellId: c.id,
      reasons: c.matchedSignals.map(
        (s) => `${s.metric}: ${s.value !== null ? s.value : 'detected'} (${s.severity})`
      ),
    }));
}
