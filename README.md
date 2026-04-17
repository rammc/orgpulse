<div align="center">

# OrgPulse

**Diagnose your Salesforce org's performance from a single Scale Center screenshot.**

[![Status](https://img.shields.io/badge/status-public%20beta-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

</div>

## Presented at Albania Dreamin' 2026

OrgPulse was first presented at [Albania Dreamin' 2026](https://dreamin.al/) — the premier Salesforce community conference in the Balkans — on April 25, 2026, at the Pyramid of Tirana, Albania.

The session demonstrated how AI-assisted screenshot analysis combined with a structured prioritization matrix can help architects and developers diagnose performance issues in mature Salesforce orgs.

## What is OrgPulse?

OrgPulse turns your Scale Center Org Performance screenshots into actionable optimization recommendations. Upload a screenshot, and OrgPulse identifies performance hotspots, validates them against known Scale Center metrics, and maps them to a proven 9-field prioritization matrix (Impact vs. Effort).

## Scope

OrgPulse is a **performance diagnostic tool**. It reads Scale Center screenshots and maps observed performance signals (CPU time, request latency, error counters, concurrency issues) to a prioritized remediation matrix.

**What OrgPulse does:**
- Extract counter values via in-browser OCR
- Interpret chart patterns via Vision LLM (optional, BYOK)
- Match observed signals to concrete Salesforce performance remediation steps
- Highlight the highest-impact actions based on severity scoring

**What OrgPulse does NOT do:**
- Customer experience strategy or unified profile recommendations
- Agentforce readiness assessment
- Data Cloud adoption strategy (except where relevant for performance offloading)
- Marketing, Commerce, or Service Cloud architecture guidance
- Multi-cloud integration planning

## Features

### Basic Mode (Free, Privacy-First)
- Runs entirely in your browser using Tesseract.js OCR
- Extracts the six counter values from the Scale Center top bar (Logins, Errors, etc.)
- No data leaves your machine — no account or API key required

### Deep Analysis Mode (~$0.02 per analysis)
- Uses Anthropic Claude Vision to interpret charts, detect spikes, and identify correlations
- Constrained to a known Scale Center metric vocabulary — prevents hallucinated metric names
- Separates **findings** (anomalies that need attention) from **clearances** (confirmed healthy areas)
- Returns AI-generated contextual insights with remediation hints specific to your screenshot
- BYOK (Bring Your Own Key) — your API key and screenshots never touch our servers

### Scoring and Prioritization
- Threshold-based severity scoring: each detected signal earns points based on graduated thresholds (info / warning / critical)
- Three visual severity levels on the matrix: low (subtle glow), medium (pulse animation), high (strong pulse + scale)
- Priority Ranking list sorted by cell score, showing signal sources (OCR / Deep Analysis)

### Signal-Specific Recommendations
- Recommendations are filtered by the signals actually detected — not just by which matrix cell was triggered
- Root cause type matching (compute / data / concurrency / integration / configuration) for better recommendation relevance
- "Show all recommendations" toggle to access the full set when needed

### Counter Reconciliation
- Deep Analysis automatically runs OCR first for counter extraction, then cross-references with Vision values
- Confidence-aware preference: OCR values trusted when confidence is above 50%, Vision preferred when OCR is unreliable
- Disagreements are transparently displayed with source attribution

### Metric Validation
- All Vision findings are validated against a whitelist of known Scale Center metric identifiers
- Hallucinated or invented metric names are rejected before they enter the scoring pipeline
- Rejected observations are logged and optionally displayed for transparency

## How It Works

1. **Upload** a Scale Center Org Performance screenshot (PNG/JPG)
2. **Basic Mode** extracts counter values using in-browser OCR (Tesseract.js)
3. **Deep Mode** sends the screenshot to Claude Vision (your API key, direct from your browser) for chart pattern analysis
4. **Validation** filters all results against known Scale Center metrics — no hallucinated metric names
5. **Scoring** evaluates findings against threshold-based severity rules and calculates a score per matrix cell
6. **Prioritization** highlights the most critical cells, shows filtered recommendations matched to detected signals, and displays AI-generated contextual insights

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="orgpulse-architecture.svg">
  <source media="(prefers-color-scheme: light)" srcset="orgpulse-architecture.svg">
  <img alt="OrgPulse Architecture — data flow from screenshot upload through OCR and Vision analysis, validation, scoring, to the prioritization matrix" src="orgpulse-architecture.svg" width="680">
</picture>

## Build Modes

OrgPulse has two build outputs from a single codebase:

### Public build (GitHub Pages)
- Screenshot-based Scale Center diagnostics only
- Deployed to https://rammc.github.io/orgpulse
- Command: `npm run build` or `npm run dev`

### Local build (self-hosted)
- Screenshot diagnostics plus metadata analysis of SFDX projects
- Runs on localhost via `npm run dev:local`
- Metadata analyzer scans Apex classes, triggers, and Flows for patterns correlating with Scale Center signals
- Not deployed — for architects working with real Salesforce metadata
- Command: `npm run dev:local`

## Quick Start

### Public mode (screenshot analysis)

```bash
git clone https://github.com/rammc/orgpulse.git
cd orgpulse
npm install
npm run dev
```

### Local mode (screenshot + metadata analysis)

```bash
npm run dev:local
```

Open `http://localhost:5173` in Chrome or Edge (File System Access API required for metadata analysis).

## Cost Transparency

OrgPulse is **completely free to use** in Basic Mode.

Optional Deep Analysis Mode requires your own Anthropic API key:
- ~$0.02 per screenshot analysis (Claude Sonnet with Vision)
- Your key stays in your browser's LocalStorage
- Screenshots are sent directly from your browser to Anthropic's API
- We never see your screenshots or your key

The maintainer of this project does not pay any per-user costs. Hosting is free via GitHub Pages.

## Contributing

We welcome contributions — especially from Salesforce architects and developers who can improve the recommendation library based on real-world experience.

### Three Ways to Contribute

1. **Add Recommendations (no coding required):** Edit `src/data/recommendations.json` — add new entries with title, description, relevant signals, and root cause types. See [Contributing Recommendations](docs/contributing-recommendations.md) for the schema guide.

2. **Improve Detection Accuracy:** Better OCR preprocessing, Vision prompt refinements, validation rules.

3. **Report Issues:** Found a wrong recommendation? A false positive? A metric that should be a clearance? [Open an issue](https://github.com/rammc/orgpulse/issues).

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and coding standards.

## AI Transparency

This project was built with significant assistance from AI tools — specifically [Claude by Anthropic](https://www.anthropic.com/claude) (Claude Opus and Claude Code). AI was used for:

- **Code generation:** Initial project scaffolding, UI components, OCR integration, and Vision API wiring
- **Architecture design:** Data flow, scoring system, recommendation matching logic
- **Content creation:** Recommendation texts, documentation drafts, prompt engineering for the Vision analysis

**All AI-generated code and content has been reviewed, tested, and validated by the maintainer** — a Salesforce Certified Technical Architect (CTA) and Salesforce MVP with hands-on experience in enterprise Salesforce performance engineering.

AI is a tool in this project, not a replacement for domain expertise. Every recommendation in the matrix, every threshold value, and every architectural decision reflects real-world Salesforce platform knowledge. The AI helped build it faster — the human ensured it's correct.

## Disclaimer

OrgPulse is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by Salesforce, Inc.** Salesforce, Scale Center, Apex, Lightning Web Components, and related marks are trademarks of Salesforce, Inc.

## License

MIT — see [LICENSE](LICENSE)

## Contributors

[Christopher Ramm](https://cramm.dev) — Salesforce CTA, Salesforce MVP (Class of 2025), DCX CTO Germany at Capgemini.
[cramm.dev](https://cramm.dev) · [LinkedIn](https://www.linkedin.com/in/cramm/) · [GitHub](https://github.com/cramm)

[Sebastiano Schwarz](https://www.linkedin.com/in/sebastiano-schwarz/) — Salesforce CTO Capgemini Germany.
[LinkedIn](https://www.linkedin.com/in/sebastiano-schwarz/) · [GitHub](https://github.com/svierk)
