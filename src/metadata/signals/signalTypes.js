export const SIGNAL_CATEGORIES = {
  CPU: ['total_cpu_time', 'apex_execution_time', 'slow_transactions'],
  ROW_LOCKS: ['row_lock_errors', 'concurrent_dml'],
  CALLOUTS: ['total_callout_errors', 'callout_time', 'error_rate'],
  UI: ['concurrent_ui_errors', 'ui_request_time', 'average_request_time'],
  QUERY: ['db_cpu_time', 'slow_soql', 'full_table_scan'],
  CONCURRENCY: ['concurrent_apex_errors', 'concurrent_requests'],
};

export const ALL_SIGNALS = Object.values(SIGNAL_CATEGORIES).flat();

export function categorizeSignal(signalName) {
  for (const [category, signals] of Object.entries(SIGNAL_CATEGORIES)) {
    if (signals.includes(signalName)) return category;
  }
  return null;
}
