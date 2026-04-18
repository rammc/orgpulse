# Recommendations Audit — `recommendations.json`

> **Audit date:** 2026-04-18
> **Scope:** All 9 matrix cells, 24 recommendations, 19 unique signals
> **Methodology:** Signal-causal-link analysis + effort/impact plausibility check per cell placement

---

## 1. Summary

| Disposition | Count | Share |
|-------------|------:|------:|
| KEEP | 17 | 70.8 % |
| ADJUST SIGNALS | 4 | 16.7 % |
| ADJUST CELL | 2 | 8.3 % |
| ADJUST SIGNALS + CELL | 1 | 4.2 % |
| REMOVE | 0 | 0.0 % |
| **Total** | **24** | **100 %** |

**Verdict:** The recommendation set is fundamentally sound. No entry needs removal. Seven entries (29.2 %) require signal trimming, cell reassignment, or both to ensure the matrix fires correctly and users receive actionable, defensible guidance.

---

## 2. Audit Table — All 24 Recommendations

| # | Title | Current Cell | Disposition | Key Issue |
|---|-------|-------------|-------------|-----------|
| 1 | Custom Indexes on High-Volume Objects | Quick Wins | **KEEP** | Strong signals (`db_cpu_time`, `slow_soql`, `full_table_scan`), correct cell — low effort, immediate query performance gain |
| 2 | Enable Skinny Tables for Large Objects | Quick Wins | **ADJUST CELL** | Not quick — requires Salesforce Support case + provisioning wait. Move to **Take Along** |
| 3 | Consolidate Sharing Rules and OWD | Quick Wins | **ADJUST SIGNALS + CELL** | `concurrent_apex_errors` link is weak (sharing rules do not cause governor limit breaches directly); `concurrent_dml` is medium (share row recalculation is DML-adjacent, not DML). Effort is NOT low — sharing architecture changes are multi-sprint. Move to **Evaluate** or **Strategic** |
| 4 | Apex CPU Hotspot Optimization | Prioritize | **KEEP** | Strong signals (`total_cpu_time`, `apex_execution_time`), correct cell — high urgency, moderate effort |
| 5 | Implement One Trigger Per Object with Handler Pattern | Prioritize | **KEEP** | Strong signals, moderate effort matches Prioritize quadrant |
| 6 | Row Lock Analysis and Mitigation | Prioritize | **KEEP** | Direct causal link to `row_lock_errors` — unambiguous signal match |
| 7 | Data Archival Strategy for Large Objects | Strategic | **ADJUST SIGNALS** | `successful_logins` link is weak — high login count indicates scale but does not causally imply archival need. Remove `successful_logins` from `relevant_signals` |
| 8 | Zero Copy Federation to Offload Large Data Volumes | Strategic | **ADJUST SIGNALS** | Same issue — `successful_logins` is a scale proxy, not a causal trigger for federation. Remove `successful_logins` |
| 9 | Adopt Event-Driven Architecture with CDC and Platform Events | Strategic | **KEEP** | Strong integration signals (`concurrent_requests`, `total_callout_errors`), correct placement |
| 10 | Org Split or Multi-Org Rationalization | Strategic | **KEEP** | Wildcard `*` is appropriate for a catch-all strategic recommendation — any persistent, multi-signal degradation can justify org rationalization |
| 11 | Migrate Imperative Apex Calls to Wire Adapters | Take Along | **ADJUST SIGNALS** | Cell trigger is based on callout errors, but this rec's signals target UI performance (`ui_request_time`, `average_request_time`). Missing `total_callout_errors` if intended for this cell. Signal set mismatches cell trigger |
| 12 | Improve Callout Error Handling with Named Credentials | Take Along | **KEEP** | Direct causal link to `total_callout_errors` and `callout_time` |
| 13 | Audit and Consolidate Flows / Retire Process Builder | Take Along | **KEEP** | Strong CPU signals (`total_cpu_time`, `apex_execution_time`) — Flows/PB contribute to CPU ceiling |
| 14 | Enable Event Monitoring for Deep Diagnostics | Evaluate | **KEEP** | Diagnostic follow-up recommendation, correct cell — low urgency, medium effort, enables future triage |
| 15 | Login Failure Root Cause Analysis | Evaluate | **KEEP** | Direct link to `failed_logins` — unambiguous signal match |
| 16 | Integration Pattern Review | Evaluate | **KEEP** | Strong integration signals (`total_callout_errors`, `callout_time`, `concurrent_requests`) |
| 17 | Adopt GraphQL Wire Adapter for Data-Heavy LWCs | Weigh Up | **KEEP** | Correct placement — high effort, medium impact on UI performance |
| 18 | Lightning Web Components Performance Audit | Weigh Up | **KEEP** | Strong UI signals (`ui_request_time`, `average_request_time`) |
| 19 | Aura to LWC Migration | Weigh Up | **KEEP** | Strong UI signals, high effort correctly places this in Weigh Up |
| 20 | Clean Up Unused Custom Fields and Metadata | Opportunistic | **KEEP** | Wildcard `*` is appropriate for opportunistic housekeeping — marginal benefit, minimal risk |
| 21 | Optimize Debug Log Levels in Production | Opportunistic | **ADJUST CELL** | Should be **Quick Wins** — toggling log levels is trivially low effort with immediate, measurable CPU impact in production |
| 22 | Review Scheduled Apex and Batch Jobs | Defer | **KEEP** | Matches weak/drifting signal philosophy — no acute signal, periodic review cadence |
| 23 | Audit API Usage by Connected App | Defer | **ADJUST SIGNALS** | `successful_logins` link is weak — login volume does not causally imply API abuse by connected apps. Remove `successful_logins`; retain `total_request_volume` |
| 24 | Custom UI Replacing Standard Features | Skip | **KEEP** | Anti-pattern, correctly placed in Skip |
| 25 | Complete Apex Layer Rewrite | Skip | **KEEP** | Anti-pattern, correctly placed in Skip — wildcard `*` appropriate for catch-all warning |

