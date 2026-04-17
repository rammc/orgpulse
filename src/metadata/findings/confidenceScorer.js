const SEVERITY_WEIGHT = { critical: 10, warning: 5, info: 2 };
const CONFIDENCE_WEIGHT = { high: 3, medium: 2, low: 1 };

export function scoreFindings(findings) {
  return findings
    .map((f) => ({
      ...f,
      score: (SEVERITY_WEIGHT[f.severity] || 0) * (CONFIDENCE_WEIGHT[f.confidence] || 0),
    }))
    .sort((a, b) => b.score - a.score);
}
