export function formatFinding(finding) {
  const method = finding.method ? `, method ${finding.method}()` : '';
  return `[${finding.severity.toUpperCase()}] ${finding.name} — ${finding.file} line ${finding.line}${method}`;
}
