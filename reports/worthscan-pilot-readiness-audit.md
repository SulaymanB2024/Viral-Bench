# WorthScan Pilot Readiness Audit

Date: 2026-07-06

Scope: readiness before the first manual TikTok launch for the free-first WorthScan pilot. This audit covers git/artifact reproducibility, launch document consistency, first-post quality, metrics readiness, and platform boundaries. It does not authorize provider adapters, scraping, account automation, live browser workflows, credential storage, or auto-posting.

## Executive Readiness

Status: not launch-ready until the git reproducibility blocker is resolved.

The launch workflow is operationally close: the three launch jobs regenerate locally, the manual launch docs are consistent after fixes, metrics now capture the required fields, and active npm scripts no longer expose the legacy autonomous agent. The remaining blocker is release hygiene: the current WorthScan system source, launch docs, package lock, schemas, tests, and creative manifests are untracked in git, so the launch queue does not yet reference tracked source manifests.

Recommended first TikTok post: `worthscan_scooter_battery_001`.

## Findings

### F-001: Launch sources are not tracked in git

- severity: blocker
- evidence:
  - `git ls-files .ops/creative_jobs/incoming .ops/accounts .ops/launch package-lock.json packages src schemas tests tsconfig.json` returned no WorthScan system files; only tracked project files in the checked subset were `.gitignore`, `README.md`, and `package.json`.
  - `git ls-files --others --exclude-standard ...` listed `.ops/creative_jobs/incoming/worthscan_bike_commuter_001.json`, `.ops/creative_jobs/incoming/worthscan_scooter_battery_001.json`, `.ops/creative_jobs/incoming/worthscan_minifridge_001.json`, `.ops/accounts/*`, `.ops/launch/*`, `package-lock.json`, `packages/creative/*`, `schemas/*`, `src/*`, `tests/*`, and `tsconfig.json`.
  - The launch queue references rendered packages that derive from these untracked incoming manifests.
- affected files:
  - `.ops/creative_jobs/incoming/*.json`
  - `.ops/accounts/*`
  - `.ops/launch/*`
  - `packages/creative/*`
  - `src/*`
  - `schemas/*`
  - `tests/*`
  - `tsconfig.json`
  - `package-lock.json`
- recommended fix:
  - Stage and commit the current WorthScan system files, source manifests, launch docs, schema/test changes, and `package-lock.json` before any public launch.
  - Keep rendered binary review packages ignored, but make sure their source manifests and local renderer code are tracked.
- acceptance test:
  - `git ls-files .ops/creative_jobs/incoming/worthscan_bike_commuter_001.json .ops/creative_jobs/incoming/worthscan_scooter_battery_001.json .ops/creative_jobs/incoming/worthscan_minifridge_001.json .ops/launch/launch_queue.md package-lock.json packages/creative/local_renderer.ts src/post-metrics.ts schemas/post-metrics.schema.json tests/launch-kit.test.ts` returns all listed paths.
  - `git status --short` has no `??` entries for the WorthScan source, schema, docs, tests, or lockfile.
  - A clean checkout can run `npm ci`, `npm run typecheck`, and `npm test`.

### F-002: Package lock handling was not release-ready

- severity: high
- evidence:
  - `package-lock.json` exists and has `lockfileVersion: 3`, but `git ls-files --stage package-lock.json` returned no tracked lockfile entry.
  - `package.json` adds the local TypeScript/test/creative workflow dependencies and `sharp`, so the lockfile should travel with the workflow.
- affected files:
  - `package.json`
  - `package-lock.json`
- recommended fix:
  - Track `package-lock.json` with the same commit as the WorthScan workflow changes.
- acceptance test:
  - `git ls-files package-lock.json` returns `package-lock.json`.
  - `npm ci` installs from the lockfile and `npm test` passes.

### F-003: Metrics snapshots did not capture all launch metrics

