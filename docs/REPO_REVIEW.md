# OrgPulse Repository Review — 2026-04-19

**Reviewer:** Claude Code
**Scope:** Code quality and strategic product coherence
**Method:** Direct source reading, end-to-end flow tracing, build verification, documentation review

---

## Executive Summary

OrgPulse is in solid shape for a public-beta product shown at a community conference. The domain content — the 9-cell matrix, the Scale Center metric vocabulary, the recommendation library, the Vision prompt — is the real asset, and it is unusually disciplined for a side project. A visitor poking around the app in Tirana will see something that feels thoughtful, not thrown together.

The codebase telling the story is less disciplined than the story. `src/js/matrix.js` (1070 lines) is the app's entry point and god-object: it handles onboarding, upload, mode toggle, OCR/Vision orchestration, counter reconciliation, severity application, priority ranking, detail panels, and an OCR debug console. `src/ui/metadataSection.js` (646 lines) repeats the same mistake on the local-mode side. Testing is symbolic — one file, covering the markdown exporter with substring assertions. CI runs lint and build but never the tests. Two Claude API call sites exist (`vision.js` and `api/claudeClient.js`) with different error models, and `vision.js` ships no timeout. Pattern metadata is duplicated between `fixSuggester.js` and `metadataSection.js`. The model IDs in the AI call sites are one minor version behind (`claude-sonnet-4-5-20250929`; current Sonnet is 4.6, Haiku is 4.5).

What's strongest: the `recommendations.json` content quality, the `RECOMMENDATIONS_AUDIT.md` self-critique, the Vision prompt's metric whitelist discipline, the onboarding/sample-screenshot experience, and the scope honesty in README ("What OrgPulse does NOT do"). What's weakest: test coverage, the monolithic `matrix.js`, the non-enforced public/local bundle split (the metadata chunk ships in public builds at ~19 kB gzipped because of a dynamic import that is traced at build time), and a CHANGELOG that doesn't reflect any of the last 40 commits. None of these block the conference.

---

## Section 1: Code Quality Findings

### 1.1 Architecture and Module Boundaries

**`src/js/matrix.js` is not what its name says it is.** It's the application entry point (loaded from `index.html:412`), the analysis orchestrator, the upload-flow controller, the priority ranking renderer, the detail panel renderer, the counter reconciler, and the OCR debug console. Renaming it `app.js` or `main.js` wouldn't fix the structure, but it would stop misleading readers. The responsibilities should split into at least three files — `upload.js` (file selection + preview), `analysis.js` (OCR/Vision/reconciliation), `render/matrix.js` + `render/detailPanel.js` + `render/priorityRanking.js`.

**Two Claude API call sites exist, and only one is production-grade.** `src/api/claudeClient.js` has a typed `ClaudeApiError` class, AbortController-based timeouts, retry-hint flags on errors, and structured parsing. `src/js/vision.js:71-142` makes the same call inline with no timeout, no abort, and string-based error discrimination (`error.message === 'RATE_LIMITED'`). They were written at different times — `claudeClient.js` landed in commit `6238211` after `vision.js` was stable — and `vision.js` was never migrated. If Anthropic's API hangs, the Vision flow hangs forever. The inline call also carries ~50 lines of system prompt string that belong in a constant or its own file.

**Public/local split does not actually produce different bundles.** Both `npm run build` and `npm run build:local` emit the same 8 files:

```
index.html                           16.82 kB
assets/index-C3wRe909.js             50.23 kB (main app)
assets/metadataSection-CMLOofVV.js   59.02 kB (should be local-only)
assets/recommendations-Dx9Zj5K5.js   32.53 kB
assets/index-CxM0QWj5.js             17.36 kB (tesseract bootstrap)
assets/main.css                      31.62 kB
assets/metadataSection.css           10.56 kB (should be local-only)
features-DpmDGhdJ.js                  0.19 kB
```

