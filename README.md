<div align="center">

# 🩺 OrgPulse

**Diagnose your Salesforce org's performance from a single Scale Center screenshot.**

[![Status](https://img.shields.io/badge/status-private%20beta-orange)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

</div>

> ⚠️ **Private Beta** — This project is currently under active development and not yet publicly released.

## What is OrgPulse?

OrgPulse turns your Scale Center screenshots into actionable optimization recommendations. Upload a screenshot, and OrgPulse identifies performance hotspots and maps them to a proven 9-field prioritization matrix (Impact vs. Effort).

## Two Analysis Modes

### 🆓 Basic Mode (Free, Privacy-First)
- Runs entirely in your browser using Tesseract.js OCR
- Extracts counter values (Logins, Errors, etc.)
- No data leaves your machine
- No account or API key required

### 🧠 Deep Analysis Mode (Optional)
- Uses Anthropic Claude Vision to interpret charts and detect patterns
- Identifies CPU spikes, request time anomalies, and metric correlations
- Requires your own Anthropic API key
- Cost: ~$0.02 per analysis, billed directly to you by Anthropic
- Your key and screenshots never touch our servers

## How It Works

```
User Browser
├── Tesseract.js (Basic Mode) ──→ [stays in browser]
│
└── Anthropic Claude API (Deep Mode, BYOK) ──→ [user's API key, direct call]

GitHub Pages (static hosting only — no backend)
```

## Quick Start

```bash
git clone https://github.com/rammc/orgpulse.git
cd orgpulse
npm install
npm run dev
```

> **Note:** GitHub Pages deployment is available once the repository is made public or on a GitHub Pro/Team plan.

## Cost Transparency

OrgPulse is **completely free to use** in Basic Mode.

Optional Deep Analysis Mode requires your own Anthropic API key:
- ~$0.02 per screenshot analysis
- Your key stays in your browser
- We never see your screenshots or your key

The maintainer of this project does not pay any per-user costs. The hosting is free via GitHub Pages.

## Contributing

We welcome contributions, especially:
- New recommendations for the 9-field matrix (no coding required, just JSON)
- Improvements to OCR detection accuracy
- Translations
- Bug reports

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Disclaimer

OrgPulse is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by Salesforce, Inc.** Salesforce, Scale Center, and related marks are trademarks of Salesforce, Inc.

## License

MIT — see [LICENSE](LICENSE)

## Maintainer

Built by [Christopher Ramm](https://cramm.dev) — Salesforce CTA, MVP, and DCX CTO Germany at Capgemini.