- severity: high
- evidence:
  - Before this audit pass, `src/post-metrics.ts` and `schemas/post-metrics.schema.json` captured `views`, `saves`, `shares`, `comments`, `follows`, `dms`, and `notes`, but not `likes` or `profile_visits`.
  - The task requires views, likes, comments, shares, saves, follows, profile visits, DMs, and notes.
- affected files:
  - `src/post-metrics.ts`
  - `schemas/post-metrics.schema.json`
  - `tests/worthscan-pilot.test.ts`
  - `.ops/launch/metrics_tracking_template.md`
  - `README.md`
- recommended fix:
  - Implemented in this audit pass: `likes` and `profile_visits` are now required snapshot fields, accepted by the CLI as `--likes` and `--profile-visits`, exported to CSV, and available as comparison metrics.
- acceptance test:
  - `npm run metrics:add-snapshot -- --post-id <id> --likes 1 --profile-visits 1 ...` accepts the values once a post record exists.
  - `npm test` validates the expanded metric schema and CSV export.

### F-004: Launch cadence was missing an explicit 1-hour checkpoint

- severity: high
- evidence:
  - Before this audit pass, `.ops/launch/launch_queue.md` used `Baseline: within 30 minutes` and `.ops/launch/manual_launch_packet.md` used `Add Baseline Metric Snapshot`.
  - The task requires 1h, 24h, 72h, and 7d checkpoints for every launch item.
- affected files:
  - `.ops/launch/launch_queue.md`
  - `.ops/launch/manual_launch_packet.md`
  - `.ops/launch/metrics_tracking_template.md`
  - `.ops/launch/launch_calendar.md`
  - `.ops/launch/posting_qa_checklist.md`
  - `.ops/accounts/account_setup_checklist.md`
  - `.ops/accounts/launch_checklist.md`
  - `tests/launch-kit.test.ts`
- recommended fix:
  - Implemented in this audit pass: launch queue, manual packet, account checklists, QA checklist, launch calendar, metrics template, and tests now use a 1-hour checkpoint plus 24-hour, 72-hour, and 7-day reads.
- acceptance test:
  - `rg -n "Baseline|baseline|within 30 minutes" .ops/accounts .ops/launch README.md` returns no launch-cadence hits.
  - `npm test` verifies each launch queue item has `1-hour:`, `24-hour:`, `72-hour:`, and `7-day:` markers.

### F-005: Metrics comparisons needed a small-sample caveat

- severity: medium
- evidence:
  - `comparePosts()` previously returned ranked rows without a caution that the first three pilot posts are too small a sample for conclusive format decisions.
- affected files:
  - `src/post-metrics.ts`
  - `.ops/launch/metrics_tracking_template.md`
  - `README.md`
  - `tests/worthscan-pilot.test.ts`
- recommended fix:
  - Implemented in this audit pass: comparison rows now include `compared_posts` and `comparison_note`; pilot docs state early comparisons are directional only until repeated posts complete 7-day reads.
- acceptance test:
  - `npm test` checks the directional comparison note.
  - `npm run metrics:compare -- --metric saves` returns rows with `comparison_note`.

### F-006: Legacy autonomous agent entry points were exposed through npm scripts

- severity: high
- evidence:
  - Before this audit pass, `package.json` exposed `legacy:auth` and `legacy:start`, pointing at `marketing-agent.ts`.
  - `marketing-agent.ts` is a legacy provider-dependent agent path and includes scraping/provider/posting concepts that are outside the manual WorthScan launch boundary.
- affected files:
  - `package.json`
  - `README.md`
  - `marketing-agent.ts`
- recommended fix:
  - Implemented in this audit pass: removed `legacy:auth` and `legacy:start` from `package.json`.
  - Remaining recommendation: remove or quarantine `marketing-agent.ts` from the launch branch if the first TikTok launch branch must contain no legacy autonomous code at all.
