# Architecture

## Overview

OrgPulse is a **static web application** hosted on GitHub Pages. There is no backend server, no database, and no user accounts. All processing happens either in the user's browser or via direct API calls from the browser to external services.

```
User Browser
    ├── Tesseract.js (Basic Mode) ──→ [stays entirely in browser]
    │
    └── Anthropic Claude API (Deep Mode, BYOK) ──→ [user's API key, direct call]

GitHub Pages (static hosting only — no backend, no server-side code)
```

## Why No Backend?

1. **Privacy:** Screenshots of Scale Center may contain sensitive org data. By running everything client-side, we ensure no data passes through our servers.
2. **Cost:** GitHub Pages is free. No server means no hosting costs, no scaling concerns, and no operational burden.
3. **Simplicity:** A static site is easier to contribute to, easier to audit, and easier to trust.

## BYOK — Bring Your Own Key

The optional Deep Analysis Mode uses the Anthropic Claude Vision API. Instead of proxying requests through a backend (which would require us to manage and pay for API keys), users provide their own API key.

- The key is stored in the browser's `LocalStorage` under the key `orgpulse_api_key`
- The key is sent directly from the browser to `api.anthropic.com` via `fetch()`
- The key is never transmitted to GitHub Pages or any other server we control
- Cost per analysis is approximately $0.02, billed directly by Anthropic to the user

## Technology Stack

| Component  | Technology                 | Purpose                                     |
| ---------- | -------------------------- | ------------------------------------------- |
| Build tool | Vite                       | Fast dev server + production builds         |
| Language   | Vanilla JS (ES Modules)    | Low barrier to entry, no framework overhead |
| Styling    | CSS with Custom Properties | Dark theme design system                    |
| OCR        | Tesseract.js               | Local text extraction from screenshots      |
| Vision AI  | Anthropic Claude API       | Chart interpretation and pattern detection  |
| Hosting    | GitHub Pages               | Free static hosting                         |
| CI         | GitHub Actions             | Lint + build verification on PRs            |

## Module Structure

```
src/
├── index.html          # Single-page application shell
├── styles/
│   └── main.css        # Design system + all component styles
├── js/
│   ├── matrix.js       # Main entry point — orchestrates everything
│   ├── ocr.js          # Tesseract.js OCR integration
│   ├── vision.js       # Anthropic Claude Vision API integration
│   ├── settings.js     # API key management modal
│   └── recommendations.js  # Maps analysis results to matrix cells
└── data/
    └── recommendations.json # 9-field matrix content and recommendations
```

### Module Dependencies

```
matrix.js (entry point)
├── settings.js     (API key CRUD)
├── ocr.js          (Tesseract.js, lazy-loaded)
├── vision.js       (Claude API, imports settings.js)
└── recommendations.js (matching logic)
```

## Data Flow

### Basic Mode (OCR)

1. User uploads a Scale Center screenshot (PNG/JPG)
2. `ocr.js` crops the top 30% of the image (counter region)
3. Tesseract.js performs text recognition in the browser
4. Regex patterns extract six counter values
5. `recommendations.js` maps counters to matrix cells
6. `matrix.js` highlights relevant cells and displays the detection summary

### Deep Analysis Mode (Vision AI)

1. User uploads a screenshot and has an API key configured
2. `vision.js` converts the image to base64
3. Direct `fetch()` call to `api.anthropic.com/v1/messages` with the image
4. Claude analyzes the full screenshot (charts, trends, counters)
5. Returns structured JSON with findings, severities, and matrix cell mappings
6. `recommendations.js` processes the findings
7. `matrix.js` highlights cells and shows the AI-generated summary

## Security Considerations

- No server-side code means no server-side vulnerabilities
- API keys are stored in LocalStorage (same-origin policy protects them)
- No cookies, no sessions, no authentication tokens
- All external links use `rel="noopener noreferrer"`
- The app does not execute any user-provided code
