import {
  stripComments,
  findLineNumber,
  extractMethodContext,
  extractLogicalSnippet,
  isTestClass,
} from './baseAnalyzer.js';

function findMatchingBrace(source, openIndex) {
  let depth = 1;
  let inString = false;
  let strChar = null;
  for (let i = openIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true;
      strChar = ch;
      continue;
    }
    if (inString && ch === strChar && source[i - 1] !== '\\') {
      inString = false;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findLoopBlocks(source) {
  const loops = [];
  const forRegex = /\bfor\s*\(([^)]+)\)\s*\{/g;
  let match;
  while ((match = forRegex.exec(source)) !== null) {
    const openBrace = match.index + match[0].length - 1;
    const close = findMatchingBrace(source, openBrace);
    if (close === -1) continue;
    loops.push({
      start: match.index,
      bodyStart: openBrace + 1,
      end: close,
      body: source.substring(openBrace + 1, close),
      header: match[1],
    });
  }
  return loops;
}

const BODY_PATTERNS = {
  SOQL_IN_LOOP: {
    test: (body) => /\[\s*SELECT\b/is.test(body),
    name: 'SOQL in loop',
    severity: 'critical',
    confidence: 'high',
    description:
      'SOQL query inside a for-loop. Hits the 100 queries-per-transaction governor limit.',
    relatedSignals: [
      'total_cpu_time',
      'apex_execution_time',
      'slow_transactions',
      'concurrent_apex_errors',
    ],
  },
  DML_IN_LOOP: {
    test: (body) => /\b(?:insert|update|upsert|delete|undelete)\s+\w/i.test(body),
    name: 'DML in loop',
    severity: 'critical',
    confidence: 'high',
    description: 'DML operation inside a for-loop. Hits the 150 DML-per-transaction limit.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time', 'concurrent_apex_errors'],
  },
  DATABASE_DML_IN_LOOP: {
    test: (body) => /\bDatabase\.(?:insert|update|upsert|delete)\s*\(/i.test(body),
    name: 'Database.DML() in loop',
    severity: 'critical',
    confidence: 'high',
    description: 'Database DML call inside a for-loop. Same governor limit issue as direct DML.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
  NESTED_LOOP: {
    test: (body) => /\bfor\s*\([^)]+\)\s*\{/i.test(body),
    name: 'Nested loops',
    severity: 'warning',
    confidence: 'medium',
    description: 'Nested for-loops. Check for O(n^2) complexity.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
};

export function analyze(filePath, fileContent) {
  if (!filePath.endsWith('.cls') && !filePath.endsWith('.trigger')) return [];
  const source = stripComments(fileContent);
  const findings = [];
  const loops = findLoopBlocks(source);
  const testCheck = isTestClass(filePath, fileContent);

  for (const loop of loops) {
    for (const [key, pattern] of Object.entries(BODY_PATTERNS)) {
      if (!pattern.test(loop.body)) continue;
      let confidence = pattern.confidence;
      let contextNote = '';
      if (testCheck.isTest) {
        confidence = confidence === 'high' ? 'medium' : 'low';
        contextNote = 'Finding is in a test class — may mirror production code patterns.';
      }
      findings.push({
        analyzer: 'apexCpuAnalyzer',
        pattern: key,
        name: pattern.name,
        severity: pattern.severity,
        confidence,
        contextNote,
        description: pattern.description,
        file: filePath,
        line: findLineNumber(source, loop.start),
        method: extractMethodContext(source, loop.start),
        snippet: extractLogicalSnippet(source, loop.start, loop.end, {
          maxLines: 15,
          contextBefore: 1,
          contextAfter: 2,
        }),
        relatedSignals: pattern.relatedSignals,
      });
    }
  }
  return findings;
}

export const metadata = {
  id: 'apexCpuAnalyzer',
  name: 'Apex CPU Analyzer',
  targetFiles: ['.cls', '.trigger'],
  signals: ['total_cpu_time', 'apex_execution_time', 'slow_transactions'],
};
