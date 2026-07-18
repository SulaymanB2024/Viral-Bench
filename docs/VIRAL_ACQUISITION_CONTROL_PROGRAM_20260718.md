# Viral Acquisition Control Program — 2026-07-18

## Checkpoint purpose

This document is the tracked controller contract and integrated checkpoint for the two completed specialist worktrees. It does not authorize another provider call, create a scheduler, deploy, publish, change an account, or permit a push.

The acquisition program remains evidence-first. Every collected source, provider outcome, cost, and analysis must reconcile to a reviewed identity before it can influence marketing guidance.

## Scope mix

Each acquisition and analysis batch must preserve this unique-record mix:

- At least 70% internship, externship, apprenticeship, study-abroad internship, campus recruiting, or early-career content.
- At most 30% adjacent job-search, resume, interview, networking, career-tool, or workplace content.

The mix is measured on unique selected sources or posts before a paid run and again on reconciled results. A controller-recorded exception is required before a batch may fall below the 70% internship and early-career share.

## Budget tranches

The lifetime program ceiling is $100, released as four separately gated $25 tranches. An unused balance does not authorize a call by itself.

1. Tranche 1: $0-$25. The evidence-quality refresh conservatively booked $18.681168. The authorized live waves added $1.875454 ($1.0934 Apify and $0.782054 TwelveLabs), for $20.556622 conservatively counted against the first tranche and $4.443378 remaining.
2. Tranche 2: cumulative spend above $25 through $50. It remains locked until Tranche 1 passes the activation gates below and the controller records explicit approval.
3. Tranche 3: cumulative spend above $50 through $75. It remains locked until Tranche 2 reconciles and passes the same gates.
4. Tranche 4: cumulative spend above $75 through $100. It remains locked until Tranche 3 reconciles and passes the same gates. No program spend may exceed $100.

Unknown or incomplete provider billing consumes the declared conservative ceiling. Failed or interrupted calls do not silently return their reservation. The tracked provider ledger and the authorized-wave reconciliation must both be consulted before any later call.

The first $25 validation-stage allocation was $9 for the current Apify/TwelveLabs cycle, $5 for temporal metric rechecks, $5 for expansion of the best source route, $4 for TwelveLabs batch/parity analysis, and $2 for failure reserve. Every later $25 tranche is capped at 50% ($12.50) for the best acquisition route, 20% ($5) for temporal rechecks, 20% ($5) for selected multimodal analysis, and 10% ($2.50) for exploration/reserve.

## Source-of-truth checkpoint

- Base branch: `codex/autonomous-harness-primitives` at `80ac8fbc2a987d80e81658385d6bfcf94777c1d8`.
- Competitor operations checkpoint: `fe460280418d80725ccee430de2fbb42e2efaee5` (`feat(research): add competitor coverage operations layer`).
- Evidence-quality branch: `codex/evidence-quality-upgrade` at `cdd496baf7438cb5aa82da1f3c10963c05e26d8`.
- Reconciliation merge: `544a9c5fb01627875ac5e8cbca8f5ed83b4820ed` (`merge(research): reconcile evidence quality upgrade`).
- Activation checkpoint: `38d2836c6ab98fef84ff6f4ee7f32485fbb2413f` (`docs(research): define viral acquisition control checkpoint`).
- Preserved Ask diagnostics: `045d75df52cd8c52553d607d6da5a8ba29ae9540` (`fix(research): diagnose Ask synthesis failures`).
- Discovery specialist source commit: `e663633f38b4dbc69320f4d3d9f38c8be66286c7`; integrated as `4b0abcd81e59aa3494b44752568df7dabc612600`.
- Provider specialist source commit: `e39e8d09ec1a1e6a211027e2a781baadd67bed7b`; integrated as `1880bf76f87ceb661771b6f2f606874562c52d19`.
- Controller branch: `codex/viral-acquisition-control`. Its activation checkpoint is the commit containing this document.
- Preserved ignored live-wave reconciliation: `.semantic-artifacts/authorized-waves/wave-reconciliation-20260718.json`, SHA-256 `d3aa14221717de8e0eb425025930636115a4cacf9487303717fb6f1ae87a25f7`.
- Reproducible controller report: `.ops/competitor_research/viral-acquisition-economics-v1-20260718.json`, built by `tsx src/acquisition-economics.ts build` and checked without external calls by `tsx src/acquisition-economics.ts check`.