- acceptance test:
  - `node -e "const p=require('./package.json'); if (p.scripts['legacy:auth'] || p.scripts['legacy:start']) process.exit(1)"` exits 0.
  - `npm run` does not list legacy autonomous launch commands.

### F-007: Legacy autonomous code remains tracked outside the active launch path

- severity: medium
- evidence:
  - `rg -n "scrapecreators|publish_slideshow|mcp-session-id|queue_post" marketing-agent.ts` identifies legacy scraping/provider/publishing/session-header code.
  - `README.md` states `marketing-agent.ts` is still present for reference and not part of the manual Creative Center intake layer.
  - Active WorthScan scripts now point at `src/trend-cli.ts`, `packages/creative/cli.ts`, and `src/post-metrics.ts`, not `marketing-agent.ts`.
- affected files:
  - `marketing-agent.ts`
  - `README.md`
  - `package.json`
- recommended fix:
  - For a clean launch branch, delete or quarantine `marketing-agent.ts`, or move it to archival docs outside the runnable package.
  - If it must remain, keep it unreachable from package scripts and document that it is excluded from the WorthScan launch path.
- acceptance test:
  - Strong acceptance: `rg -n "scrapecreators|publish_slideshow|queue_post|mcp-session-id" marketing-agent.ts` has no results because the file is removed or quarantined.
  - Minimum acceptance: `package.json` has no scripts that invoke `marketing-agent.ts`, and launch docs do not reference it.

### F-008: Rendered review packages are ignored, but reproducible from local inputs

- severity: low
- evidence:
  - `.ops/creative_jobs/rendered/.gitignore` ignores rendered review-package contents.
  - `git check-ignore -v .ops/creative_jobs/rendered/worthscan_bike_commuter_001/manifest.json` reports the rendered package ignore rule.
  - Regeneration commands succeeded during this audit:
    - `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_bike_commuter_001.json --out /tmp/viral-bench-bike-...`
    - `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_scooter_battery_001.json --out /tmp/viral-bench-scooter-...`
    - `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_minifridge_001.json --out /tmp/viral-bench-fridge-...`
- affected files:
  - `.ops/creative_jobs/rendered/.gitignore`
  - `.ops/creative_jobs/incoming/worthscan_bike_commuter_001.json`
  - `.ops/creative_jobs/incoming/worthscan_scooter_battery_001.json`
  - `.ops/creative_jobs/incoming/worthscan_minifridge_001.json`
  - `packages/creative/local_renderer.ts`
- recommended fix:
  - Keep rendered binary packages ignored.
  - Track the source manifests and local renderer code before launch.
  - Optionally add a small tracked render index if operators need a stable manifest of the latest reviewed local outputs without committing binaries.
- acceptance test:
  - From a clean checkout, run the three render commands into a temporary directory and confirm each produces `manifest.json`, five slides, caption, hashtags, spoken script, posting notes, QA checklist, and approval file.

## Launch Document Consistency

Checked files:

- `.ops/accounts/account_setup_checklist.md`
- `.ops/accounts/socials.md`
- `.ops/accounts/profile_copy.md`
- `.ops/accounts/launch_checklist.md`
- `.ops/launch/launch_queue.md`
- `.ops/launch/manual_launch_packet.md`
- `.ops/launch/dm_response_templates.md`
- `.ops/launch/pinned_comment_templates.md`

Result after fixes:

- WorthScan naming is consistent across account, launch, and profile docs.
- Preferred handle is consistently `@worthscan`, with fallback handles `@tryworthscan`, `@worthscanhq`, `@worthscanlab`, and `@scanworth` where appropriate.
- Platform targets are consistent: TikTok, Instagram/Reels, and YouTube Shorts.
- CTAs consistently use `scan` and ask for listing details while requiring private information removal.
- Posting steps consistently say human/manual posting in the official platform UI.
- Each launch item has TikTok caption, Instagram caption, YouTube Shorts title/description, hashtags, first comment, posting checklist, and metric snapshot schedule.

## First-Post Quality Ranking

