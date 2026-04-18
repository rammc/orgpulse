const PREFIX = 'orgpulse-fix-v1-';

function cacheKey(finding, model) {
  const parts = [
    finding.file || '',
    finding.line || '0',
    finding.pattern,
    finding.analyzer,
    finding.method || finding.flowLabel || '',
    model,
  ];
  return PREFIX + btoa(parts.join('|')).replace(/=+$/, '');
}

export function getCachedFix(finding, model) {
  try {
    const raw = sessionStorage.getItem(cacheKey(finding, model));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedFix(finding, model, fixResult) {
  try {
    sessionStorage.setItem(cacheKey(finding, model), JSON.stringify(fixResult));
  } catch {
    /* storage full or unavailable */
  }
}

export function clearAllCachedFixes() {
  try {
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX));
    keys.forEach((k) => sessionStorage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}
