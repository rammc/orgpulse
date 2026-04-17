import * as apexCpuAnalyzer from './apexCpuAnalyzer.js';
import * as apexRowLockAnalyzer from './apexRowLockAnalyzer.js';
import * as flowAnalyzer from './flowAnalyzer.js';

const REGISTRY = {
  apexCpuAnalyzer,
  apexRowLockAnalyzer,
  flowAnalyzer,
};

export function getAnalyzer(id) {
  return REGISTRY[id] || null;
}

export function getAllAnalyzers() {
  return Object.values(REGISTRY);
}