The `features.js` flag is checked at runtime (`matrix.js:73-81`), but the dynamic `import('../ui/metadataSection.js')` sits inside a try block — Vite traces it at build time regardless of the flag and ships it as a chunk in both builds. The public site at `rammc.github.io/orgpulse` therefore downloads ~19 kB gzipped of metadata analyzer code and 2.3 kB gzipped of its CSS that can never execute. The README's claim that metadata analysis is "not deployed" is true for behavior but not for bytes. Fix: wrap the dynamic import behind an environment check at the *module boundary* (e.g. a separate entry point for local mode, or a Vite `define` that the build can tree-shake).

**Metadata module imports cross the module boundary in both directions.** `metadataSection.js:8-9` imports `fixSuggester` and `fixCache` from `../metadata/fixSuggestions/` directly, bypassing `src/metadata/index.js`'s intended facade (which exports only `runMetadataAnalysis`, layout detection, and signal helpers). `fixSuggester.js:1` then imports `../../api/claudeClient.js` from *outside* the metadata module. Either the facade is authoritative or it isn't — right now it's decorative.

**Pattern metadata is duplicated.** `src/ui/metadataSection.js:31-135` has a `PATTERN_METADATA` map with `displayName`, `whyItMatters`, `howToFix`, `scaleCenterSymptoms` for each detectable pattern. `src/metadata/fixSuggestions/fixSuggester.js:8-50` has a `PATTERN_INFO` map for the same patterns with shorter `whyItMatters` strings. When someone adds `FLOW_SYNC_CALLOUT_BEFORE_SAVE` in six months, they will update one place and not the other, and no test will catch it. This should be a single file in `src/metadata/patterns.js` exporting one map, consumed by both.

### 1.2 Code Readability and Style

Naming is generally good — `reconcileCounters`, `assessOcrCertainty`, `detectLayout`, `classifyCalloutAction` tell you what they do without a comment. The exception is `matrix.js` the filename, already discussed.

**Function length is mostly reasonable, with exceptions.** `matrix.js:openDetailPanel` is ~145 lines building one HTML string; `matrix.js:displayResults` is ~235 lines threading between counter cards, OCR fallback banner, signals, confidence, clearances, validation info, scoring, ranking, and event dispatch. `metadataSection.js:renderGroupedFindings` mixes grouping, rendering, and event wiring in one 100-line pass. Decomposing these is the single biggest readability improvement available.

**Inline `onclick` strings leak into rendered HTML.** `matrix.js:410` and `matrix.js:939` both use `onclick="this.closest(...)...; this.textContent = ..."` embedded in template strings. `metadataSection.js:305` has `onclick="window._expandPattern(...)"` with a companion global at `metadataSection.js:639`. These are small UI toggles, not security bombs, but they make behavior unsearchable — if someone wants to find "what happens when I click Show All Recommendations", grep turns up nothing. Event delegation on the panel's container would erase the entire pattern.

**Counter key lists are hardcoded in five places.** `ocr.js:32-39` (`COUNTER_KEYS`), `matrix.js:603-611` (`reconcileCounters.ALL_COUNTERS`), `matrix.js:769-776` and `matrix.js:843-850` (`counterLabels` — literally twice in the same function, for the basic-result and deep-only-result branches), `validation.js:2-9` (`VALID_COUNTER_METRICS`), and `recommendations.js:169-176` (`counterLabels` again). Adding a seventh counter means editing five files. Canonical source belongs somewhere like `src/js/metrics.js`.

**Inline SVGs everywhere.** Nine icons are declared in an `ICONS` constant at `matrix.js:12-29`, but then ~15 more SVGs are spliced inline into template strings throughout `matrix.js`, `metadataSection.js`, and `markdownExporter.js`. An `icons.js` module returning SVG strings would halve the file length of several functions and centralize sizing/color conventions.

**Commented-out code: essentially none.** A real strength. The git history shows the author iterating on OCR preprocessing without leaving vestigial branches behind.

**TODO/FIXME markers: none.** Not a sign of perfection — a sign of "notes live in issues, not in code," which is the right preference.

### 1.3 Error Handling and Edge Cases

**Good patterns:**
- `vision.js:146-157` distinguishes HTTP 401 (invalid key), 429 (rate limit), and other statuses, and `getVisionErrorMessage` produces user-friendly messages.
- `validation.js` rejects hallucinated metric names rather than crashing and surfaces the rejection count in the UI.
- `reconcileCounters` (`matrix.js:602`) handles four combinations of presence/absence between OCR and Vision counters.
- `fs/fileReader.js` caps at 2 MB and returns a typed `{ skipped, reason }` record rather than throwing.

