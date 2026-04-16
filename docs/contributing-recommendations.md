# Contributing Recommendations

This guide explains how to add new recommendations to OrgPulse's 9-field prioritization matrix.

## Overview

Recommendations are stored in `src/data/recommendations.json`. Each entry in the JSON array represents one cell of the 9-field matrix. Within each cell, the `recommendations` array contains individual actionable recommendations.

**You don't need to write any JavaScript to contribute a recommendation — just edit the JSON file.**

## JSON Schema

### Matrix Cell (top-level entry)

```json
{
  "id": "quick-wins",
  "matrix_position": { "impact": "high", "effort": "low" },
  "color": "green",
  "icon": "⚡",
  "title": "Quick Wins",
  "priority_label": "Sofort umsetzen",
  "subtitle": "German description of the cell's purpose.",
  "scale_center_hint": "German hint about which Scale Center section is relevant.",
  "trigger_signals": [
    { "metric": "db_cpu_time", "threshold": "high" },
    { "keywords": ["full table scan", "slow soql"] }
  ],
  "recommendations": [ ... ],
  "contributors": ["@cramm"],
  "added": "2026-04-16"
}
```

> **Note:** You typically do NOT need to create a new matrix cell. The 9 cells are fixed. You add recommendations *within* an existing cell.

### Recommendation Object

```json
{
  "title": "Custom Indexes auf grosse Objekte",
  "body": "Fur Objekte mit >100k Records: Identifiziere die meistgenutzten Filter-Felder in SOQL-Queries und Reports. Erstelle einen Case bei Salesforce Support fur Custom Indexes auf diese Felder.",
  "tags": ["Apex", "SOQL", "Support Case"],
  "references": [
    {
      "url": "https://help.salesforce.com/s/articleView?id=000387690",
      "type": "official_docs"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Short, descriptive title (German) |
| `body` | string | Yes | Actionable advice explaining what to do and why (German) |
| `tags` | string[] | Yes | Technology/area tags (e.g., "Apex", "LWC", "Integration") |
| `references` | object[] | No | Links to official documentation |

### Reference Object

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Full URL to the reference |
| `type` | string | One of: `official_docs`, `blog`, `trailhead`, `github` |

## Step-by-Step: Adding a Recommendation

### 1. Choose the Right Matrix Cell

Determine where your recommendation fits based on Impact and Effort:

| Cell | Impact | Effort | Example Use Cases |
|------|--------|--------|-------------------|
| `quick-wins` | High | Low | Index creation, sharing rule cleanup |
| `prioritize` | High | Medium | Apex optimization, trigger refactoring |
| `strategic` | High | High | Architecture redesign, org split |
| `take-along` | Medium | Low | Error handling, flow cleanup |
| `evaluate` | Medium | Medium | Login analysis, integration review |
| `weigh-up` | Medium | High | LWC migration, performance audit |
| `opportunistic` | Low | Low | Field cleanup, log optimization |
| `defer` | Low | Medium | Test coverage, permission migration |
| `skip` | Low | High | Full rewrites, custom UI replacements |

### 2. Write Your Recommendation

- **Title:** Keep it concise and specific (5-10 words)
- **Body:** Explain what to do, why, and how. Be actionable. Include thresholds or metrics where possible (e.g., ">100k Records")
- **Tags:** Use existing tags where possible. Common tags: `Apex`, `SOQL`, `LWC`, `Integration`, `Security`, `Configuration`, `Architecture`, `Data Model`
- **References:** Always include Salesforce official documentation links when available

### 3. Edit the JSON File

Open `src/data/recommendations.json` and find the cell you want to add to. Add your recommendation to the `recommendations` array:

```json
{
  "id": "prioritize",
  "recommendations": [
    // ... existing recommendations ...
    {
      "title": "Async Apex fur schwere Operationen",
      "body": "Identifiziere synchrone Apex-Operationen mit hoher CPU-Zeit oder vielen SOQL-Queries. Migriere diese zu Queueable Apex oder Batch Apex, um Governor Limits zu entlasten und die User Experience zu verbessern.",
      "tags": ["Apex", "Performance", "Async"],
      "references": [
        {
          "url": "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_queueing_jobs.htm",
          "type": "official_docs"
        }
      ]
    }
  ]
}
```

### 4. Add Yourself as Contributor

Add your GitHub handle to the cell's `contributors` array:

```json
"contributors": ["@cramm", "@your-handle"]
```

### 5. Validate

Run `npm run build` to ensure the JSON is valid and the app builds correctly.

### 6. Submit a PR

Use the [Matrix Recommendation issue template](../.github/ISSUE_TEMPLATE/matrix_recommendation.md) to discuss your idea first, or submit a PR directly if you're confident about the placement.

## Language Guidelines

- **Recommendation content** (title, body, subtitle, hints) should be in **German**
- **Tags** should be in **English** (they are technical terms)
- **Matrix cell titles** (`title` field) are in **English**
- We plan to add i18n support in a future version

## Quality Checklist

Before submitting your recommendation:

- [ ] Title is concise and specific
- [ ] Body is actionable (tells the reader *what* to do)
- [ ] Correct matrix cell chosen (Impact vs. Effort makes sense)
- [ ] Tags are relevant and use existing tag names where possible
- [ ] References link to official Salesforce documentation
- [ ] JSON is valid (run `npm run build` to check)
- [ ] Your GitHub handle is in the `contributors` array