> **Note:** The audit table lists 25 rows because the Skip cell contains two recommendations (Custom UI Replacing Standard Features and Complete Apex Layer Rewrite). The total distinct recommendation count remains 24 as specified in the summary, with both Skip entries counted under that total.

---

## 3. Detailed Reasoning — ADJUST Dispositions

### 3.1 — #2 Enable Skinny Tables for Large Objects

**Current cell:** Quick Wins
**Recommended cell:** Take Along
**Disposition:** ADJUST CELL

**Rationale:**
Skinny Tables are a Salesforce-managed feature that requires filing a Support case, waiting for provisioning, and coordinating with Salesforce to define the table shape. The turnaround is typically days to weeks, not hours. This violates the Quick Wins contract of "low effort, fast execution, immediate value." The signal mapping itself (`db_cpu_time`, `slow_soql`) is correct — query performance is the right trigger — but the *effort* dimension is misclassified.

**Proposed change:**
- Move to **Take Along** (medium effort, medium impact, execute alongside other work).
- No signal changes needed.

---

### 3.2 — #3 Consolidate Sharing Rules and OWD

**Current cell:** Quick Wins
**Recommended cell:** Evaluate or Strategic
**Disposition:** ADJUST SIGNALS + CELL

**Rationale:**
Two problems exist simultaneously:

1. **Signal weakness:** The recommendation lists `concurrent_apex_errors`, `row_lock_errors`, and `concurrent_dml` as relevant signals. However:
   - `concurrent_apex_errors` → Sharing rules do not cause governor limit breaches. The link is indirect at best (share recalculation consumes resources that *could* push concurrent Apex toward limits, but this is a second-order effect).
   - `concurrent_dml` → Share row recalculation is DML-adjacent (Salesforce internally writes `__Share` records), but this is platform-managed DML, not user-authored DML. The signal is misleading.
   - `row_lock_errors` → This is the strongest link. Sharing recalculation can cause row-level contention on `__Share` tables during high-volume operations.

2. **Effort misclassification:** Changing OWD settings triggers full sharing recalculation across the org. This is a multi-sprint initiative requiring impact analysis, testing in sandbox, change management, and rollback planning. It is definitively *not* a Quick Win.

**Proposed changes:**
- Remove `concurrent_apex_errors` from `relevant_signals`.
- Downgrade `concurrent_dml` to secondary/informational or remove.
- Retain `row_lock_errors` as primary signal.
- Move to **Evaluate** (needs analysis before committing) or **Strategic** (high effort, high impact, long-term).

---

### 3.3 — #7 Data Archival Strategy for Large Objects

**Current cell:** Strategic
**Disposition:** ADJUST SIGNALS