**Weak patterns:**
- `matrix.js:79` — `try { ... } catch { /* features.js not available or not local mode */ }`. `features.js` is part of the source bundle; if the import throws, the right response is "something is broken," not silent pass. Empty-catch-with-comment is hiding a real failure mode.
- `vision.js` has no network timeout. If the API hangs, the analyze button stays disabled until the user reloads.
- `fixCache.js` wraps `sessionStorage` in try/catch and swallows errors silently — quota issues become "cache not working, no one knows why."
- `ocr.js:277` calls `worker.terminate()` only on the success path. An exception during OCR leaks a Tesseract worker.
- `metadataSection.js:210` and several sibling locations `innerHTML` metric names coming from a chain of sources. In practice those names pass through `validation.js` against a fixed whitelist, so this isn't a live XSS — but it's hygiene that `textContent` (or an escape helper) would resolve cheaply.

**Model drift:** `vision.js:80` calls `claude-sonnet-4-5-20250929` and `fixSuggester.js:5` declares the same Sonnet ID. The current Sonnet is 4.6 (`claude-sonnet-4-6`) and Haiku is 4.5 (`claude-haiku-4-5-20251001`, which `fixSuggester.js:4` already uses correctly). Results are likely identical for this use case, but the repo will drift further if nothing forces these IDs to stay current.

### 1.4 Testing

**The test suite is one file** — `tests/ui/markdownExporter.test.js`, 94 lines, 10 substring-presence assertions against the markdown exporter output. `npm test` runs clean in 800 ms.

Everything else is untested:
- No test for `recommendations.js` — the scoring engine, arguably the product's core logic.
- No test for `ocr.js` layout detection or counter extraction.
- No test for `vision.js` JSON extraction (the regex chain at line 171-192 handles several edge cases).
- No test for `validation.js` metric whitelisting.
- No test for any analyzer — `apexCpuAnalyzer`, `apexRowLockAnalyzer`, `flowAnalyzer`, `flowParser`.
- No test for `reconcileCounters`.
- No integration test for the screenshot-to-matrix pipeline, even against the bundled `scale-center-sample.png` with `SAMPLE_EXPECTED` values (`matrix.js:981` already declares the expected counters — they exist only to color an OCR diagnostic table).

**CI does not run tests.** `.github/workflows/ci.yml` executes `npm ci`, `npm run lint`, `npm run build` — that's it. The one test file could silently regress and no PR would fail.

The tests that exist are "does the rendered string contain this substring"; they would pass if the exporter produced the output as one concatenated line. No parsing of the Markdown, no ordering assertions, no numeric verification (e.g., "hotspot files list is sorted by count descending").

This is the biggest latent risk in the codebase. The scoring logic in `recommendations.js` mixes thresholds, wildcards, root cause matching, and source merging; a single-line change can shift findings between matrix cells without anyone noticing. The `sample-screenshot` flow is a ready-made end-to-end test — load the bundled PNG, run analysis, assert that specific cells get specific scores — but nothing consumes it.

### 1.5 Dependencies and Build

**Runtime dependencies: exactly one.** `tesseract.js ^5.1.1`. Impressive restraint — most apps at this complexity pull in 15 packages they didn't need.

**Dev dependencies: five.** ESLint, Prettier, Vite, Vitest, and the ESLint JS config. All recent, all sensible.

**No vulnerability surface from the deps directly.** Tesseract.js has its own supply chain, but the project runs it in-browser rather than loading a CDN blob.

**Build is reproducible from a fresh clone.** `npm ci && npm run build` produces `dist/` in ~500 ms. `npm run build:local` is an alias that produces bit-identical output to `build` in this review (as noted in 1.1). Dependabot is configured for both npm and Actions on a weekly cadence (`.github/dependabot.yml`).

**Bundle size: 50 kB public bundle + 59 kB metadata chunk (gzipped: 16.5 + 18.9).** The main bundle is lean; the metadata chunk is the issue covered in 1.1. Tesseract itself lazy-loads when analysis starts, which is the right call.

