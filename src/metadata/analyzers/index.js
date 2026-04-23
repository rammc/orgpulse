import * as apexCpuAnalyzer from './apexCpuAnalyzer.js';
import * as apexRowLockAnalyzer from './apexRowLockAnalyzer.js';
import * as flowAnalyzer from './flowAnalyzer.js';
import * as metadataAnalyzer from './metadataAnalyzer.js';

const REGISTRY = {
  apexCpuAnalyzer,
  apexRowLockAnalyzer,
  flowAnalyzer,
  metadataAnalyzer,
};

export function getAnalyzer(id) {
  return REGISTRY[id] || null;
}

export function getAllAnalyzers() {
  return Object.values(REGISTRY);
}
