import {
  stripComments,
  stripStringLiterals,
  findLineNumber,
  extractLogicalSnippet,
  isTestClass,
} from './baseAnalyzer.js';

const PATTERNS = {
  UPDATE_WITHOUT_FOR_UPDATE: {
    regex:
      /\[\s*SELECT[^\]]+FROM\s+(\w+)[^\]]*\][\s\S]{0,200}?(?:(?:update|upsert|merge)\s+\w|Database\.(?:update|upsert|merge)\s*\()/gis,
    name: 'Read-then-write without FOR UPDATE',
    severity: 'warning',
    description:
      'Records queried then updated without FOR UPDATE lock can cause row lock contention. Covers direct DML and Database.update/upsert/merge.',
    confidence: 'medium',
    stripStrings: true,
  },
  BATCH_WITHOUT_ORDER_BY: {
    regex: /Database\.getQueryLocator\s*\(\s*['"](?![^'"]*ORDER\s+BY)/gi,
    name: 'Batch query without ORDER BY',
    severity: 'info',
    description:
      'Batch Apex query without ORDER BY produces non-deterministic order, increasing row lock risk.',
    confidence: 'medium',
    stripStrings: false,
  },
  BATCH_DYNAMIC_QUERY: {
    regex: /Database\.getQueryLocator\s*\(\s*(?!['"])[A-Za-z_]/gi,
    name: 'Batch query built from non-literal string',
    severity: 'info',
    description:
      'Database.getQueryLocator called with a variable — ORDER BY cannot be verified statically. Review the query string for deterministic ordering.',
    confidence: 'low',
    stripStrings: true,
  },
};

function classifyRowLockContext(matchedSnippet, fullSource, matchIndex) {
  const ctx = {
    isSingleRecord: false,
    isInBatch: false,
    isInTrigger: false,
    isInController: false,
    hasForUpdate: false,
  };
  if (/\bLIMIT\s+1\b/i.test(matchedSnippet)) ctx.isSingleRecord = true;
  if (/\]\s*\[\s*0\s*\]/.test(matchedSnippet)) ctx.isSingleRecord = true;
  if (/\bFOR\s+UPDATE\b/i.test(matchedSnippet)) ctx.hasForUpdate = true;
  const before = fullSource.substring(0, matchIndex);
  if (/class\s+\w*(Controller|Ctrl)\b/i.test(before)) ctx.isInController = true;
  if (/class\s+\w*Batch\b/i.test(before)) ctx.isInBatch = true;
  if (/^\s*trigger\s+/m.test(fullSource)) ctx.isInTrigger = true;
  if (/execute\s*\(\s*Database\.BatchableContext/i.test(before)) ctx.isInBatch = true;
  return ctx;
}

export function analyze(filePath, fileContent) {
  if (!filePath.endsWith('.cls') && !filePath.endsWith('.trigger')) return [];
  const testCheck = isTestClass(filePath, fileContent);
  if (testCheck.isTest) return [];
  const commentStripped = stripComments(fileContent);
  const stringStripped = stripStringLiterals(commentStripped);
  const findings = [];
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const source = pattern.stripStrings ? stringStripped : commentStripped;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(source)) !== null) {
      const ctx = classifyRowLockContext(match[0], source, match.index);
      if (ctx.hasForUpdate) continue;

      let confidence = pattern.confidence;
      let contextNote = '';
      if (ctx.isSingleRecord) {
        confidence = 'low';
        contextNote = 'Single-record operation — row lock risk is minimal.';
      } else if (ctx.isInBatch) {
        confidence = 'high';
        contextNote = 'Batch context — row lock risk elevated due to parallel execution.';
      } else if (ctx.isInTrigger) {
        confidence = 'high';
        contextNote = 'Trigger context — concurrent DML likely.';
      } else if (ctx.isInController) {
        confidence = 'low';
        contextNote = 'Controller context — single-user transactions rarely cause row locks.';
      }

      findings.push({
        analyzer: 'apexRowLockAnalyzer',
        pattern: key,
        name: pattern.name,
        severity: pattern.severity,
        confidence,
        contextNote,
        description: pattern.description,
        file: filePath,
        line: findLineNumber(source, match.index),
        snippet: extractLogicalSnippet(source, match.index, match.index + match[0].length, {
          maxLines: 12,
          contextBefore: 1,
          contextAfter: 4,
        }),
        relatedSignals: ['row_lock_errors', 'concurrent_dml'],
      });
    }
  }
  return findings;
}

export const metadata = {
  id: 'apexRowLockAnalyzer',
  name: 'Apex Row Lock Analyzer',
  targetFiles: ['.cls', '.trigger'],
  signals: ['row_lock_errors', 'concurrent_dml'],
};