### 1.6 Documentation

**README is useful and honest.** The "What OrgPulse does NOT do" list at lines 32-37 is the single most important paragraph in the repo — it sets expectations that every recommendation then respects. The Basic/Deep split, the BYOK privacy model, and the per-analysis cost ($0.02) are all clear. The AI Transparency section is unusual in how specific it is about what AI did and didn't do.

**`docs/architecture.md`** matches the code. Reads a bit abstract for a new contributor — doesn't show "here is the file you'd edit to add a new analyzer" — but the data-flow description is accurate.

**`docs/matrix-methodology.md`** does the work. The explicit list of what gets rejected (security initiatives, test coverage, DevOps changes, CX strategy) is the doc equivalent of the README's NOT-doing list and makes the boundary defensible under pushback.

**`docs/contributing-recommendations.md`** is a real schema reference. The quality checklist at the end (items a reviewer should verify before accepting) is the kind of thing most projects ship as a GitHub issue template and forget about.

**`docs/RECOMMENDATIONS_AUDIT.md`** (21 kB) is the most surprising artifact in the repo — a self-critical audit of the recommendation library naming seven of 24 recommendations as having signal-mapping problems, proposing five gap-fill entries, and flagging specific signal-cell mismatches (e.g., "Migrate Imperative Apex Calls to Wire Adapters" in Take Along triggered by callout errors when its actual signals are UI-timing). This audit is more honest than the recommendations it audits, which is the correct direction. What it isn't is *applied* — the `fix:` commits in the last week address some of it, but most entries haven't been closed out in the JSON.

**`BACKUP_RESTORE.md` at repo root is misplaced.** The contents describe recovering from the orgpulse-dev migration on 2026-04-17 — internal maintenance, not user-facing. Belongs in `.github/` or `docs/maintenance/`.

**`CHANGELOG.md` is not maintained.** The `[Unreleased]` section contains phase-level aspirations lifted from ROADMAP.md. The last 40 commits — specific features, fixes, and docs — have not been summarized. This isn't a blocker; it's a signal that release management is aspirational.

**Issue templates don't mirror the recommendation schema.** `.github/ISSUE_TEMPLATE/matrix_recommendation.md` asks for fields the `recommendations.json` schema doesn't use (and vice versa), so a contributor submitting via the template still has to rewrite their input to JSON. This matters more after Phase 1 goes public.

---

## Section 2: Strategic Product Findings

### 2.1 Positioning

The core positioning — "diagnose from a single screenshot" — is genuinely differentiated. PMD, Salesforce Code Analyzer, SonarQube, and ApexGuru all require source access or in-org execution. Scale Center itself surfaces the data but doesn't prioritize remediation. OrgPulse sits in the gap: it consumes the one artifact a CTA can pull from a locked-down prod org in thirty seconds and maps it to specific next steps.

**The Basic / Deep Analysis split is positioned clearly** — Basic is free, runs offline, extracts counters; Deep is BYOK, ~$0.02, reads charts. Both feed the same matrix. The mode toggle in the UI is clear enough.

**What's positioned weakly:** the relationship between the public build (screenshot only) and the local build (screenshot + metadata analysis). A conference attendee visiting the GitHub Pages URL will only see the screenshot half. The "Local build (self-hosted)" paragraph in the README gestures at a second product, but nothing in the live site tells a visitor that there's a second mode. The local mode is currently a hidden feature for people who read the README carefully.

### 2.2 User Flow Coherence

**The golden path works well.** Upload → analyze → see matrix → click cell → see signals + recommendations. The sample screenshot button (`matrix.js:482`) removes the "I don't have a screenshot handy" objection and auto-runs Basic mode. The "Try with a sample screenshot" CTA is one of the highest-leverage UX additions in the recent commit history.

**The recovery paths work well too.** If OCR can't read the image with confidence, the user sees an explicit "OCR couldn't reliably read this screenshot" banner with a one-click "Switch to Deep Analysis" button (`matrix.js:785-793`). This is the move — treat the failure as a graceful handoff, not an error state.

