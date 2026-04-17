# Matrix Methodology

## The 9-Field Prioritization Matrix

OrgPulse uses a **9-field matrix** (3x3 grid) to categorize performance optimization recommendations based on two axes:

- **Y-Axis: Impact** — How much performance improvement will this change deliver?
- **X-Axis: Effort** — How much work (time, risk, complexity) does this change require?

## Matrix Layout

```
                    Effort →
                Low          Medium        High
            ┌────────────┬────────────┬────────────┐
    High    │ Quick Wins │ Prioritize │ Strategic  │
            │   (green)  │   (green)  │  (yellow)  │
Impact      ├────────────┼────────────┼────────────┤
    ↑       │ Take Along │  Evaluate  │  Weigh Up  │
   Medium   │   (green)  │  (yellow)  │  (orange)  │
            ├────────────┼────────────┼────────────┤
    Low     │Opportunist.│   Defer    │    Skip    │
            │  (yellow)  │  (orange)  │   (red)    │
            └────────────┴────────────┴────────────┘
```

## Cell Descriptions

### Quick Wins (High Impact / Low Effort) — Green
**Implement Now.** Maximum performance gain with minimal work. These are the first things you should address. Examples: adding custom indexes, consolidating sharing rules.

### Prioritize (High Impact / Medium Effort) — Green
**Schedule Next Sprint.** Significant improvement that requires moderate effort. Schedule these for the next sprint. Examples: Apex CPU optimization, trigger bulkification, row lock mitigation.

### Strategic (High Impact / High Effort) — Yellow
**Plan Strategically.** Major improvement potential but requires significant investment. Needs a business case and project planning. Examples: event-driven architecture, data model overhaul, org split evaluation.

### Take Along (Medium Impact / Low Effort) — Green
**Pick Up Opportunistically.** Worth doing when you're already working in the area. Low effort makes them easy to include. Examples: improving callout error handling, deactivating unused flows.

### Evaluate (Medium Impact / Medium Effort) — Yellow
**Analyze & Decide.** Requires analysis to determine if the ROI justifies the work. Examples: login failure root-cause analysis, integration pattern review.

### Weigh Up (Medium Impact / High Effort) — Orange
**Justify ROI First.** Only pursue with clear ROI justification. The effort is high relative to the impact. Examples: LWC performance audit, Aura-to-LWC migration.

### Opportunistic (Low Impact / Low Effort) — Yellow
**When Convenient.** Nice-to-have improvements you pick up opportunistically. Examples: cleaning up unused custom fields, optimizing debug log levels.

### Defer (Low Impact / Medium Effort) — Orange
**Backlog.** Put on the backlog but don't actively prioritize. Examples: increasing test coverage, migrating from profiles to permission sets.

### Skip (Low Impact / High Effort) — Red
**Consciously Decline.** Consciously decide not to pursue these. The effort far outweighs the benefit. Examples: complete Apex rewrite, building custom UI replacements for standard features.

## Color Coding

| Color  | CSS Variable | Meaning |
|--------|-------------|---------|
| Green  | `--green`   | Favorable — good impact-to-effort ratio |
| Yellow | `--yellow`  | Moderate — evaluate before committing |
| Orange | `--orange`  | Caution — high effort relative to impact |
| Red    | `--red`     | Avoid — effort significantly exceeds benefit |

The color progresses diagonally from green (top-left, best ratio) to red (bottom-right, worst ratio).

## How Recommendations Are Mapped

Each recommendation in `recommendations.json` is assigned to exactly one matrix cell based on:

1. **Impact assessment:** How much does this optimization typically improve org performance?
2. **Effort assessment:** How much work is required to implement this in a typical enterprise Salesforce org?

These assessments are based on the experience of Salesforce architects working with large-scale orgs and are meant as starting points. Individual org contexts may shift items between cells.

## Automated Detection

When a user uploads a Scale Center screenshot, OrgPulse automatically highlights relevant matrix cells:

- **Basic Mode (OCR):** Extracts counter values and applies threshold-based scoring rules from `recommendations.json` (e.g., `concurrent_apex_errors: 6-25` scores as warning)
- **Deep Mode (Vision AI):** Claude analyzes charts and patterns, mapping each finding to a specific matrix cell with severity, root cause type, and a confidence score
- **Validation:** All Vision findings are validated against a known metric vocabulary. Hallucinated metric names are rejected.
- **Scoring:** Each signal earns points (info=1, warning=3, critical=5). Cell scores determine severity level: 1-3=low, 4-7=medium, 8+=high.

The trigger rules and thresholds are defined in `recommendations.json` under the `trigger_signals` field per cell. The scoring engine in `recommendations.js` reads these thresholds at runtime.

## Modernization Philosophy

The recommendations in OrgPulse are curated to favor current Salesforce best practices over legacy patterns. Specifically:

- **LWC and GraphQL Wire Adapter** as the primary data access pattern for complex queries
- **Data Cloud (D360)** for unified customer profiles and Agentforce readiness
- **Zero Copy Federation** for avoiding Salesforce storage limits without ETL
- **WITH USER_MODE** for CRUD, FLS, and sharing enforcement in a single keyword
- **Named Credentials + External Credentials** (the Winter '23 split) for integrations
- **Platform Events + Change Data Capture via Pub/Sub API** for event-driven architectures
- **Permission Set Groups** as the strategic direction over Profile-based permissions

Legacy patterns are still mentioned where they serve as transition guidance or where retired features require explicit call-out (e.g., Process Builder migration).

Recommendations are reviewed and refreshed regularly. The `updated` field on each cell reflects the most recent content revision.
