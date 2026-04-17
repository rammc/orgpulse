export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function findLineNumber(source, matchIndex) {
  return source.substring(0, matchIndex).split('\n').length;
}

export function extractMethodContext(source, matchIndex) {
  const methodRegex =
    /(?:public|private|protected|global)\s+(?:static\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
  let lastMethod = null;
  let match;
  while ((match = methodRegex.exec(source)) !== null) {
    if (match.index > matchIndex) break;
    lastMethod = match[1];
  }
  return lastMethod;
}

export function normalizeExtension(ext) {
  if (!ext) return '';
  return ext.startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase();
}

export function extractLogicalSnippet(source, matchStart, matchEnd, options = {}) {
  const { maxLines = 15, contextBefore = 1, contextAfter = 3 } = options;

  let startLine = matchStart;
  while (startLine > 0 && source[startLine - 1] !== '\n') startLine--;
  for (let i = 0; i < contextBefore; i++) {
    if (startLine === 0) break;
    startLine--;
    while (startLine > 0 && source[startLine - 1] !== '\n') startLine--;
  }

  let endPos = matchEnd;
  let linesSeen = 0;
  for (let i = matchStart; i < Math.min(source.length, matchEnd + 2000); i++) {
    if (source[i] === '\n') linesSeen++;
    if (linesSeen >= maxLines) {
      endPos = i;
      break;
    }
    endPos = i;
  }

  return source.substring(startLine, endPos + 1).trim();
}

export function isTestClass(filePath, source) {
  const filename = filePath.split('/').pop() || '';
  const testPatterns = [
    /Test\.cls$/i,
    /Tests\.cls$/i,
    /_Test\.cls$/i,
    /TestUtility/i,
    /TestUtil/i,
    /TestHelper/i,
    /TestFactory/i,
    /TestSetup/i,
    /MockProvider/i,
    /Stub\.cls$/i,
  ];
  if (testPatterns.some((p) => p.test(filename))) {
    return { isTest: true, reason: 'filename' };
  }
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('/test/') || lowerPath.includes('/tests/')) {
    return { isTest: true, reason: 'path' };
  }
  const head = source.substring(0, 500);
  if (/@isTest/i.test(head)) {
    return { isTest: true, reason: 'annotation' };
  }
  if (/\btestMethod\b/i.test(source)) {
    return { isTest: true, reason: 'testMethod' };
  }
  return { isTest: false };
}
