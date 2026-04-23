import { categorizeSignal } from './signalTypes.js';

const SIGNAL_TO_ANALYZERS = {
  CPU: ['apexCpuAnalyzer', 'flowAnalyzer', 'metadataAnalyzer'],
  ROW_LOCKS: ['apexRowLockAnalyzer', 'metadataAnalyzer'],
  QUERY: ['apexCpuAnalyzer', 'flowAnalyzer'],
  CONCURRENCY: ['apexCpuAnalyzer', 'apexRowLockAnalyzer', 'flowAnalyzer', 'metadataAnalyzer'],
  CALLOUTS: ['flowAnalyzer'],
};

export function getAnalyzersForSignals(signals) {
  const categories = new Set(signals.map((s) => categorizeSignal(s)).filter(Boolean));
  const analyzerSet = new Set();
  for (const category of categories) {
    const analyzers = SIGNAL_TO_ANALYZERS[category] || [];
    analyzers.forEach((a) => analyzerSet.add(a));
  }
  return Array.from(analyzerSet);
}
