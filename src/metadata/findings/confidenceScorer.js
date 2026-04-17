const SEVERITY_WEIGHT = { critical: 10, warning: 5, info: 2 };
const CONFIDENCE_WEIGHT = { high: 3, medium: 2, low: 1 };

const CONTEXT_MODIFIERS = {
  IN_TRIGGER: { delta: 8, reason: 'Runs on every record save' },
  IN_BATCH: { delta: 6, reason: 'Bulk processing amplifies cost' },
  HIGH_CONTENTION: { delta: 5, reason: 'High-frequency object' },
  TEST_CLASS: { delta: -6, reason: 'Test context — no production impact' },
  MULTIPLE_PATTERNS: { delta: 3, reason: 'Multiple anti-patterns in same file' },
  BEFORE_SAVE_CALLOUT: { delta: 15, reason: 'Architecturally invalid construct' },
};

function shouldApply(finding, key, patternsByFile) {
  switch (key) {
    case 'IN_TRIGGER':
      return finding.file?.endsWith('.trigger');
    case 'IN_BATCH':
      return finding.contextNote?.toLowerCase().includes('batch');
    case 'HIGH_CONTENTION':
      return finding.contextNote?.includes('high-contention');
    case 'TEST_CLASS':
      return finding.contextNote?.toLowerCase().includes('test class');
    case 'MULTIPLE_PATTERNS':
      return finding.file && patternsByFile[finding.file]?.size >= 3;
    case 'BEFORE_SAVE_CALLOUT':
      return (
        finding.pattern === 'FLOW_SYNC_CALLOUT' &&
        finding.contextNote?.toLowerCase().includes('before-save')
      );
    default:
      return false;
  }
}

export function scoreFindings(findings) {
  const patternsByFile = {};
  for (const f of findings) {
    if (!f.file) continue;
    if (!patternsByFile[f.file]) patternsByFile[f.file] = new Set();
    patternsByFile[f.file].add(f.pattern);
  }

  return findings
    .map((f) => {
      const baseScore = (SEVERITY_WEIGHT[f.severity] || 0) * (CONFIDENCE_WEIGHT[f.confidence] || 0);
      const modifiers = [];
      let totalDelta = 0;

      for (const [key, mod] of Object.entries(CONTEXT_MODIFIERS)) {
        if (shouldApply(f, key, patternsByFile)) {
          totalDelta += mod.delta;
          modifiers.push({ key, delta: mod.delta, reason: mod.reason });
        }
      }

      return {
        ...f,
        baseScore,
        score: Math.min(50, Math.max(1, baseScore + totalDelta)),
        scoreModifiers: modifiers,
      };
    })
    .sort((a, b) => b.score - a.score);
}
