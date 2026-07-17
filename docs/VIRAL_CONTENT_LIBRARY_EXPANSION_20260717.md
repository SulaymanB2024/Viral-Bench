# Viral content library expansion — 2026-07-17

## Outcome

Viral-Bench now has an additive, time-dated research catalog that can consolidate
stored Apify discovery reports and the semantic SQLite corpus without making a
new external call. It retains repeated public metric snapshots, distinguishes
observed velocity from lifetime-views-per-hour proxies, compares performance
only within platform and post-age cohorts, and emits an analysis queue for
content-pattern review.

The acquisition design uses two complementary Instagram feeds:

1. Popular-Reels keyword search finds established winners outside a fixed
   competitor list.
2. Recent hashtag-Reels collection finds emerging independent creators and
   posts.

Selected recent URLs are then rechecked at roughly 24 hours, 72 hours, and 7
days. Without those repeat observations, the system can rank a snapshot but
cannot measure a growth trajectory.

## Provider decision

Meta's official Instagram API remains useful for a Professional account that
has a Facebook App, linked Page, access token, and the required permissions. It
can find hashtagged media, but it is not a general public keyword-to-viral-Reels
feed. That setup is not present in the current environment, so it is not the
first acquisition route:

- [Meta's official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

The initial route instead uses Apify-maintained Actors with explicit per-run
ceilings. As documented on 2026-07-17, Instagram Search Scraper supports
keyword-to-popular-Reels search and Instagram Hashtag Scraper supports recent
Reels with timestamps and public engagement metrics:

- [Apify Instagram Search Scraper](https://apify.com/apify/instagram-search-scraper)
- [Apify Instagram Hashtag Scraper](https://apify.com/apify/instagram-hashtag-scraper)

The published free-plan rates were `$2.70 / 1,000` search results and
`$2.60 / 1,000` hashtag results at inspection time. Pricing is external state
and must be rechecked before a live run; the local dollar ceilings still apply
if the provider changes its rate.

## Current evidence

At inspection time, `.semantic-artifacts/competitor-content/semantic_corpus.sqlite`
contained:

- 72 public short-form posts: 49 TikToks and 23 Instagram posts;
- 90 public metric observations;
- only 16 posts with more than one observation;
- only 4 posts first observed within 72 hours of publication;
- 906 semantic rows derived from 68 posts.

Existing stored discovery artifacts are substantially larger than the indexed
database. Two completed batches alone retained 605 provider rows for $2.2888 in
reported Apify usage. The library builder makes those stored sources
queryable as a deduplicated metadata catalog before further paid collection.

## Commands

Build the local catalog:

```bash
npm exec tsx -- src/viral-content-library.ts build \
  --discovery-dir .semantic-artifacts/competitor-content/discovery \
  --db .semantic-artifacts/competitor-content/semantic_corpus.sqlite \
  --out .semantic-artifacts/viral-library/content-library.json
```

Create a bounded recheck config from the highest-priority recent Instagram
candidates:

```bash
npm exec tsx -- src/viral-content-library.ts recheck-plan \
  --library .semantic-artifacts/viral-library/content-library.json \
  --out .ops/competitor_research/viral-content-library-recheck.json \
  --limit 50 \
  --max-charge-usd 2
```

The initial discovery canary is
`.ops/competitor_research/viral-content-library-instagram-canary-20260717.json`.
It has a hard `$5` ceiling. It remains blocked unless `APIFY_TOKEN`,
`ALLOW_PUBLIC_SEO_RESEARCH=true`, and `ALLOW_PAID_GENERATION=true` are supplied
through the existing reviewed provider path.

## $100 allocation

The `$100` is a ceiling, not a spending target:

| Lane | Maximum | Purpose |
| --- | ---: | --- |
| Instagram keyword/hashtag canaries and expansion | $15 | Establish relevant-yield and duplication rates |
| Cross-platform TikTok/YouTube extension | $20 | Test whether patterns replicate outside Instagram |
| 24h/72h/7d temporal rechecks | $25 | Measure trajectories instead of one-time totals |
| Multimodal analysis of selected outliers | $25 | Analyze hook, pacing, proof, audio, and CTA |
| Failure, quality, and pricing reserve | $15 | Hold budget for retries or a better-performing feed |
| **Hard ceiling** | **$100** | Stop before exceeding this total |

The first decision gate is the `$5` Instagram canary. Expand only if at least
20% of returned rows are relevant public short-form videos after URL
deduplication and at least 10 eligible recent items have a publication timestamp
and public view count. Stop after two consecutive provider failures or if the
relevant yield stays below 20%.

## Evidence contract

- Store public post metadata, source URLs, publication times, capture times,
  visible metrics, captions, and hashtags. Do not retain private-account data.
- Do not copy competitor footage, scripts, shot order, creator identity, or
  personal contact data into owned creative.
- A high percentile is an analysis-queue signal, not proof that a hook or format
  caused distribution.
- Raw cross-platform comparisons are invalid. Compare within platform and age
  bucket.
- Label `views / post age` as a lifetime proxy. Label velocity as observed only
  when two or more distinct capture timestamps exist.
- Missing, throttled, or failed providers are measurement gaps, not evidence
  that content or demand is absent.

## Definition of done for this slice

- Stored discovery reports and SQLite observations build into one deduplicated
  library.
- Every metric observation carries an explicit capture timestamp.
- Repeat observations produce observed view velocity; single snapshots do not.
- Viral candidates are ranked only within platform and age cohorts.
- A recheck config can be generated without external calls and cannot exceed
  `$10` per generated job.
- The first live discovery config cannot exceed `$5`; the overall program cannot
  exceed the user-authorized `$100`.
