# Viral Bench: free-first trend research layer

This fork now supports a Codex-operated trend research and content harness for
short-form "scan this / what is it worth?" resale content.

The first vertical slice is AI-assisted resale valuation content, starting with
used bikes, scooters, and student resale items.

## What this layer does

- Stores manually collected TikTok Creative Center examples in SQLite.
- Provides FTS search over hook, caption, niche, visual structure, and remake notes.
- Produces grounded trend research answers with citations to saved examples.
- Generates scan/value content briefs only when enough saved examples exist.
- Gives Codex a durable harness command that selects work, renders artifacts,
  evaluates provider gates, and writes next-action JSON.
- Exports local renderer stubs:
  - `slide_01.png` through `slide_05.png`
  - `caption.txt`
  - `posting_notes.md`

The default mode does not scrape TikTok or Instagram, auto-post, call Lightreel,
or require OpenRouter, Gemini, ScrapeCreators, Apify, or any paid API. Provider,
browser, and publishing capabilities are exposed as explicit capability gates so
Codex can see what is possible without leaking secrets or crossing account
boundaries accidentally.

## Setup

Requires Node 22+ and the system `sqlite3` CLI with FTS5 support. macOS ships
with a compatible `sqlite3`.

```bash
npm install
npm test
```

## Codex autonomous harness

The primary Codex-facing entrypoint is:

```bash
npm run harness -- auto \
  --goal "Make WorthScan autonomous for Codex"

npm run harness -- doctor

npm run harness -- repo-status

npm run harness -- capability-plan

npm run harness -- capability-unlock-map

npm run harness -- capability-env --env-file .env

npm run harness -- autonomy-plan \
  --goal "Make WorthScan autonomous for Codex"

npm run harness -- provider-preflight

npm run harness -- prepare-provider-inputs \
  --request .ops/provider_requests/sample_openai_image_request.json

npm run harness -- provider-handoff \
  --request .ops/provider_requests/sample_openai_image_request.json

npm run harness -- reproducibility-manifest

npm run harness -- verification-map

npm run harness -- stage-source --dry-run

npm run harness -- source-package

npm run harness -- verify-source-package \
  --package .ops/harness/source_packages/<package_id>

npm run harness -- autonomy-audit \
  --goal "Make WorthScan autonomous for Codex"

npm run harness -- inspect

npm run harness -- information-index

npm run harness -- rank-jobs

npm run harness -- job-matrix

npm run harness -- evidence-map

npm run harness -- launch-map

npm run harness -- context-pack --out .ops/harness/context_pack.json

npm run harness -- blockers

npm run harness -- resume --run .ops/harness/runs/<run_id>

npm run harness -- run-history

npm run harness -- inventory --run .ops/harness/runs/<run_id>

npm run harness -- latest-run

npm run harness -- run \
  --goal "Make WorthScan autonomous for Codex"
```

`auto` is the safest one-command Codex loop. It diagnoses the repo, selects the
best local job, renders a local review package, evaluates provider gates, writes
all durable run artifacts plus `auto_result.json`, and returns the exact gate
where it stopped.

`doctor` returns a machine-readable readiness report with repo status,
information-surface counts, latest run state, secret-scan status, blocker ledger,
capability gates, and recommended next commands.

`repo-status` returns branch, remote, dirty state, and untracked source-of-truth
files as JSON so Codex does not need to parse ad hoc shell output.

`verification-map` maps the current git diff to targeted validation commands,
baseline checks, the source staging dry-run, and the reason each command matters.
Use it after edits so Codex can validate changed surfaces without guessing.

`capability-plan` turns capability gates into executable information: local,
provider, browser, and publishing lane status; missing env gates; credential
availability flags; provider request dry-run status; and request-level next
actions. It never prints secret values and reports live-call eligibility only
when request policy, local inputs, env gates, and credential presence all line
up.

`capability-unlock-map` turns closed autonomy gates into an activation checklist:
required env flags, credential presence, policy preconditions, related provider
requests or launch jobs, safe probe commands, activation commands, verification
commands, and current blockers. It is the Codex surface to inspect before using
an API key or opening browser/publishing gates.