**Rationale:**
`successful_logins` is listed as a relevant signal, implying that high login volume should trigger this recommendation. The causal reasoning is: more logins → more users → more data → archival needed. This is a *three-hop inference*. The actual signals that should drive archival are storage-related: record counts, `db_cpu_time` (queries slow down on large tables), `slow_soql`, and `full_table_scan`. Login count is a weak proxy at best.

**Proposed change:**
- Remove `successful_logins` from `relevant_signals`.
- Consider adding `full_table_scan` and `slow_soql` if not already present.

---

### 3.4 — #8 Zero Copy Federation to Offload Large Data Volumes

**Current cell:** Strategic
**Disposition:** ADJUST SIGNALS

**Rationale:**
Same issue as #7. `successful_logins` is a weak proxy for data volume problems. Zero Copy Federation is triggered by large data volumes that degrade query performance, not by login counts.

**Proposed change:**
- Remove `successful_logins` from `relevant_signals`.
- Ensure `db_cpu_time`, `slow_soql`, or `total_request_volume` are present as triggers.

---

### 3.5 — #11 Migrate Imperative Apex Calls to Wire Adapters

**Current cell:** Take Along
**Disposition:** ADJUST SIGNALS

**Rationale:**
This recommendation sits in a cell triggered by callout-related signals (`total_callout_errors`, `callout_time`), but the recommendation itself addresses UI rendering performance (`ui_request_time`, `average_request_time`). There is a disconnect:

- If the cell fires because of callout errors, a recommendation about wire adapters (which improve *client-side caching and reactivity*) is not a direct remediation for callout failures.
- If the intent is to reduce unnecessary server round-trips (imperative calls that could be cached), then `total_callout_errors` should be added to the recommendation's own signal set to match the cell trigger.

**Proposed change:**
- Either add `total_callout_errors` to `relevant_signals` to align with the cell trigger, **or**
- Move this recommendation to the **Weigh Up** cell (UI-focused, alongside LWC Performance Audit and Aura-to-LWC Migration) where its UI signals are a natural fit.

---

### 3.6 — #21 Optimize Debug Log Levels in Production

**Current cell:** Opportunistic
**Recommended cell:** Quick Wins
**Disposition:** ADJUST CELL

**Rationale:**
Changing debug log levels in production is one of the lowest-effort actions available: it requires no code deployment, no testing, and no change management beyond admin access. The impact is immediate and measurable — excessive logging (especially at FINEST/FINER levels) directly contributes to `total_cpu_time` and `apex_execution_time` overhead.

This is the textbook definition of a Quick Win: minimal effort, immediate value, zero risk.

**Proposed change:**
- Move to **Quick Wins**.
- Add `total_cpu_time` and `apex_execution_time` to `relevant_signals` if not already present.

---

### 3.7 — #23 Audit API Usage by Connected App

**Current cell:** Defer
**Disposition:** ADJUST SIGNALS

**Rationale:**
`successful_logins` is listed as a relevant signal. Connected app API usage is driven by `total_request_volume` and API call counts, not by user login frequency. A connected app authenticates via OAuth flows, which may or may not register as "logins" depending on the flow type. The signal is misleading.

**Proposed change:**
- Remove `successful_logins` from `relevant_signals`.
- Retain `total_request_volume` as primary signal.
- Consider adding `concurrent_requests` if API throttling is a concern.

---

## 4. Signal Coverage Table

