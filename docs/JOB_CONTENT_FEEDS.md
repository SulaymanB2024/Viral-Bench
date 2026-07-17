# Job-Search Content Feeds

This feed studies how job-search and internship content is made. It does not
collect job listings as its primary output.

The current source map is:

| Source ID | Content source | Relationship | Purpose |
| --- | --- | --- | --- |
| `runway` | TikTok `@fordcoleman_` | Reviewed Runway founder profile | Learn founder-led career education, urgency, reframes, scripts, and product positioning. |
| `handshake` | TikTok `@joinhandshake` | Official profile linked by Handshake | Learn brand-led student relatability, community prompts, career education, and short opportunity content. |
| `internships_com` | Reviewed internship-search queries | Category proxy | Learn the content language Internships.com must compete within while no owned short-video profile is confirmed. |

The category proxy is never labeled as official Internships.com content.

## Commands

```bash
npm run job-content -- catalog

npm run job-content -- validate \
  --file .ops/job_content_feeds/job_search_content_sources_20260716.json

npm run job-content -- preflight \
  --file .ops/job_content_feeds/job_search_content_sources_20260716.json \
  --env-file .env

npm run job-content -- plan \
  --file .ops/job_content_feeds/job_search_content_sources_20260716.json \
  --env-file .env

npm run job-content -- probe \
  --file .ops/job_content_feeds/job_search_content_sources_20260716.json \
  --env-file .env \
  --out .semantic-artifacts/job-content/job-search-content-sources-20260716.json

npm run job-content -- reanalyze \
  --file .semantic-artifacts/job-content/job-search-content-sources-20260716.json
```

`reanalyze` reclassifies and deduplicates an existing artifact without making
provider calls. This is useful when the signal rules improve after reviewing a
live sample.

## What the feed normalizes

Each public post becomes a source-attributed record with:

- exact author and profile URL;
- recent or popular cohort membership;
- caption, hashtags, posting time, and canonical URL;
- observed views, likes, comments, shares, and saves when exposed;
- topic;
- hook type;
- metadata-inferred format;
- CTA type;
- risky claim flags;
- provider run, dataset, item offset, build, and cost provenance.

Posts returned in both recent and popular cohorts are deduplicated while
retaining both cohort labels.

## Live collection — 2026-07-16

The completed collection produced 68 raw records and 65 unique posts:

| Source | Unique posts | Recent membership | Popular membership |
| --- | ---: | ---: | ---: |
| Runway founder | 13 | 8 | 8 |
| Handshake brand | 16 | 8 | 8 |
| Internships.com category proxy | 36 | 18 | 18 |

Three Runway posts appeared in both profile cohorts and were deduplicated.

The successful six-run collection cost `$0.3512`. An earlier schema test
successfully collected the two category cohorts but rejected four profile runs
because `profileSorting` must be lowercase; that test cost `$0.2288`. Total
incremental usage for this content-feed iteration was `$0.58`.

Including the earlier approved Internships.com creator research and thin source
probe, known Apify usage is `$2.8051`. The operator-approved `$100` value is a
hard ceiling, not a spending target.

The ignored evidence artifact is:

`.semantic-artifacts/job-content/job-search-content-sources-20260716.json`

No competitor videos, covers, slides, avatars, music, subtitles, comments,
follower lists, or following lists were downloaded.

## API behavior learned

- The reviewed Actor is `clockworks/tiktok-scraper`.
- Exact accounts use `profiles`, `resultsPerPage`, and lowercase
  `profileSorting: "latest" | "popular"`.
- Category discovery uses `searchQueries`, `searchSection: "/video"`,
  `videoSearchSorting`, and a bounded date filter.
- Profile results are accepted only when the returned author handle matches the
  reviewed profile.
- Search results retain their creator identity; search keywords do not confer
  brand ownership.
- Recent and popular results overlap, so post-level deduplication is required.
- A popular cohort is a retrospective sample, not proof that a particular hook
  caused performance.

## Main learning

The category is not one content style. It has three distinct modes:

1. **Authority and reframe** — challenge a default belief, then give the exact
   words or steps to use.
2. **Student identity and relatability** — name a major, awkward moment, office
   feeling, or job-search emotion in a compact social format.
3. **Opportunity utility** — lead with the program, year, pay, deadline, roles,
   and application path.

The detailed synthesis is in
[`JOB_SEARCH_CONTENT_LANGUAGE_20260716.md`](./JOB_SEARCH_CONTENT_LANGUAGE_20260716.md).

## Evidence boundary

- Observed metrics are time-stamped metadata, not causal proof.
- Exact wording, scripts, footage, visual identity, and creator likeness are not
  reusable assets.
- Opportunity dates and requirements must be rechecked against a first-party
  source before publication.
- Outcome counts, guaranteed interviews, guaranteed referrals, and guaranteed
  offers are not inherited.
- The feed learns structures and audience language. Internships.com still needs
  owned-post experiments to establish its own winning style.