`capability-env` reads process env plus an optional ignored env file such as
`.env`, then reports only key names, presence, source, warnings, and capability
flags. It never prints secret values. Pass the same `--env-file .env` option to
`capability-plan`, `provider-preflight`, `provider-handoff`, `autonomy-plan`,
`run`, or `auto` when Codex should use locally stored gate/credential values.

`autonomy-plan` composes the audit, capability plan, blocker ledger, provider
preflight, and job ranking into an ordered Codex execution queue. Each step
declares whether it is safe to run now, the command to run, evidence, required
gates, expected writes, and the selected next step. It is the quickest
machine-readable surface for a Codex agent deciding what to do next.

`job-matrix` gives Codex a per-job readiness table covering harness rank,
runnability, approval state, rendered package files, linked provider requests,
provider handoff/live readiness, launch queue presence, metrics records,
blockers, and next commands.

`evidence-map` gives Codex a per-job evidence surface covering source inputs,
trend references, rendered research/QA files, manual-boundary declarations,
range/disclaimer/comparison/risk language, unsafe claim blockers, and next
commands before provider handoff or posting.

`launch-map` gives Codex a launch handoff surface covering required launch docs,
queued jobs, rendered posting files, platform copy coverage, manual approval
gates, social-publishing blockers, existing metrics records, and next commands.
It separates manual handoff readiness from autonomous publishing readiness.

`provider-preflight` checks every provider request prompt, declared input asset,
declared output target, dry-run result, and local preparation command. It is the
Codex handoff surface for provider work: missing local inputs are reported
before any browser, paid API, or external adapter boundary is considered.

`prepare-provider-inputs` renders the canonical local package for a request's
job, usually under `.ops/creative_jobs/rendered/<job_id>/`, so declared provider
input assets such as `source/bike_001.jpg` and `manifest.json` exist before a
dry run, handoff packet, or approved live adapter.

`provider-handoff` writes an ignored packet under
`.ops/harness/provider_handoffs/<packet_id>/` with the request manifest, job
manifest, prompt copy, input-asset hashes/excerpts, declared output targets,
dry-run result, capability flags, live-call eligibility, and blockers. It is the
bounded context bundle Codex should use before invoking a reviewed provider
adapter.

`run-history` summarizes recent durable harness run folders without recreating
work: run id, goal, selected job, status, artifact count, missing artifacts,
provider dry-run counts, external calls made, next actions, and resume commands.
Use it before rerunning local autonomous passes so Codex can continue from
existing evidence when a prior run is still usable.

`reproducibility-manifest` returns the source-of-truth boundary, generated
artifact boundary, exact `git add` command for modified or untracked source
files, and the verification commands that prove the checkout can be replayed.

`stage-source` previews the same manifest-classified `git add` operation by
default. It only mutates the git index when `--apply` is supplied, and it keeps
generated/runtime paths such as harness runs, rendered creative packages,
databases, and build outputs excluded.

`source-package` copies only source-of-truth files into an ignored package
folder with per-file hashes, an aggregate hash, and a verifier command. This is
the portable handoff path before or alongside committing the source files.

`verify-source-package` checks the package manifest, every copied file hash, and
the aggregate package hash.

`autonomy-audit` checks the full Codex autonomy objective against current
evidence: information primitives, local execution, source reproducibility,
provider capability, browser capability, publishing capability, and information
surface size.

`inspect` returns:

- repo status and latest usable harness run
- reproducibility manifest and autonomy audit
- capability plan
- capability unlock map for env, credential, policy, activation, and verification gates
- available incoming creative jobs
- provider request manifests
- provider preflight with prompt/input/output readiness
- run history across recent durable harness runs
- credential availability flags, never secret values
- ranked job choices with scoring reasons and blockers
- a machine-readable primitive menu of commands Codex can call next

`information-index` returns the complete source map across code, schemas, tests,
incoming jobs, provider requests, ops docs, skills, and reports.