**Dead ends exist on the metadata side.** In local mode, a user can upload a screenshot, see the matrix, pick a project directory, and run metadata analysis. Fine. But if they didn't upload a screenshot first, the metadata section is mostly disabled — and nothing explains that the metadata analyzer needs signals from the screenshot to know which analyzers to run (`metadataSection.js:221`). A first-time local user clicking "Analyze" with no screenshot will hit an unexplained disabled button.

**The AI Fix suggestion panel** requires clicking the finding card to expand it, then clicking a second button to reveal the suggestion button, then clicking that. Three clicks to request a fix is one too many — the intermediate "reveal the button" step (commit `28ecb4f`) was added to avoid accidental API calls, but the result makes the feature feel hidden.

### 2.3 Messaging and Copy

**Landing page copy is precise.** "Diagnose your Salesforce org's performance from a single screenshot" is a specific promise, not a generic slogan. The onboarding cards (What is Scale Center / How the analysis works / The prioritization matrix) directly answer the three questions a new visitor actually has. The "Find it in your org: Setup → Scale Center → enable → wait ~2 hours" hint is the kind of concrete Salesforce-specific detail that signals the author knows their audience.

**Recommendation text quality is mostly strong.** "Custom Indexes on High-Volume Objects" includes tool names (Query Plan), thresholds (>100k records), and a verification step (check selectivity before filing the case). "Optimize Debug Log Levels in Production" quantifies the impact (up to 10% CPU overhead) and gives a proxy metric (50 MB/day log volume). These teach.

**Some Skip and Opportunistic cell entries are generic.** "Complete Apex Layer Rewrite" and "Custom UI Replacing Standard Features" read more like blog-post cautionary tales than Salesforce-specific guidance. They're defensibly in the Skip cell, which is by design where strategic anti-patterns live, but they're the weakest links in the library.

**Pattern explanations (in `fixSuggester.js` and `metadataSection.js`)** are short and task-oriented — "SOQL queries inside for-loops execute once per iteration" etc. The "Why / Scale Center Symptoms / How to Fix" three-section format is a good teaching pattern. The duplication between the two files is the only complaint.

### 2.4 Target Audience Fit

**The audience fit is correct for architects and CTAs.** The matrix vocabulary (Quick Wins, Strategic, Skip, etc.) is familiar to anyone who's run a prioritization session. The root cause types (compute, data, concurrency, integration, configuration) line up with how architects decompose performance problems. The scope exclusions (not CX strategy, not Agentforce readiness) match what architects don't want to see in a "performance tool."

**Adoption path in the first 30 seconds:** excellent. Land on the page → see the matrix greyed out → upload a screenshot or click the sample button → watch the matrix fill in with scores. This is the demo that sells the product.

**Adoption path for returning users:** thinner. Once you've seen the matrix light up for your screenshot, there's no reason to come back unless you have another screenshot. The local build is the multi-use mode, but it lives behind `npm run dev:local` and a File System Access API prompt in Chromium.

**Where the value lands strongest:** discovery (surfacing issues from a screenshot a user already has) and prioritization (the matrix placement is the durable takeaway). Remediation is a secondary promise — the recommendations are good starting points but they don't substitute for an architect actually reading the code.

### 2.5 Community Readiness

**What's there:** MIT license, CODEOWNERS, CODE_OF_CONDUCT, SECURITY.md, CONTRIBUTING.md, issue templates, PR template, Dependabot. For a solo-maintainer project this is above average.

**What's thin:** the PR template is minimal (no "ran lint/build/tests" checklist). The issue template for recommendations doesn't match the JSON schema, so contributions require translation. `CHANGELOG.md` isn't kept current. No tests run in CI, so PR validation is weaker than contributors might assume.

**If someone wanted to contribute recommendations:** the docs path works (`docs/contributing-recommendations.md` is a real schema reference with a quality checklist). The GitHub path creates friction because the issue template asks for different fields than the JSON uses.

**If someone wanted to contribute code:** `CONTRIBUTING.md` gives setup steps; the repo structure is readable enough that a new contributor can find the right file. The missing piece is a `docs/how-to-add-an-analyzer.md` or similar — the `metadata/README.md` gestures at the right steps but doesn't walk them.

### 2.6 Strategic Risks

