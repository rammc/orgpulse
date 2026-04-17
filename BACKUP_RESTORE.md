# Emergency Restore Procedure

This document describes how to restore the `orgpulse` repository to its pre-integration state if the `orgpulse-dev` integration goes wrong.

## Snapshot Reference

- **Tag:** `pre-orgpulse-dev-integration`
- **Branch:** `backup/pre-integration-2026-04-17`
- **Bundle:** `~/Backups/orgpulse/orgpulse-pre-integration-2026-04-17.bundle`
- **Commit SHA:** `380c35a28197e77808b6f8556402d8a0b8647195`
- **Date:** 2026-04-17
- **Context:** Pre-integration of orgpulse-dev metadata analyzers. Screenshot analysis flow fully functional. Public GitHub Pages deploy working at https://rammc.github.io/orgpulse/.

## Restore Option 1: Reset main to the tag (nuclear option)

Destroys any progress made after the snapshot. Use only if the integration work is completely abandoned.

```bash
git checkout main
git reset --hard pre-orgpulse-dev-integration
git push --force-with-lease origin main
```

**WARNING:** `--force-with-lease` rewrites remote history. Ensure no collaborators have pulled new work.

## Restore Option 2: Revert to the tag via new branch (safe option)

Preserves integration work for later inspection while restoring the working state for deploys.

```bash
git checkout -b restore-from-snapshot pre-orgpulse-dev-integration
git push origin restore-from-snapshot
```

Then set `restore-from-snapshot` as the default branch in GitHub Settings, or open a PR to merge it into main.

## Restore Option 3: Clone from the bundle

Only needed if the GitHub remote is also compromised (branches/tags deleted).

```bash
cd /tmp
mkdir orgpulse-restore && cd orgpulse-restore
git clone ~/Backups/orgpulse/orgpulse-pre-integration-2026-04-17.bundle restored
cd restored
git remote set-url origin https://github.com/rammc/orgpulse.git
git push origin backup/pre-integration-2026-04-17
```

## Verification After Restore

After any restore, verify:

1. `git log --oneline -5` -- top commit SHA matches `380c35a`
2. `npm install && npm run build` -- builds successfully
3. `npm run dev` -- dev server starts, upload flow works with a test screenshot
4. GitHub Pages deploy succeeds (check the Actions tab)

## When NOT to Restore

Do NOT restore if:

- The integration branch has valuable new work that has not been backed up
- The failure is a minor bug that can be fixed forward
- You have not first tried `git revert` on the specific problematic commits

Restoration is the last resort, not the first.

## Related: orgpulse-dev archival

After the integration is confirmed stable (1-2 weeks without issues), archive the orgpulse-dev repo:

1. In GitHub Settings for rammc/orgpulse-dev, click "Archive this repository"
2. Add to the orgpulse-dev README: "This prototype has been merged into rammc/orgpulse as of 2026-04-17. See the main repo for continued development."
3. Keep the repo accessible (archived, not deleted) — it is the historical record of the prototype phase.