`rank-jobs` scores incoming creative jobs by local runnability, trend/example
evidence, hook specificity, risk/comparison clarity, range-boundary language,
and output completeness.

`context-pack` writes bounded source/schema/job/provider/doc/test excerpts with
file hashes so Codex can quickly inspect the repository’s information surface
without dumping every file.

`blockers` returns a current ledger for git reproducibility, provider gates,
browser gates, publishing gates, and credential availability.

`resume` reads an existing run folder, verifies expected artifacts, and returns
next executable commands without recreating the run.

`inventory` hashes and classifies a run folder’s artifacts so Codex can reason
about what already exists.

`run` creates a durable folder under `.ops/harness/runs/<run_id>/` unless `--out`
is supplied. A run writes:

```text
run.json
capabilities.json
primitives.json
information_index.json
context_pack.json
job_rankings.json
reproducibility_manifest.json
autonomy_audit.json
provider_preflight.json
artifact_inventory.json
blocker_ledger.json
next_actions.json
codex_next_prompt.md
context/selected_job.json
context/secret_scan.json
providers/*.json
rendered/<job_id>/
```

The harness currently proceeds autonomously through local job selection,
manifest validation, secret scanning, local render-package creation, provider
gate evaluation, and next-action generation. It detects `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `LIGHTREEL_API_KEY`, `SCRAPE_CREATORS_API_KEY`, and local
Doublespeed tokens by presence only. Live provider adapters should be routed
through provider request manifests and capability gates rather than direct
one-off calls.

Capability envelopes:

- local autonomy: default; renders and analyzes local artifacts.
- browser-assisted autonomy: requires `ALLOW_BROWSER_UI=true` and job/request
  policy approval.
- provider-assisted autonomy: requires `ALLOW_PAID_GENERATION=true`,
  request/job policy approval, and an available provider key.
- publishing autonomy: requires `ALLOW_SOCIAL_PUBLISHING=true`, job policy
  approval, approved generated assets, and account-owner confirmation.

## Manual intake

Create a JSON file that follows
[`schemas/trend-example.schema.json`](schemas/trend-example.schema.json):

```json
{
  "id": "creative-center-bike-001",
  "source_url": "https://ads.tiktok.com/business/creativecenter/...",
  "source_name": "TikTok Creative Center",
  "captured_at": "2026-07-06T15:00:00.000Z",
  "niche": "AI-assisted resale valuation: used bikes and student resale",
  "platform": "TikTok",
  "format": "slideshow",
  "hook": "Scan this campus bike before you pay $220",
  "caption": "Quick resale check for student bikes. Comment scan for the checklist.",
  "observed_metrics": {
    "likes": 14200,
    "comments": 340,
    "saves": 980
  },
  "visual_structure": [
    "Close crop of the item with price tag visible",
    "Three visible condition checks",
    "Final worth range and buy/pass decision"
  ],
  "CTA": "Comment scan for a valuation checklist",
  "why_it_works": [
    "Opens with a concrete item and price",
    "Makes the viewer compare their own deal"
  ],
  "remake_notes": "Remake for scooters, textbooks, mini fridges, and dorm furniture with local resale prices."
}
```

Then add it:

```bash
npm run trend -- init --db trend_examples.sqlite
npm run trend -- add --file creative-center-bike-001.json --db trend_examples.sqlite
```

## Search and research

```bash
npm run trend -- search --niche "used bikes" --format slideshow --query "scan" --db trend_examples.sqlite

npm run trend -- research --niche "used bikes" --format slideshow --db trend_examples.sqlite
```

Trend claims require stored citations. By default, the research and brief
generators require at least three matching saved examples; otherwise they return
`insufficient_examples` instead of inventing a trend.

## Generate a scan/value content brief

After at least three examples exist for the niche:

```bash
npm run trend -- brief \
  --niche "used bikes" \
  --item "used commuter bike" \
  --format slideshow \
  --out trend_outputs/used-commuter-bike \
  --db trend_examples.sqlite
