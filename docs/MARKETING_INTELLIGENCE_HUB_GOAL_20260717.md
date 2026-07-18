# Viral-Bench marketing intelligence hub goal

## Objective

Make Viral-Bench the marketing team's canonical operating surface for internship-related content intelligence while preserving the evidence boundary between public competitor research and owned marketing performance.

## Current source of truth

- Public source registry: `.ops/competitor_research/internship-us-public-source-registry-20260716.json`
- Current source verification: `.ops/competitor_research/internship-source-verification-20260717.json`
- Established competitor registry: `.ops/competitor_research/internship-core-competitors-v1.json`
- Expanded competitor universe: `.semantic-artifacts/competitor-content/discovery/internship-competitor-universe-20260716.json`
- Viral content library: `internship-reels-site/library.json`
- Semantic evidence database: `.semantic-artifacts/competitor-content/semantic_corpus.sqlite`
- Video analysis reports: `internship-reels-site/data/video-ai-reports.json`
- Owned performance dataset: `.semantic-artifacts/marketing-dashboard/owned-marketing-dashboard.json`
- Scheduled refresh status: `internship-reels-site/data/pipeline-refresh.json`

## Baseline on 2026-07-17

- All 30 official, market, audience, and owned-data source entries now have a resolved current state: 22 are observed or sample-observed, 5 are rate-limited measurement gaps, and 3 require owned-data connections.
- 38 active named competitors after merging 8 established competitors with 31 expansion entries and excluding one explicitly pivoted company.
- 32 active competitors have known social accounts; 16 currently reconcile to collected content, including all 8 established competitors.
- 841 unique public posts and 1,059 observations across Instagram, TikTok, and YouTube Shorts from 566 normalized accounts.
- 161 posts have repeated captures; 161 currently expose an observed velocity field.
- 73 historical semantic analysis rows reconcile to 68 distinct current posts; 5 generated multimodal reports and 8 latest scheduled TwelveLabs analyses add current report lineage. Together they cover 15 of 86 viral queue items and 9 of 18 priority competitors that currently have collected content.
- The checked-in v2 library exposes 22 carousels, 21 images, 263 feed videos, and 535 short videos.
- Owned marketing performance is explicitly `not_connected`; no competitor metric is allowed to fill that gap.
- The last published refresh is `partial` because 8 of 10 Codex-selected videos completed deep analysis after a bounded recovery attempt.

## Primary KPIs

1. **Verified source coverage**: observed or sample-observed source entries divided by all registered sources.
2. **Priority competitor content coverage**: priority-1/2 competitors with at least one reconciled public post divided by all priority-1/2 competitors.
3. **Temporal measurement coverage**: public posts with at least two distinct captures divided by all public posts.
4. **Deep-analysis queue coverage**: viral analysis-queue items with a matched multimodal report divided by all queued items.
5. **Owned performance connectivity**: explicit `not_connected`, `partial`, or `connected` state; never inferred from competitor data.

## Driver metrics

- Platform and content-type coverage.
- Account concentration and distinct-account count.
- Recent-post coverage and publication-time completeness.
- Observed velocity coverage and observation-window quality.
- Competitors with known social accounts but no collected content.
- Priority competitors with collected content but no reconciled deep analysis.
- Registered sources awaiting review, verification, access, or connection.
- Public corpus and analysis artifact freshness.

## Guardrails

- Never rank raw performance across platforms without platform and age normalization.
- Never label lifetime views divided by post age as observed velocity.
- Never use public competitor research to populate owned reach, conversion, retention, or campaign KPIs.
- Never turn observational creative patterns into causal claims.
- Preserve null and missing states instead of converting them to zero.
- Keep private data, credentials, local secret paths, and personal contact details out of public artifacts.

## Definition of done

- One generated hub dataset reconciles the source registry, established and expanded competitor universes, viral library, semantic database, video reports, refresh state, and owned dashboard.
- Every headline metric includes a definition, denominator, source path, freshness timestamp, and material caveat.
- The dashboard shows source coverage, competitor coverage, platform mix, viral candidates, priority gaps, data-quality issues, and owned connection state.
- The build emits a bounded, draft-only analysis intake plan with one highest-signal candidate per observed priority competitor lacking deep analysis; external execution remains approval-gated.
- The build fails closed when a required source is missing or malformed.
- Targeted model tests, artifact validation, and a real-data build pass.
- The hub is integrated into the existing site only after concurrent navigation and evidence-quality owners finish, so their work is not overwritten.

## Concurrent ownership

- `codex/evidence-quality-upgrade` owns evidence corpus v2, source freshness, retrieval, privacy, authentication, and release hardening in `/Users/sulaymanbowles/Projects/CodexWork/Viral-Bench-evidence-quality-upgrade`.
- `codex/autonomous-harness-primitives` currently owns the scheduled broad-discovery / semantic-selection changes in the root checkout.
- This goal owns the additive marketing-intelligence hub model, KPI contract, dashboard artifact, and later integration review.

## Stop conditions

- Stop rather than overwrite files actively owned by another Viral-Bench task.
- Stop a live external collection path before it exceeds its declared budget.
- After two consecutive validation cycles with no new evidence or state change, record the blocker and required next action.