**Biggest single risk to success:** Salesforce changes the Scale Center UI layout. The OCR pipeline (`ocr.js`) is calibrated against a specific 2952×4648 sample with hardcoded ratios (`ORG_PERF_LAYOUT.numberRowTop: 0.113`). Any dashboard refresh breaks the public mode — and the public mode *is* the conference-visible demo. Mitigation: the Vision fallback makes this non-fatal (users can switch to Deep Analysis), but if the free mode breaks, a significant chunk of the perceived value evaporates. Consider: a LayoutCalibration.md that documents how to recalibrate (parts of this exist in OCR_DEBUG.md), and ideally a layout self-test that runs on the bundled sample at CI time.

**Most over-invested area relative to value:** the OCR Diagnostic Panel (`matrix.js:979-1066`). It's a 90-line block of canvas overlay rendering, table assembly, and `SAMPLE_EXPECTED` comparison that only activates via `localStorage.setItem('orgpulse-ocr-debug', 'true')`. Useful during active OCR development; now it's dead weight in the main file. Belongs in `src/js/devtools/ocrDiagnostic.js`, lazy-loaded when the flag is set.

**Most under-invested area relative to potential:** automated regression coverage. A 90-second investment — run the bundled sample through analysis and assert the known counter values and cell scores — would catch an entire class of future regressions. The data (`SAMPLE_EXPECTED`, the sample PNG) is already in the repo. This is the single highest-leverage improvement available in the codebase, and it costs almost nothing.

---

## Section 3: Prioritized Action List

### Tier 1: Fix before Albania Dreamin' (April 25)

Nothing here rises to "embarrassing if a visitor sees it." The app works, the demo path is polished, the docs hold up to inspection. Two items worth 15 minutes each, in case the session demo becomes a hands-on:

1. **Verify the live GitHub Pages deployment loads and the sample screenshot works.** The build is reproducible locally; confirm it's what's actually deployed.
2. **Silence or remove the `console.info`/`console.log` noise from `ocr.js`, `matrix.js:632`, and `recommendations.js`** if attendees will have DevTools open during the demo. The current logs are useful but chatty.

### Tier 2: Fix in the month after the conference

1. **Split `matrix.js` into upload / analysis / render modules.** It's the single biggest readability improvement available. 1070 lines in one file is the load-bearing beam of the app; every future change makes it heavier.
2. **Add an integration test using the bundled sample screenshot.** Assert the Basic-mode flow produces the `SAMPLE_EXPECTED` counter values and expected cell scores. Runs in <5 s. Catches a huge class of regressions.
3. **Add `npm test` to `.github/workflows/ci.yml`.** One line. Without it, the existing test is a lie.
4. **Fix the public/local bundle split.** The metadata chunk (~19 kB gzipped) should not ship in the public bundle. Options: separate entry points per build mode, or a Vite `define` the build can statically tree-shake.
5. **Migrate `vision.js` to use `api/claudeClient.js`.** Gets it a timeout, typed errors, and consistent error handling. Remove the duplication.
6. **Deduplicate pattern metadata.** Merge `metadataSection.js:PATTERN_METADATA` and `fixSuggester.js:PATTERN_INFO` into a single `src/metadata/patterns.js`.
7. **Deduplicate the counter key list.** Five copies in four files. Canonicalize in `src/js/metrics.js`.
8. **Apply the RECOMMENDATIONS_AUDIT.md findings.** The audit identifies seven recommendations with signal-mapping problems; close them out rather than letting the audit doc rot.
9. **Update model IDs.** `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6` in `vision.js:80` and `fixSuggester.js:5`.
10. **Move `BACKUP_RESTORE.md` out of repo root.** Belongs in `.github/` or `docs/maintenance/`.
11. **Align the `matrix_recommendation.md` issue template with the JSON schema.** Currently forces contributors to translate.

### Tier 3: Long-term backlog