```

The brief includes:

- TikTok hook
- 5-slide script
- spoken script
- caption
- valuation explanation structure
- call to action
- cited trend basis

## Creative operations scaffold

The operator track lives under `.ops/` and `packages/creative/`.

- `.ops/accounts/` contains manual social account setup materials.
- `.ops/creative_jobs/incoming/` contains creative job manifests.
- `.ops/creative_jobs/approved/`, `rendered/`, `posted/`, and `rejected/`
  are the manual review queues.
- `.codex/skills/` contains local Codex skills for creative browser research,
  Gemini planning, short-form rendering, and social account setup.

Validate the sample job:

```bash
npm run creative -- validate --job .ops/creative_jobs/incoming/scan_bike_001.json
```

Render a local review package:

```bash
npm run creative:sample
```

The renderer writes a deterministic package under
`.ops/creative_jobs/rendered/<job_id>/`:

```text
manifest.json
source/bike_001.jpg
source/listing.txt
research/trend_examples.json
research/notes.md
prompts/gemini_image_prompt.md
prompts/openai_image_prompt.md
prompts/caption_prompt.md
output/slide_01.png
output/slide_02.png
output/slide_03.png
output/slide_04.png
output/slide_05.png
output/caption.txt
output/hashtags.txt
output/spoken_script.txt
output/posting_notes.md
qa/checklist.md
qa/approval.md
```

Rendered assets are ignored by Git and must be reviewed by a human before any
posted ledger move.

Hard gates:

- Paid/external generation is blocked unless `ALLOW_PAID_GENERATION=true` and
  the job policy allows the provider.
- Browser UI workflows are blocked unless `ALLOW_BROWSER_UI=true` and the job
  policy allows browser/manual research.
- Social publishing is blocked unless `ALLOW_SOCIAL_PUBLISHING=true`, the job
  policy allows publishing, and generated assets have human approval.
- Account automation and committed credentials are not allowed.

## Browser workflow overview

Browser support is a deterministic manual-capture scaffold, not a scraper. The
operating docs live in `.ops/browser/`:

- `mcp_setup.md` describes the browser gate and MCP boundary.
- `allowed_browser_tasks.md` lists manual research and QA actions.
- `blocked_browser_tasks.md` blocks scraping, account automation, posting, and
  platform bypass behavior.
- `creative_center_research_protocol.md` defines the TikTok Creative Center
  capture process.
- `browser_capture_template.md` gives the JSON shape for new captures.

Validate a manually captured example:

```bash
npm run trend -- browser:validate-capture \
  --file .ops/browser/samples/creative_center_bike_capture.json
```

Ingest only after a human reviewer sets `human_review_status` to `approved`:

```bash
npm run trend -- browser:ingest-capture \
  --file .ops/browser/samples/creative_center_bike_capture.json \
  --db trend_examples.sqlite
```

The capture schema is `schemas/browser-capture.schema.json`. Required fields
include source URL, niche, observed format, visible metrics, hook, visible text,
visual notes, evidence notes, remake notes, and human review status.

## TikTok Creative Center capture process

Use Creative Center as a manual or semi-manual research surface only:

1. Open Creative Center manually.
2. Search the target niche and format.
3. Record only visible UI facts into a browser capture JSON file.
4. Keep `human_review_status` as `pending_review` until reviewed.
5. Ingest approved captures into the trend example database.

Do not scrape TikTok or Instagram, call hidden endpoints, automate account
creation, automate login, bypass platform gates, or automate posting.

## Provider request workflow

Provider request manifests live under `.ops/provider_requests/` and follow
`schemas/provider-request.schema.json`.

Validate and dry-run a sample request:

```bash
npm run harness -- provider-preflight \
  --request .ops/provider_requests/sample_openai_image_request.json

npm run harness -- prepare-provider-inputs \
  --request .ops/provider_requests/sample_openai_image_request.json

npm run harness -- provider-handoff \
  --request .ops/provider_requests/sample_openai_image_request.json

npm run trend -- provider:validate-request \
  --file .ops/provider_requests/sample_openai_image_request.json