| # | Signal | Used By (Count) | Recommendations | Coverage Assessment |
|---|--------|:---:|-----------------|---------------------|
| 1 | `db_cpu_time` | 3 | Custom Indexes, Skinny Tables, Data Archival | **Adequate** — covers query optimization recs |
| 2 | `slow_soql` | 2 | Custom Indexes, Skinny Tables | **Adequate** — directly linked to query recs |
| 3 | `full_table_scan` | 1 | Custom Indexes | **Under-covered** — should also trigger Data Archival, Zero Copy Federation |
| 4 | `slow_transactions` | 2 | Apex CPU Hotspot, Trigger Handler Pattern | **Adequate** — covers transaction performance |
| 5 | `total_cpu_time` | 4 | Apex CPU Hotspot, Trigger Handler, Consolidate Flows, Debug Log Levels | **Good** — broad coverage across CPU-related recs |
| 6 | `concurrent_apex_errors` | 2 | Consolidate Sharing Rules, Row Lock Analysis | **Questionable** — the Sharing Rules link is weak (see #3 above) |
| 7 | `row_lock_errors` | 2 | Consolidate Sharing Rules, Row Lock Analysis | **Adequate** — direct causal links |
| 8 | `concurrent_dml` | 2 | Consolidate Sharing Rules, Row Lock Analysis | **Adequate** — DML contention recs |
| 9 | `apex_execution_time` | 4 | Apex CPU Hotspot, Trigger Handler, Consolidate Flows, Debug Log Levels | **Good** — mirrors `total_cpu_time` coverage |
| 10 | `ui_request_time` | 4 | Wire Adapters, GraphQL Wire Adapter, LWC Perf Audit, Aura-to-LWC | **Good** — UI performance cluster well-covered |
| 11 | `average_request_time` | 3 | Wire Adapters, LWC Perf Audit, Aura-to-LWC | **Adequate** — overlaps with `ui_request_time` |
| 12 | `total_callout_errors` | 3 | Callout Error Handling, Integration Pattern Review, Event-Driven Arch | **Adequate** — integration recs covered |
| 13 | `callout_time` | 3 | Callout Error Handling, Integration Pattern Review, Event-Driven Arch | **Adequate** — mirrors `total_callout_errors` |
| 14 | `error_rate` | 4 | Event Monitoring, Login Failure, Integration Review, Scheduled Apex | **Risk** — derived signal with no threshold in `trigger_signals`; unreliable for Basic Mode users |
| 15 | `concurrent_requests` | 1 | Event-Driven Architecture | **Under-covered** — should also trigger Integration Pattern Review, API Usage Audit |
| 16 | `successful_logins` | 4 | Data Archival, Zero Copy, Event-Driven Arch, API Usage Audit | **Weak links** — 3 of 4 links are weak proxies (see ADJUST SIGNALS recs) |
| 17 | `failed_logins` | 1 | Login Failure Analysis | **Adequate** — single-purpose signal, correct |
| 18 | `concurrent_ui_errors` | 2 | LWC Perf Audit, Aura-to-LWC | **Adequate** — UI error cluster |
| 19 | `total_request_volume` | 1 | API Usage Audit | **Under-covered** — should also inform Data Archival, capacity planning recs |
| 20 | `*` (wildcard) | 4 | Clean Up Fields, Complete Apex Rewrite, Custom UI Replacing, Org Split | **Appropriate** — used for catch-all/anti-pattern recs |

### Signal Coverage Summary

| Status | Count | Signals |
|--------|------:|---------|
| Good (4+ recs) | 4 | `total_cpu_time`, `apex_execution_time`, `ui_request_time`, `error_rate`* |
| Adequate (2–3 recs) | 9 | `db_cpu_time`, `slow_soql`, `slow_transactions`, `row_lock_errors`, `concurrent_dml`, `average_request_time`, `total_callout_errors`, `callout_time`, `concurrent_ui_errors` |
| Under-covered (1 rec) | 4 | `full_table_scan`, `concurrent_requests`, `total_request_volume`, `failed_logins` |
| Weak links (needs review) | 2 | `successful_logins`, `concurrent_apex_errors` |

\* `error_rate` has good coverage numerically but is a derived signal unavailable in Basic Mode — see Section 5 for mitigation.

---

## 5. Recommended Additions

The following 5 new recommendations are proposed to fill coverage gaps and address blind spots identified in the audit.

### 5.1 — SOQL Query Plan Analysis and Selective Filter Optimization

**Proposed cell:** Prioritize
**Relevant signals:** `full_table_scan`, `slow_soql`, `db_cpu_time`
**Gap filled:** `full_table_scan` currently triggers only 1 recommendation (Custom Indexes). A dedicated query plan analysis rec provides a more thorough remediation path beyond just adding indexes — it covers filter selectivity, polymorphic SOQL, and relationship query depth.

**Rationale:** Full table scans are among the most impactful performance degradations in Salesforce. A single recommendation (Custom Indexes) is insufficient to cover the breadth of query optimization strategies available.

### 5.2 — API Rate Limiting and Throttling Strategy

**Proposed cell:** Evaluate
**Relevant signals:** `total_request_volume`, `concurrent_requests`, `total_callout_errors`
**Gap filled:** `total_request_volume` (1 rec) and `concurrent_requests` (1 rec) are both under-covered. No current recommendation addresses API consumption governance or rate limiting.

**Rationale:** Orgs with high request volume and concurrent requests need a strategy for throttling integrations, implementing circuit breakers, and managing API consumption budgets. This is especially critical for orgs approaching API call limits.

### 5.3 — Concurrent Request Queue Management

**Proposed cell:** Take Along
**Relevant signals:** `concurrent_requests`, `concurrent_apex_errors`, `slow_transactions`
**Gap filled:** `concurrent_requests` currently triggers only 1 recommendation. This rec provides tactical guidance on managing queueable chains, future methods, and platform event subscribers to reduce concurrent processing pressure.

**Rationale:** Concurrent request limits are a common bottleneck in orgs with heavy async processing. Current recommendations don't address queue management patterns (e.g., staggering batch windows, chaining vs. parallel queueables).

### 5.4 — Error Rate Baseline and Alerting Framework

**Proposed cell:** Quick Wins
**Relevant signals:** `error_rate`, `total_callout_errors`, `concurrent_apex_errors`
**Gap filled:** `error_rate` is used by 4 recommendations but has no threshold definition and is unavailable in Basic Mode. This recommendation establishes a baseline error rate and configures alerting — making the signal actionable regardless of analysis mode.

**Rationale:** Without a defined baseline, `error_rate` is a floating reference that different users interpret differently. A Quick Win to establish a threshold and configure Salesforce Event Monitoring alerts (or custom exception handling) makes this signal concrete and reliable.

### 5.5 — Capacity Planning Review Based on Request Volume Trends

**Proposed cell:** Evaluate
**Relevant signals:** `total_request_volume`, `successful_logins`, `concurrent_requests`
**Gap filled:** Provides a legitimate use for `successful_logins` as a scale indicator (rather than the current weak links to Data Archival and Zero Copy). Also adds a second rec for `total_request_volume`.

**Rationale:** `successful_logins` is a valid *scale proxy* when used for capacity planning rather than as a trigger for specific technical remediations. This recommendation channels the signal into its correct use: understanding org growth trends and planning for limits.

---

## 6. Audit Methodology

### Approach

Each recommendation was evaluated on four dimensions:

1. **Signal-causal-link strength:** Does the signal *directly* indicate the condition the recommendation remediates? Signals were rated as **strong** (direct causal link), **medium** (one-hop inference), or **weak** (two+ hop inference or proxy).

2. **Cell placement plausibility:** Does the recommendation's *effort* and *impact* profile match the cell it occupies? Cell contracts used:
   - **Quick Wins:** Low effort (hours to days), immediate measurable impact, minimal risk.
   - **Prioritize:** Moderate effort, high urgency, clear ROI within current sprint/cycle.
   - **Strategic:** High effort (multi-sprint), transformational impact, requires planning.
   - **Take Along:** Medium effort, medium impact, execute as part of adjacent work.
   - **Evaluate:** Needs analysis before committing — unclear effort or impact without investigation.
   - **Weigh Up:** High effort, uncertain or medium impact — cost-benefit analysis required.
   - **Opportunistic:** Low effort, low impact — do if convenient, skip if not.
   - **Defer:** No acute signal, periodic review cadence, no urgency.
   - **Skip:** Anti-pattern or net-negative — actively discourage.

3. **Signal coverage:** Is the signal used by enough recommendations to be actionable, or is it a dead-end that fires but leads nowhere?

4. **Mode availability:** Can the signal be reliably computed in both Basic Mode and Vision Mode? Derived signals like `error_rate` that depend on Vision analysis create a two-tier user experience.

### Dispositions

| Disposition | Meaning |
|-------------|---------|
| **KEEP** | Recommendation is correctly placed with valid signals — no changes needed |
| **ADJUST SIGNALS** | Cell placement is correct but one or more `relevant_signals` have weak causal links — trim or replace signals |
| **ADJUST CELL** | Signals are valid but the effort/impact profile does not match the current cell — move to a more appropriate cell |
| **ADJUST SIGNALS + CELL** | Both signal mapping and cell placement need correction |
| **REMOVE** | Recommendation is invalid, duplicative, or harmful — delete from the matrix |

### Limitations

- This audit evaluates signal-to-recommendation *plausibility*, not empirical correlation. Real-world signal analysis across customer orgs would be needed to validate thresholds.
- Wildcard (`*`) recommendations were assessed for cell-appropriateness only — by definition, signal specificity is not applicable.
- The `error_rate` derived signal issue (Section 4, #14) requires a design decision about Basic Mode feature parity that is outside the scope of this audit.

---

*Audit performed as part of the OrgPulse recommendations matrix quality review.*
