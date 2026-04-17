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
  "icon": "zap",
  "title": "Quick Wins",
  "priority_label": "Implement Now",
  "subtitle": "Description of the cell's purpose.",
  "scale_center_hint": "Hint about which Scale Center section is relevant.",
  "trigger_signals": [ ... ],
  "recommendations": [ ... ],
  "contributors": ["@cramm"],
  "added": "2026-04-16",
  "updated": "2026-04-17"
}
```

> **Note:** You typically do NOT need to create a new matrix cell. The 9 cells are fixed. You add recommendations _within_ an existing cell.

### Recommendation Object

```json
{
  "title": "Custom Indexes on High-Volume Objects",
  "body": "For objects with >100k records: identify the most frequently used filter fields...",
  "tags": ["Apex", "SOQL", "Support Case"],
  "relevant_signals": ["db_cpu_time", "slow_soql", "full_table_scan", "slow_transactions"],
  "root_cause_types": ["data"],
  "references": [
    {
      "url": "https://help.salesforce.com/s/articleView?id=000387690",
      "type": "official_docs"
    }
  ]
}
```

### Field Reference

| Field              | Type     | Required | Description                                                                                           |
| ------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `title`            | string   | Yes      | Short, action-oriented title (5-10 words)                                                             |
| `body`             | string   | Yes      | 2-4 sentence description with specific actionable advice                                              |
| `tags`             | string[] | Yes      | Technology/area tags (e.g., "Apex", "LWC", "Integration")                                             |
| `relevant_signals` | string[] | Yes      | Signal metric names that make this recommendation relevant. Use `["*"]` for universal recommendations |
| `root_cause_types` | string[] | Yes      | One or more of: `compute`, `data`, `concurrency`, `integration`, `configuration`                      |
| `references`       | object[] | No       | Links to official documentation or community resources                                                |

### Reference Object

| Field  | Type   | Description                             |
| ------ | ------ | --------------------------------------- |
| `url`  | string | Full URL to the reference               |
| `type` | string | `official_docs` or `community_resource` |

## What Belongs in OrgPulse (and What Doesn't)

OrgPulse recommendations are **performance interventions**, not strategic initiatives. Before contributing a new recommendation, confirm:

**Accept criteria:**

- The recommendation addresses a problem observable in Scale Center metrics
- The `relevant_signals` array contains at least one signal that would realistically trigger this recommendation
- Implementing this recommendation measurably improves one or more of: request time, CPU time, error rates, concurrency, query performance, or resource consumption
- The recommendation is within the operational Salesforce platform scope (Apex, LWC, Data Model, Security, Integration, Automation)

**Reject criteria — do not contribute:**

- Recommendations whose primary value is customer experience or data unification
- Generic "adopt Data Cloud" or "adopt Agentforce" recommendations
- Strategic initiatives without a direct performance remediation angle
- Marketing, Commerce, or Service Cloud feature adoption guidance

When in doubt, ask: "Would this recommendation appear to a user whose only visible symptom is a Scale Center metric?" If the answer requires external context (a CxO meeting, a strategic review, a business case discussion), it is out of scope for OrgPulse.

## Real Examples of Rejected Recommendations

Here are recommendations that were removed from OrgPulse because they lacked a causal link to Scale Center metrics:

### Removed: "Security Audit: Upgrade to WITH USER_MODE"

- **Why removed:** WITH USER_MODE is a security best practice, not a performance intervention. Migrating from WITH SECURITY_ENFORCED to WITH USER_MODE does not measurably change runtime performance.
- **Where it belongs:** A Salesforce security audit tool, not a performance diagnostic tool.

### Removed: "Increase Apex Test Coverage"

- **Why removed:** Apex Test Coverage is a DevOps and code quality concern. Tests run during deployment, not in production transactions. An org with 50% coverage can perform identically to one with 95% coverage.
- **Where it belongs:** DevOps Center or a code quality tool.

### Removed: "Migrate from Profiles to Permission Set Groups"

- **Why removed:** Security governance and auditability concern. The permission lookup happens internally regardless of how permissions are structured — runtime performance is unaffected.
- **Where it belongs:** Salesforce Optimizer or a permissions audit tool.

### The Test

Before contributing a recommendation, ask: _"Would a user see this recommendation triggered by a specific Scale Center metric?"_ If you cannot name the metric that triggers it (beyond the wildcard `"*"`), the recommendation probably does not belong in OrgPulse.

## Contributing Modern Patterns

OrgPulse prioritizes current Salesforce best practices over legacy approaches. When adding recommendations, prefer:

| Modern                                     | Over Legacy                           |
| ------------------------------------------ | ------------------------------------- |
| LWC                                        | Aura                                  |
| GraphQL Wire Adapter (`lightning/graphql`) | Imperative Apex calls                 |
| `WITH USER_MODE`                           | `WITH SECURITY_ENFORCED`              |
| Named Credentials + External Credentials   | Hardcoded endpoints                   |
| Platform Events + CDC via Pub/Sub API      | Synchronous callouts, CometD          |
| Flow (Record-Triggered, Screen, Scheduled) | Process Builder (retired)             |
| Permission Set Groups                      | Profile-based permissions             |
| Zero Copy Federation (for LDV performance) | Manual ETL, storage limit workarounds |
| Queueable Apex with chaining               | `@future` methods                     |
| Trigger Actions Framework / fflib          | Ad-hoc trigger logic                  |
| Dynamic Forms, Dynamic Related Lists       | Custom LWC for standard features      |

If your recommendation references a legacy pattern, include the modern alternative and a clear reason why the legacy is being discussed.

## Valid Signal Names

When setting `relevant_signals`, use ONLY these validated metric identifiers:

**Counter metrics (from OCR):**
`successful_logins`, `failed_logins`, `concurrent_apex_errors`, `concurrent_ui_errors`, `row_lock_errors`, `total_callout_errors`

**Chart metrics (from Vision analysis):**
`total_execution_errors`, `average_request_time`, `total_request_volume`, `total_cpu_time`, `total_logins`, `average_callout_time`, `total_callout_errors_detail`

**Derived signals (from correlation analysis):**
`db_cpu_time`, `apex_execution_time`, `ui_request_time`, `slow_transactions`, `concurrent_requests`, `concurrent_dml`, `callout_time`, `error_rate`, `slow_soql`, `full_table_scan`

**Wildcard:**
`*` — matches any detected signal (use sparingly for universally applicable recommendations)

## Step-by-Step: Adding a Recommendation

### 1. Choose the Right Matrix Cell

| Cell            | Impact | Effort | Example Use Cases                      |
| --------------- | ------ | ------ | -------------------------------------- |
| `quick-wins`    | High   | Low    | Index creation, sharing rule cleanup   |
| `prioritize`    | High   | Medium | Apex optimization, trigger refactoring |
| `strategic`     | High   | High   | Architecture redesign, org split       |
| `take-along`    | Medium | Low    | Error handling, flow cleanup           |
| `evaluate`      | Medium | Medium | Login analysis, integration review     |
| `weigh-up`      | Medium | High   | LWC migration, performance audit       |
| `opportunistic` | Low    | Low    | Field cleanup, log optimization        |
| `defer`         | Low    | Medium | Test coverage, permission migration    |
| `skip`          | Low    | High   | Full rewrites, custom UI replacements  |

### 2. Write Your Recommendation

- **Title:** Concise and specific (5-10 words)
- **Body:** Explain what to do, why, and how. Be actionable.
- **Tags:** Use existing tags where possible. Modern pattern tags get a visual accent.
- **Relevant signals:** Which detected metrics make this recommendation applicable.
- **Root cause types:** What category of problem does this address.
- **References:** Include Salesforce official documentation links when available.

### 3. Edit the JSON File

Open `src/data/recommendations.json` and add your recommendation to the appropriate cell's `recommendations` array.

### 4. Add Yourself as Contributor

Add your GitHub handle to the cell's `contributors` array.

### 5. Validate and Submit

Run `npm run build` to ensure the JSON is valid. Then submit a PR or open a [Matrix Recommendation issue](../.github/ISSUE_TEMPLATE/matrix_recommendation.md).

## Quality Checklist

- [ ] Title is concise and specific
- [ ] Body is actionable (tells the reader _what_ to do)
- [ ] Correct matrix cell chosen (Impact vs. Effort)
- [ ] `relevant_signals` uses valid signal names from the list above
- [ ] `root_cause_types` uses valid values
- [ ] Tags are relevant — modern patterns preferred
- [ ] References link to official Salesforce documentation
- [ ] JSON is valid (`npm run build` passes)