npm run trend -- provider:run-dry \
  --file .ops/provider_requests/sample_openai_image_request.json

ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live \
  --env-file .env \
  --file .ops/provider_requests/sample_openai_image_live_request.json \
  --package-dir .ops/creative_jobs/rendered/scan_bike_001
```

Create a new request without calling a provider:

```bash
npm run trend -- provider:create-request \
  --provider openai_image \
  --job-id scan_bike_001 \
  --prompt-path .ops/prompts/openai/image_generation.md \
  --out .ops/provider_requests/new_openai_image_request.json
```

Dry-run output is a local JSON result with `blocked` or `skipped` status,
`external_calls_made: 0`, declared output paths, and a clear log. The provider
workflow can write approved provider-returned artifacts into an existing
rendered package folder, but it refuses to overwrite existing package files
unless the caller passes an explicit overwrite flag.

`provider:run-live` is separate from dry-run evaluation. It currently supports
OpenAI image generation only, and it remains blocked unless all of these are
true:

- The request uses `provider: "openai_image"`.
- The request uses `provider_mode: "generation"`.
- The request sets `cost_policy.allow_paid_generation: true`.
- The request sets `cost_policy.external_calls_allowed: true`.
- The request sets a positive `cost_policy.max_cost_usd`.
- The environment has `ALLOW_PAID_GENERATION=true`.
- The environment has `OPENAI_API_KEY`.

The live adapter writes only declared local output files under the rendered
package directory. Its run report redacts credential values and never serializes
image `b64_json` payloads.

## Gemini and Nano Banana image requests

Gemini/Nano Banana image planning uses:

- `.ops/prompts/gemini/image_generation.md`
- `.ops/provider_requests/sample_gemini_image_request.json`

The sample request declares approved local inputs and expected output files, but
`provider:run-dry` does not call Gemini. A future live implementation must keep
outputs inside the rendered package subdirectory declared by the request.

Gemini video understanding uses `.ops/prompts/gemini/video_understanding.md` and
must operate only on operator-approved local media. It must not fetch TikTok,
Instagram, YouTube, or Creative Center media directly.

## OpenAI ImageGen requests

OpenAI ImageGen planning uses:

- `.ops/prompts/openai/image_generation.md`
- `.ops/provider_requests/sample_openai_image_request.json`

The request process is the same as Gemini: validate the manifest, run a dry run,
prepare provider inputs, and use `.ops/provider_requests/sample_openai_image_live_request.json`
only when an explicit live call is intended. Default tests and CLI commands do
not call OpenAI.

## Why provider calls are dry-run or blocked by default

The repo is designed to work with no Gemini, OpenAI, Lightreel,
ScrapeCreators, Apify, TikTok, Instagram, or YouTube credentials. Provider
requests separate intent from execution so Codex can prepare structured work
without spending money, collecting credentials, scraping platforms, or posting
to social accounts.

Paid provider requests require both:

- `cost_policy.allow_paid_generation` set to `true` in the request.
- `ALLOW_PAID_GENERATION=true` in the environment.

Live provider requests additionally require `provider_mode: "generation"`,
`cost_policy.external_calls_allowed: true`, a positive
`cost_policy.max_cost_usd`, a supported reviewed adapter, and the provider API
key. OpenAI image generation reads `OPENAI_API_KEY` from the environment, or
from an explicitly supplied ignored env file via `--env-file .env`.

Browser UI requests require both:

- `cost_policy.allow_browser_ui` set to `true` in the request.
- `ALLOW_BROWSER_UI=true` in the environment.

Social publishing remains outside provider requests and still requires
`ALLOW_SOCIAL_PUBLISHING=true`, job policy approval, human approval, and manual
posting confirmation.

Future provider implementations may read provider credentials from the local
environment, but credentials must never be committed and tests must continue to
pass without them.

## WorthScan pilot loop

WorthScan is the first local content-operations loop built on the manual
Creative Center scaffold:

1. Save manual browser captures under `.ops/browser/captures/raw/`.
2. Move human-approved examples to `.ops/browser/captures/reviewed/` or reject
   them under `.ops/browser/captures/rejected/`.
3. Store manually reviewed WorthScan trend seeds in `.ops/trend_seeds/worthscan/`.
4. Create or review draft jobs in `.ops/creative_jobs/incoming/`.
5. Render local post packages under `.ops/creative_jobs/rendered/<job_id>/`.
6. Human-review slides, captions, hashtags, spoken script, comps, and posting
   notes.
7. Post manually only after approval.
8. Record posted URLs and manual metric snapshots under `.ops/metrics/`.

The pilot includes ten draft incoming jobs for used bikes, scooters, student
resale items, electronics, furniture, and musical instruments. They approve only
the local renderer and keep paid generation, browser UI, social publishing, and
account automation disabled.

## Manual posting process

Launch materials live in `.ops/launch/`:

- `first_10_posts.md` lists the first pilot jobs and required evidence.
- `launch_calendar.md` gives a manual posting/snapshot cadence.
- `launch_queue.md` gives platform copy and metrics cadence for the first three
  rendered packages.
- `manual_launch_packet.md` walks a human operator from account setup to first
  metric entry.
- `posting_qa_checklist.md` is the pre-post human review gate.
- `dm_response_templates.md` provides manual-only reply drafts.
- `pinned_comment_templates.md` provides manual-only first comment drafts.

Rendered packages are not approved for posting by default. A human must replace
placeholder visuals with approved local item photos or listing screenshots,
verify comps, approve the final caption/script/hashtags/posting notes, and post
from the social app manually. This repo does not automate login, account
actions, DMs, comments, or publishing.

## Metrics tracking process

Post metrics are local manual records validated by
`schemas/post-metrics.schema.json` and implemented in `src/post-metrics.ts`.
The default store is `.ops/metrics/post_metrics.json`.

```bash
npm run metrics:create-post -- \
  --post-id worthscan-post-001 \
  --job-id worthscan_bike_commuter_001 \
  --platform TikTok \
  --account-handle @worthscan \
  --posted-url https://example.com/manual-post-url \
  --content-type slideshow \
  --hook "Scan this commuter bike before you pay" \
  --format slideshow \
  --cta "Comment scan with the next listing"

