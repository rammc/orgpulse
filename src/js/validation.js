// Valid metric identifiers — anything else is a hallucination
const VALID_COUNTER_METRICS = new Set([
  'successful_logins',
  'failed_logins',
  'concurrent_apex_errors',
  'concurrent_ui_errors',
  'row_lock_errors',
  'total_callout_errors',
]);

const VALID_CHART_METRICS = new Set([
  'total_execution_errors',
  'average_request_time',
  'total_request_volume',
  'total_cpu_time',
  'total_logins',
  'average_callout_time',
  'total_callout_errors_detail',
]);

const VALID_ALL_METRICS = new Set([...VALID_COUNTER_METRICS, ...VALID_CHART_METRICS]);

const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);
const VALID_ROOT_CAUSES = new Set([
  'compute',
  'data',
  'concurrency',
  'integration',
  'configuration',
]);

export function validateVisionResponse(response) {
  const validated = {
    mode: 'deep',
    counters: {},
    findings: [],
    clearances: [],
    correlations: [],
    summary: '',
    validation: {
      originalFindingCount: 0,
      rejectedFindings: [],
      originalClearanceCount: 0,
      rejectedClearances: [],
      counterCorrections: [],
    },
  };

  // 1. Validate counters
  if (response.counters && typeof response.counters === 'object') {
    for (const [key, value] of Object.entries(response.counters)) {
      if (VALID_COUNTER_METRICS.has(key)) {
        if (value === null || (Number.isInteger(value) && value >= 0)) {
          validated.counters[key] = value;
        } else {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            validated.counters[key] = parsed;
            validated.validation.counterCorrections.push(
              `${key}: corrected "${value}" to ${parsed}`
            );
          } else {
            validated.counters[key] = null;
            validated.validation.counterCorrections.push(
              `${key}: rejected invalid value "${value}", set to null`
            );
          }
        }
      }
    }
  }

  // 2. Validate findings
  if (Array.isArray(response.findings)) {
    validated.validation.originalFindingCount = response.findings.length;
    for (const finding of response.findings) {
      if (!finding.metric || !VALID_ALL_METRICS.has(finding.metric)) {
        validated.validation.rejectedFindings.push({
          metric: finding.metric || 'undefined',
          observation: finding.observation || '',
          reason: 'unknown_metric',
        });
        continue;
      }
      const severity = VALID_SEVERITIES.has(finding.severity) ? finding.severity : 'info';
      const rootCause = VALID_ROOT_CAUSES.has(finding.root_cause_type)
        ? finding.root_cause_type
        : null;
      let confidence = parseFloat(finding.confidence);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        confidence = 0.5;
      }
      validated.findings.push({
        metric: finding.metric,
        severity,
        root_cause_type: rootCause,
        observation: String(finding.observation || ''),
        recommendation_hint: String(finding.recommendation_hint || ''),
        matrix_cell_id: String(finding.matrix_cell_id || ''),
        confidence,
      });
    }
  }

  // 3. Validate clearances
  if (Array.isArray(response.clearances)) {
    validated.validation.originalClearanceCount = response.clearances.length;
    for (const clearance of response.clearances) {
      if (!clearance.metric || !VALID_ALL_METRICS.has(clearance.metric)) {
        validated.validation.rejectedClearances.push({
          metric: clearance.metric || 'undefined',
          reason: 'unknown_metric',
        });
        continue;
      }
      validated.clearances.push({
        metric: clearance.metric,
        observation: String(clearance.observation || ''),
      });
    }
  }

  // 4. Pass through correlations, summary, and layout warning
  if (Array.isArray(response.correlations)) {
    validated.correlations = response.correlations.map((c) => String(c));
  }
  validated.summary = String(response.summary || '');
  if (response.layout_warning) {
    validated.layout_warning = String(response.layout_warning);
  }

  return validated;
}

export function getMetricDisplayName(metricId) {
  const names = {
    successful_logins: 'Successful Logins',
    failed_logins: 'Failed Logins',
    concurrent_apex_errors: 'Concurrent Apex Errors',
    concurrent_ui_errors: 'Concurrent UI Errors',
    row_lock_errors: 'Row Lock Errors',
    total_callout_errors: 'Total Callout Errors',
    total_execution_errors: 'Total Execution Errors',
    average_request_time: 'Avg Request Time (ms)',
    total_request_volume: 'Total Request Volume',
    total_cpu_time: 'Total CPU Time (ms)',
    total_logins: 'Total Logins',
    average_callout_time: 'Avg Callout Time (ms)',
    total_callout_errors_detail: 'Callout Errors (Detail)',
  };
  return names[metricId] || metricId;
}
