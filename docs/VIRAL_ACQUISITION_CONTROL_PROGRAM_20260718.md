# Viral Acquisition Control Program — 2026-07-18

## Checkpoint purpose

This document is the tracked controller contract for the two specialist worktrees that may be activated after this checkpoint. It does not activate a worker, authorize a provider call, create a scheduler, deploy, publish, change an account, or permit a push.

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

## Source-of-truth checkpoint

- Base branch: `codex/autonomous-harness-primitives` at `80ac8fbc2a987d80e81658385d6bfcf94777c1d8`.
- Competitor operations checkpoint: `fe460280418d80725ccee430de2fbb42e2efaee5` (`feat(research): add competitor coverage operations layer`).
- Evidence-quality branch: `codex/evidence-quality-upgrade` at `cdd496baf7438cb5aa82da1f3c10963c05e26d8`.
- Reconciliation merge: `544a9c5fb01627875ac5e8cbca8f5ed83b4820ed` (`merge(research): reconcile evidence quality upgrade`).
- Controller branch: `codex/viral-acquisition-control`. Its activation checkpoint is the commit containing this document.
- Preserved ignored live-wave reconciliation: `.semantic-artifacts/authorized-waves/wave-reconciliation-20260718.json`, SHA-256 `d3aa14221717de8e0eb425025930636115a4cacf9487303717fb6f1ae87a25f7`.

The evidence-quality data, provenance, privacy, retrieval, security, and release boundaries remain authoritative. The competitor profiles, source-review candidates, coverage queues, and operational waves are additive planning and reconciliation layers; they do not weaken evidence gates or independently authorize external activity.

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

## Exact activation conditions

The two specialist worktrees may be created only after all of these are true:

1. `codex/viral-acquisition-control` is clean at the commit containing this document, and both `fe460280` and `cdd496ba` are ancestors.
2. Root focused competitor tests, root typecheck and full tests, site typecheck/tests/build, and the real-data cardinality assertions pass without external calls.
3. The ignored live-wave reconciliation exists at the SHA-256 recorded above.
4. The first-tranche ledger records $20.556622 conservative combined spend and no more than $4.443378 uncommitted capacity.
5. Each worker receives its exact branch, owned files, exclusions, validation command, return contract, and stop condition; no overlapping writer is active.
6. Provider, deployment, publishing, push, scheduler, external-communication, and account-change gates remain closed.

Passing these conditions authorizes only local worktree activation and bounded implementation. It does not authorize another provider call. A later paid tranche requires a separate controller decision that names the manifest, provider, maximum charge, expected reconciliation, and rollback/stop evidence.
