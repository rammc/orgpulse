import { describe, it, expect } from 'vitest';
import { buildMarkdownReport } from '../../src/ui/markdownExporter.js';

function fixture(overrides = {}) {
  return {
    projectName: 'test-project',
    analyzedAt: '2026-04-18T12:00:00.000Z',
    fileCount: 4420,
    analyzedCount: 854,
    layout: { layout: 'SFDX_ROOT', confidence: 'high' },
    analyzersUsed: ['apexCpuAnalyzer', 'flowAnalyzer'],
    findings: [
      {
        analyzer: 'apexCpuAnalyzer',
        pattern: 'SOQL_IN_LOOP',
        severity: 'critical',
        confidence: 'high',
        score: 30,
        baseScore: 30,
        scoreModifiers: [],
        file: 'classes/Handler.cls',
        line: 47,
        method: 'processUpdates',
        snippet: 'for (Account a : accs) {\n  [SELECT Id FROM Contact]\n}',
        relatedSignals: ['total_cpu_time'],
      },
    ],
    diagnostics: { skippedFiles: [] },
    ...overrides,
  };
}

describe('Markdown Exporter', () => {
  it('includes all major sections', () => {
    const md = buildMarkdownReport(fixture(), ['total_cpu_time']);
    expect(md).toContain('# OrgPulse Findings Report');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## Causal Summary');
    expect(md).toContain('## Detailed Findings');
    expect(md).toContain('## Appendix');
  });

  it('includes project name', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('`test-project`');
  });

  it('handles zero findings', () => {
    const md = buildMarkdownReport(fixture({ findings: [] }), []);
    expect(md).toContain('**Total findings:** 0');
  });

  it('includes pattern explanations', () => {
    const md = buildMarkdownReport(fixture(), ['total_cpu_time']);
    expect(md).toContain('Why this matters');
    expect(md).toContain('How to fix');
  });

  it('includes code snippets', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('```apex');
    expect(md).toContain('SELECT Id FROM Contact');
  });

  it('shows severity breakdown table', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('| Critical |');
  });

  it('lists hotspot files', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('classes/Handler.cls');
  });

  it('includes footer with OrgPulse link', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('github.com/rammc/orgpulse');
  });

  it('handles missing signals gracefully', () => {
    const md = buildMarkdownReport(fixture(), []);
    expect(md).toContain('No screenshot signals');
  });

  it('includes score modifiers when present', () => {
    const f = fixture();
    f.findings[0].scoreModifiers = [{ delta: 8, reason: 'In trigger' }];
    f.findings[0].baseScore = 30;
    const md = buildMarkdownReport(f, []);
    expect(md).toContain('+8');
    expect(md).toContain('In trigger');
  });
});
