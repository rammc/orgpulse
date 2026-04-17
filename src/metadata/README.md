# Metadata Analyzer Module

Migrated from the orgpulse-dev prototype on 2026-04-17. Loaded only in local builds — tree-shaken out of public deployments.

## Public API

`src/metadata/index.js` exports only what the rest of the app needs. Everything else is internal.

## Analyzers

- **apexCpuAnalyzer** — SOQL/DML in loops, nested iterations (brace-aware detection)
- **apexRowLockAnalyzer** — read-then-write patterns with context-aware confidence (batch/trigger/controller/LIMIT 1)
- **flowAnalyzer** — RT Flow patterns: no entry filter, record ops in loops, multiple flows on same trigger, synchronous callouts

## Adding a new analyzer

1. Create `src/metadata/analyzers/<name>Analyzer.js`
2. Export `analyze(filePath, fileContent)` returning an array of findings
3. Export `metadata` object with `id`, `name`, `targetFiles`, `signals`
4. Register in `src/metadata/analyzers/index.js`
5. Map relevant signals in `src/metadata/signals/signalToAnalyzer.js`
