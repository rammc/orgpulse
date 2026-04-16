/**
 * Match analysis results to matrix cell recommendations.
 *
 * @param {object} analysisResult - Output from OCR or Vision analysis
 * @param {Array} recommendationsData - The full recommendations.json array
 * @returns {Array<{cellId: string, reasons: string[]}>} Cells to highlight with reasons
 */
export function matchRecommendations(analysisResult, recommendationsData) {
  const highlights = new Map(); // cellId -> Set of reasons

  function addHighlight(cellId, reason) {
    if (!highlights.has(cellId)) {
      highlights.set(cellId, new Set());
    }
    highlights.get(cellId).add(reason);
  }

  if (analysisResult.mode === 'basic') {
    const c = analysisResult.counters;

    if (c.concurrent_apex_errors > 0) {
      addHighlight('quick-wins', `Concurrent Apex Errors: ${c.concurrent_apex_errors}`);
      addHighlight('prioritize', `Concurrent Apex Errors: ${c.concurrent_apex_errors}`);
    }

    if (c.row_lock_errors > 0) {
      addHighlight('prioritize', `Row Lock Errors: ${c.row_lock_errors}`);
    }

    if (c.total_callout_errors > 0) {
      addHighlight('evaluate', `Total Callout Errors: ${c.total_callout_errors}`);
      addHighlight('take-along', `Callout Errors detected: ${c.total_callout_errors}`);
    }

    if (c.failed_logins > 0) {
      addHighlight('evaluate', `Failed Logins: ${c.failed_logins}`);
    }

    if (c.concurrent_ui_errors > 0) {
      addHighlight('weigh-up', `Concurrent UI Errors: ${c.concurrent_ui_errors}`);
    }

    // High login count may indicate scaling needs
    if (c.successful_logins > 1000) {
      addHighlight('strategic', `High login volume: ${c.successful_logins}`);
    }
  }

  if (analysisResult.mode === 'deep' && analysisResult.findings) {
    for (const finding of analysisResult.findings) {
      if (finding.matrix_cell_id) {
        const cellExists = recommendationsData.some((r) => r.id === finding.matrix_cell_id);
        if (cellExists) {
          const severity =
            finding.severity === 'critical' ? '🔴' : finding.severity === 'warning' ? '🟡' : '🔵';
          addHighlight(finding.matrix_cell_id, `${severity} ${finding.observation}`);
        }
      }
    }
  }

  return Array.from(highlights.entries()).map(([cellId, reasons]) => ({
    cellId,
    reasons: Array.from(reasons),
  }));
}

/**
 * Generate detection signals from analysis results for display.
 */
export function generateSignals(analysisResult) {
  const signals = [];

  if (analysisResult.mode === 'basic') {
    const c = analysisResult.counters;

    if (c.concurrent_apex_errors > 0) {
      signals.push({
        text: `Concurrent Apex Errors: ${c.concurrent_apex_errors}`,
        severity: 'critical',
      });
    }
    if (c.row_lock_errors > 0) {
      signals.push({ text: `Row Lock Errors: ${c.row_lock_errors}`, severity: 'critical' });
    }
    if (c.concurrent_ui_errors > 0) {
      signals.push({
        text: `Concurrent UI Errors: ${c.concurrent_ui_errors}`,
        severity: 'warning',
      });
    }
    if (c.total_callout_errors > 0) {
      signals.push({ text: `Callout Errors: ${c.total_callout_errors}`, severity: 'warning' });
    }
    if (c.failed_logins > 0) {
      signals.push({ text: `Failed Logins: ${c.failed_logins}`, severity: 'warning' });
    }
    if (c.successful_logins > 0) {
      signals.push({ text: `Active Logins: ${c.successful_logins}`, severity: 'info' });
    }
  }

  if (analysisResult.mode === 'deep' && analysisResult.findings) {
    for (const finding of analysisResult.findings) {
      signals.push({
        text: finding.observation,
        severity: finding.severity,
      });
    }
  }

  return signals;
}
