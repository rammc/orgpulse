# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project bootstrap
- Phase 1: Tesseract.js OCR for counter extraction
- Phase 2: Anthropic Claude Vision integration (BYOK)
- 9-field prioritization matrix with recommendations
- Settings dialog for API key management
- GitHub Pages deployment workflow
- Try-with-sample-screenshot button for the onboarding flow
- OCR calibration for the Org Performance layout, with an opt-in OCR diagnostic panel
- Metadata analyzer for local SFDX projects (Apex CPU/DML/SOQL patterns, row-lock detection, Flow patterns, roll-up/workflow/trigger duplicate detection) — local build only
- AI-generated fix suggestions for metadata findings (BYOK, Claude Haiku by default with a Sonnet option), with session-scoped caching
- Markdown export of analysis results (executive summary and detailed findings), including AI fix suggestions when present
- Severity color coding, tooltips, and context hints in the matrix UI

### Fixed
- Multiple OCR extraction and counter-parsing fixes for the Org Performance layout
- Recommendations matrix signal-mapping and cell-placement corrections (see `docs/RECOMMENDATIONS_AUDIT.md`)