npm run metrics:add-snapshot -- \
  --post-id worthscan-post-001 \
  --views 1200 \
  --likes 140 \
  --comments 24 \
  --shares 18 \
  --saves 90 \
  --follows 7 \
  --profile-visits 35 \
  --dms 2

npm run metrics:compare -- --metric saves
npm run metrics:export -- --format csv --out .ops/metrics/post_metrics_export.csv
```

Supported comparison metrics are `views`, `likes`, `comments`, `shares`,
`saves`, `follows`, `profile_visits`, and `dms`. Early pilot comparisons are
directional only until repeated posts complete their 7-day reads.

## Valuation-card process

Valuation cards are validated by `schemas/valuation-card.schema.json` and
`src/valuation-card.ts`. A card records:

- item type and asking price
- estimated low/high range
- confidence level
- value drivers and risk flags
- comparable listings
- verdict and disclaimer

The validator rejects unsupported exact-value claims. Keep public content
range-based unless the card has strong comparable support and high confidence,
and always include a disclaimer that the range is an estimate, not a guarantee
or official appraisal.

## Run the first local pilot

```bash
npm run creative -- validate --job .ops/creative_jobs/incoming/worthscan_bike_commuter_001.json

npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_bike_commuter_001.json

npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_scooter_battery_001.json

npm run creative -- render --job .ops/creative_jobs/incoming/worthscan_minifridge_001.json

npm run typecheck
npm test
```

The local renderer writes review packages with slides, caption, hashtags,
spoken script, posting notes, QA checklist, and approval record. No external
calls are required.

## Legacy autonomous agent

`marketing-agent.ts` is still present for reference, but it is not part of the
free-first trend research flow. It still contains the older provider-dependent
agent path and should not be used for this Creative Center manual intake layer.