### 1. `worthscan_scooter_battery_001`

- first-frame hook: strongest. `Scan this scooter before battery risk eats the deal` creates an immediate hidden-cost reason to keep watching.
- valuation logic: clear. It checks model, mileage, battery clues, charger inclusion, tires/brakes, folding mechanism, and three local scooter comps.
- range-based estimate: yes, uses worth range and confidence language.
- risk flags: strongest. Battery, charger, tires, brakes, and unsupported battery claims are concrete.
- disclaimer language: present in caption and posting notes.
- CTA: specific `Comment "scan" with the next listing`.
- exact appraisal risk: no unsupported exact appraisal claim found.
- recommendation: best first TikTok post because the risk hook is sharper than the bike and mini fridge openings.

### 2. `worthscan_minifridge_001`

- first-frame hook: good seasonal hook. `Scan this mini fridge before move-in week` is timely if launch is near student move-in.
- valuation logic: clear. It checks size, brand, freezer compartment, cleanliness/smell risk, pickup timing, and three local student resale comps.
- range-based estimate: yes.
- risk flags: smell, shelves, pickup hassle, timing, and dorm-tax framing.
- disclaimer language: present.
- CTA: specific `Comment "scan" with the next listing`.
- exact appraisal risk: no unsupported exact appraisal claim found.
- recommendation: strong second post, especially if the account is launching near campus move-in or move-out cycles.

### 3. `worthscan_bike_commuter_001`

- first-frame hook: solid but more generic. `Scan this commuter bike before you pay` is clear, but less specific than the scooter battery-risk hook.
- valuation logic: clear. It checks frame brand, wheel size, drivetrain, tire/brake wear, accessories, and three local bike comps.
- range-based estimate: yes.
- risk flags: tires, brakes, rust, tuneup, accessories, and pickup area.
- disclaimer language: present.
- CTA: specific `Comment "scan" with the next listing`.
- exact appraisal risk: no unsupported exact appraisal claim found.
- recommendation: safe launch option, but it should follow the scooter unless a human reviewer has stronger real bike visuals.

## Metrics Readiness

Result after fixes:

- Required snapshot metrics are now supported: views, likes, comments, shares, saves, follows, profile visits, DMs, and notes.
- The metrics schema requires the new fields in each snapshot.
- CLI accepts `--likes` and `--profile-visits`.
- Launch docs now require 1-hour, 24-hour, 72-hour, and 7-day checkpoints.
- Comparison output includes a small-sample warning and should not be used as conclusive evidence from the first three posts.

## Platform Boundaries

Confirmed for the active WorthScan launch path:

- No provider adapters were added.
- No scraping was added.
- No account creation automation was added.
- No posting automation was added.
- No live browser workflow was added.
- No credentials were added.
- Account setup docs instruct humans to use official platform UIs manually.
- Rendered package manifests for the three first posts have `allow_social_publishing: false` and `account_automation_allowed: false`.
- All generated assets in the three rendered packages remain `approved_for_posting: false`.

Residual boundary risk:

- `marketing-agent.ts` remains in the repository as legacy reference code. It is now not exposed through npm scripts, but it should be removed or quarantined before a clean manual-only launch branch if the branch must contain no legacy autonomous agent code.

## Commands Run

- `pwd`
- `git rev-parse --show-toplevel`
- `git branch --show-current`
- `git remote -v`
- `git status --short`
- `git ls-files ...`
- `git ls-files --others --exclude-standard ...`
- `git check-ignore -v ...`
- `rg ...`
- `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_bike_commuter_001.json --out /tmp/viral-bench-bike-...`
- `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_scooter_battery_001.json --out /tmp/viral-bench-scooter-...`
- `npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_minifridge_001.json --out /tmp/viral-bench-fridge-...`
- `npm run typecheck`
- `npm test`

## Final Validation

- `npm run typecheck`: passed.
- `npm test`: passed, 40 tests.
