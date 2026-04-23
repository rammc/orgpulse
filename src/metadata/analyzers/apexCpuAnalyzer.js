import {
  stripComments,
  stripStringLiterals,
  findLineNumber,
  extractMethodContext,
  extractLogicalSnippet,
  isTestClass,
} from './baseAnalyzer.js';

function findMatchingDelimiter(source, openIndex, openCh, closeCh) {
  let depth = 1;
  for (let i = openIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingBrace(source, openIndex) {
  return findMatchingDelimiter(source, openIndex, '{', '}');
}

function findMatchingParen(source, openIndex) {
  return findMatchingDelimiter(source, openIndex, '(', ')');
}

function skipWhitespace(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}

function findLoopBlocks(source) {
  const loops = [];
  const keywordRegex = /\b(for|while|do)\b/g;
  let match;
  while ((match = keywordRegex.exec(source)) !== null) {
    const keyword = match[1];
    let i = skipWhitespace(source, match.index + keyword.length);

    if (keyword === 'do') {
      if (source[i] !== '{') continue;
      const open = i;
      const close = findMatchingBrace(source, open);
      if (close === -1) continue;
      loops.push({
        start: match.index,
        bodyStart: open + 1,
        end: close,
        body: source.substring(open + 1, close),
        header: '',
        kind: 'do-while',
      });
      continue;
    }

    if (source[i] !== '(') continue;
    const parenClose = findMatchingParen(source, i);
    if (parenClose === -1) continue;
    const header = source.substring(i + 1, parenClose);
    let j = skipWhitespace(source, parenClose + 1);

    if (source[j] === '{') {
      const open = j;
      const close = findMatchingBrace(source, open);
      if (close === -1) continue;
      loops.push({
        start: match.index,
        bodyStart: open + 1,
        end: close,
        body: source.substring(open + 1, close),
        header,
        kind: keyword,
      });
    } else {
      let k = j;
      while (k < source.length && source[k] !== ';') k++;
      if (k >= source.length) continue;
      loops.push({
        start: match.index,
        bodyStart: j,
        end: k,
        body: source.substring(j, k + 1),
        header,
        kind: keyword,
      });
    }
  }
  return loops;
}

const BODY_PATTERNS = {
  SOQL_IN_LOOP: {
    test: (body) =>
      /\[\s*SELECT\b/is.test(body) ||
      /\bDatabase\.(?:query|getQueryLocator|queryWithBinds|countQuery)\s*\(/i.test(body),
    name: 'SOQL in loop',
    severity: 'critical',
    confidence: 'high',
    description:
      'SOQL query inside a loop. Hits the 100 queries-per-transaction governor limit. Includes bracket SOQL and Database.query/getQueryLocator/queryWithBinds/countQuery.',
    relatedSignals: [
      'total_cpu_time',
      'apex_execution_time',
      'slow_transactions',
      'concurrent_apex_errors',
    ],
  },
  SOSL_IN_LOOP: {
    test: (body) => /\[\s*FIND\b/is.test(body) || /\bSearch\.query\s*\(/i.test(body),
    name: 'SOSL in loop',
    severity: 'critical',
    confidence: 'high',
    description: 'SOSL search inside a loop. Hits the 20 SOSL-per-transaction governor limit.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time', 'slow_transactions'],
  },
  DML_IN_LOOP: {
    test: (body) => /\b(?:insert|update|upsert|delete|undelete|merge)\s+\w/i.test(body),
    name: 'DML in loop',
    severity: 'critical',
    confidence: 'high',
    description:
      'DML operation inside a loop. Hits the 150 DML-per-transaction limit. Includes insert/update/upsert/delete/undelete/merge.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time', 'concurrent_apex_errors'],
  },
  DATABASE_DML_IN_LOOP: {
    test: (body) =>
      /\bDatabase\.(?:insert|update|upsert|delete|undelete|merge|convertLead)\s*\(/i.test(body),
    name: 'Database.DML() in loop',
    severity: 'critical',
    confidence: 'high',
    description: 'Database DML call inside a loop. Same governor limit issue as direct DML.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
  CALLOUT_IN_LOOP: {
    test: (body) =>
      /\b(?:Http|HttpRequest)\s*\(\s*\)/.test(body) ||
      /\.send\s*\(\s*(?:req|request|httpReq)\w*\s*\)/i.test(body),
    name: 'HTTP callout in loop',
    severity: 'critical',
    confidence: 'medium',
    description:
      'HTTP callout inside a loop. Hits the 100 callouts-per-transaction limit and is typically serialized.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
  EMAIL_IN_LOOP: {
    test: (body) => /\bMessaging\.sendEmail\s*\(/i.test(body),
    name: 'Messaging.sendEmail in loop',
    severity: 'warning',
    confidence: 'high',
    description:
      'Messaging.sendEmail inside a loop. Batch messages into a single call to avoid email-invocation limits.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
  NESTED_LOOP: {
    test: (body) => /\b(?:for|while)\b[^;{]*\{/i.test(body),
    name: 'Nested loops',
    severity: 'warning',
    confidence: 'medium',
    description: 'Nested loops. Review for O(n*m) complexity if both inputs scale with data size.',
    relatedSignals: ['total_cpu_time', 'apex_execution_time'],
  },
};

export function analyze(filePath, fileContent) {
  if (!filePath.endsWith('.cls') && !filePath.endsWith('.trigger')) return [];
  const source = stripStringLiterals(stripComments(fileContent));
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