The evidence-quality data, provenance, privacy, retrieval, security, and release boundaries remain authoritative. The competitor profiles, source-review candidates, coverage queues, and operational waves are additive planning and reconciliation layers; they do not weaken evidence gates or independently authorize external activity.

## Integrated economics and evidence state

`AcquisitionEconomicsV1` is an additive contract. It does not alter normalized social posts, ViralContentLibrary schema 2, or the prior provider ledger.

- Baseline: $1.5555 provider-reported actual and $18.681168 conservative.
- Finalized wave: $1.0934 Apify actual plus $0.782054 TwelveLabs actual-or-conservative.
- Cumulative: $2.6489 provider-reported actual; $3.430954 when the TwelveLabs estimate is added; $20.556622 conservative; $4.443378 remains in Tranche 1.
- Collection yield: 273 raw rows, 220 unique/relevant public items, 80.5861% deduplicated relevance, 19.4139% duplicate rate, 70 recent timestamp-plus-view candidates, 100% timestamp/view completeness, 10 competitor routes gained, and 201.207243 unique/relevant rows per reported Apify dollar.
- Analysis yield: 13 of 15 videos passed deep-analysis quality (86.6667%).
- Temporal recheck yield: 20 of 20 requested items produced a usable public metric snapshot at $0.054 reported actual. This is a recapture yield, not a claim that every metric changed.
- Corpus boundary: the production baseline remains 1,052 social posts and 1,183 total source records; public/operator documents are 1,073/1,082 and public/operator vectors are 1,073/1,082. The finalized ignored wave promoted zero items into the production corpus during this integration.
- Discovery state: 40 deterministic draft seeds preserve the 28/12 (70/30) scope, 22 profile identities await registry review, and three access gaps remain explicit.

Raw cross-platform performance ranking is forbidden. Performance comparisons must remain within platform, content type, and age bucket, with raw metrics retained only as dated observations.

## Deterministic tranche and route gates

A later tranche unlocks only when every condition passes:

- At least 20% of returned rows remain relevant after deduplication.
- At least 10 recent candidates contain both publication time and public-view evidence.
- At least 80% of selected videos pass analysis quality.
- All spend is settled or conservatively reserved.
- The latest wave's cost per new relevant item is no worse than twice the best accepted prior wave.
- The reconciled output demonstrates at least 70% internship/early-career scope.

A route stops after two consecutive provider failures, two consecutive sub-threshold yield waves, unknown cumulative spend, private-data exposure, or an unresolved provenance/reconciliation failure.

The first five numeric/accounting gates pass for the finalized wave: 80.5861% relevant, 70 recent timestamp-plus-view candidates, 86.6667% analysis pass, all unknown cost conservatively reserved, and $0.004970 per new relevant item against a $0.030992 maximum. Tranche 2 remains locked because the finalized wave artifact does not carry a post-acquisition 70/30 classification, so that scope mix cannot be inferred after the fact.

## Worker ownership boundaries

### Worker A — source acquisition and coverage

Planned branch: `codex/viral-source-acquisition`, created from the controller activation checkpoint.

Owned surface:

- Reviewed competitor/source registries and bounded acquisition manifests under `.ops/competitor_research/`.
- Competitor collection, source mapping, and coverage planning modules, including `src/competitor-coverage-plan.ts`.
- Directly corresponding acquisition and coverage tests and acquisition-specific documentation.