1. **Extract the OCR diagnostic panel to a lazy-loaded devtool module.** ~90 lines leave the main file.
2. **Proper Apex parsing.** The regex-based loop/DML detection in `apexCpuAnalyzer.js` will miss edge cases (string literals containing "SELECT", conditional DML) and false-positive on others. A small AST-lite tokenizer would harden this without pulling in a 500 kB parser.
3. **Layout self-test at build time.** Run the bundled sample through Tesseract in CI; fail the build if counter extraction drifts.
4. **Extend local mode to run without a screenshot.** Currently the metadata analyzer is gated on having detected signals; it could offer a "scan all signals" mode for architects exploring a new codebase before they have Scale Center data.
5. **Replace inline `onclick` strings with event delegation** in the detail panel and metadata section. Small but persistent readability drag.
6. **Write a `CHANGELOG` discipline.** Populate v0.1.0 with the real commit history before making the repo public.
7. **A live-site "local mode" teaser.** The public site could show a disabled-state metadata section with "Run `npm run dev:local` to enable metadata analysis," so the existence of the deeper mode is discoverable without reading the README.

---

## Section 4: What's Actually Good

- **`recommendations.json` is the product.** 24 curated recommendations across 9 cells with consistent schema, real Salesforce documentation links (developer.salesforce.com paths, not homepage links), quantified thresholds, and root cause classification. The quality is well above what a solo project usually ships.
- **The Vision prompt in `vision.js:82-121` is disciplined.** Explicit metric whitelist, positional identification strategy with title-validation fallback, explicit clearance/finding separation, scope-exclusion rules that refuse to recommend Agentforce or Data Cloud adoption. The client-side `OUT_OF_SCOPE_PATTERNS` filter (lines 213-227) is defense-in-depth in case the model drifts.
- **`validation.js` rejects hallucinated metrics** rather than silently passing them through, and the rejection count surfaces to the user with a "Show filtered" toggle. This is the discipline that makes the tool trustworthy.
- **`RECOMMENDATIONS_AUDIT.md` is unusually honest self-critique.** Most projects don't ship an audit that names seven of their own recommendations as problematic. This one does.
- **The sample screenshot auto-load button** is a small UX addition (commit `8a32f8c`) that does disproportionate work in lowering the first-use bar.
- **OCR fallback UX.** When confidence is low, the user gets a specific "switch to Deep Analysis" button, not a generic error. The graceful degradation path is built into the product.
- **Counter reconciliation logic** (`matrix.js:602-656`) handles four cases (both/OCR-only/Vision-only/neither) and explains its own decisions in the UI with `counter-confidence` markers. The transparency about disagreements is trust-building.
- **Flow XML parsing uses the browser's `DOMParser`** (`flowParser.js`), not custom regex. Correct choice, and the cross-file `flowRegistry` pattern for detecting multiple-flows-on-same-trigger is clever and correct.
- **Dependency hygiene is excellent.** One runtime dependency. Dependabot configured. Build reproducible.

---

## Section 5: Reviewer's Open Questions

- **Why do `vision.js` and `api/claudeClient.js` both exist?** Was `vision.js` going to be migrated and the work got paused, or is the duplication intentional?
- **Is the public/local bundle identity (same 8 chunks either way) expected?** Reading the README, the intent sounds like the metadata chunk should not ship in public — is that the plan, or has the goal shifted to "same bundle, runtime flag"?
- **What's the plan for `RECOMMENDATIONS_AUDIT.md`?** Is it a one-time pass whose findings will be applied and the doc deleted, or is it a living document that will be re-run periodically?
- **What triggers a bump to v0.1.0?** The `package.json` has been at 0.1.0 since inception, CHANGELOG has placeholder entries — is there a specific set of milestones that moves the version?
- **Is the OCR diagnostic panel meant to ship to end users, or is it a dev-only tool gated behind localStorage?** If dev-only, it's occupying 90 lines of the main file; if user-facing, it needs documentation.
- **How is the `scale-center-sample.png` sourced?** A real-org screenshot or a synthetic one? Matters for whether the bundled sample could ever show sensitive data.
- **Does the CTA/MVP positioning drive the recommendation priorities, or the recommendations drive the positioning?** If the former, the recommendations library is the North Star; if the latter, the matrix is. The answer shapes which side gets the next investment.
- **Is the local mode intended to grow into its own distribution (Electron app, self-hosted server), or stay as `npm run dev:local`?** The current state is "hidden feature for readers of README"; the long-term ambition affects how much UX polish it needs.