Excluded surface:

- Evidence corpus, vectors, retrieval, privacy, security, operator access, release allowlists, deployment configuration, and account state.
- `src/intelligence-run-once.ts`, tracked evidence ledgers/corpora, and ignored live-wave artifacts except read-only reconciliation.
- Any provider call until the controller separately opens a tranche and approves an exact manifest and ceiling.

### Worker B — intelligence synthesis and analysis quality

Planned branch: `codex/viral-analysis-operations`, created from the controller activation checkpoint.

Owned surface:

- Competitor analysis normalization and profiles, including `src/competitor-intelligence-profiles.ts`.
- Marketing-facing analytical summaries, quality scoring, queue reconciliation, and directly corresponding tests/documentation.
- Read-only use of reviewed collection results and evidence corpora.

Excluded surface:

- Source identity or acquisition-manifest ownership assigned to Worker A.
- Evidence-core modules `internship-reels-site/lib/corpus.ts`, `evidence.ts`, `retrieval.ts`, `service.ts`, `types.ts`, and `vectors.ts`; tracked corpus/vector artifacts; privacy/release scripts; deployment configuration; and account state without controller review.
- Any provider call or analysis retry until the controller separately opens a tranche and approves exact inputs and ceilings.

Workers must not edit each other's owned files. A required cross-boundary change returns to the controller for reassignment or reconciliation before either worker proceeds.

## Stop gates

Stop the affected lane and return exact evidence when any of the following occurs:

- The controller checkpoint is not clean or either worker does not start from the same activation commit.
- Concurrent tracked changes appear on the controller or a worker's source branch.
- A merge conflict cannot preserve both the evidence-quality and competitor-operation contracts additively.
- Root or site tests/typechecks fail because of the lane's changes.
- The real-data baseline no longer reconciles to 1,052 social posts and 1,183 total source records.
- Source-post, corpus-document, vector, visibility, privacy, or spend cardinality fails its tracked manifest gate.
- A proposed call would exceed the open $25 tranche, lacks a reviewed manifest, has unreconciled prior failures, or cannot reserve a conservative ceiling.
- The 70/30 scope mix is not demonstrated before and after acquisition.
- Credentials, private audience identities, local paths, operator-only evidence, unsupported causal claims, or unreviewed sources would enter public artifacts.
- Deployment, publishing, push, external communication, account changes, or scheduler activation becomes necessary without separate explicit authorization.

## Exact next activation conditions

The specialist work is integrated. Another paid call or Tranche 2 activation remains closed until all of these are true:

1. `codex/viral-acquisition-control` is clean at the integrated controller commit, and `045d75df`, `4b0abcd8`, and `1880bf76` are ancestors.
2. Root focused acquisition tests, root typecheck/full tests, site typecheck/tests/build, privacy dry build, schema parsing, and real-data cardinality assertions pass without external calls.
3. The ignored live-wave reconciliation exists at the SHA-256 recorded above.
4. The first-tranche ledger records $20.556622 conservative combined spend and no more than $4.443378 uncommitted capacity.
5. A reviewed acquisition manifest records the post-acquisition 70/30 classification and all five remaining tranche gates stay green.
6. Any live canary has exact reviewed Actor/build pins, ready reusable assets, a reviewed manifest, fail-closed settlement, and a controller-recorded cumulative reservation within both the active $25 tranche and the separately authorized call ceiling.
7. A three-video Pegasus batch-versus-individual parity artifact exists before batch mode is used for a wider wave.
8. Provider, deployment, publishing, push, scheduler, external-communication, and account-change gates remain closed unless separately and explicitly authorized.

The current live-validation decision is `blocked_zero_calls`. Credentials and reviewed Actor/build pins are present, but paid/public-ingestion gates are disabled, no new-call manifest or shared reservation exists, and no reusable three-asset parity manifest or parity result exists. No provider call was made to manufacture this evidence.
