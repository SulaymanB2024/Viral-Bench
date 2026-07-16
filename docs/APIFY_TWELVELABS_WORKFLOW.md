# Apify + TwelveLabs short-video workflow

This workflow separates four different claims and permissions:

1. **Public discovery (Apify):** collect a bounded, time-stamped sample of public
   YouTube Shorts metadata and metrics. A high-view result is labeled only as
   "top observed in this bounded collection," never as causal proof.
2. **Strategy synthesis (local):** derive reusable structures across multiple
   evidence items, then add WorthScan's proof-first voice and originality rules.
3. **Media understanding (TwelveLabs):** analyze only owned, licensed, or
   purpose-created raw media. Social page URLs and competitor footage are not
   TwelveLabs inputs.
4. **Publishing (manual approval boundary):** verify the destination account,
   asset hashes, copy, and exact public effect before the final post action.

The APIs are disabled by default. Credentials belong only in process
environment or an ignored `.env`; reports expose presence booleans and provider
identifiers, never credential values.

## Apify contract

The production path uses an allowlisted Actor, asynchronous runs, a required
`maxTotalChargeUsd`, Actor-native item limits, terminal polling, unfiltered
dataset pagination, and a final run read after usage reconciliation. The Actor
build, input hash, run, dataset, item offset, raw-item hash, cost cap, and final
usage state are retained as provenance.

Current reviewed YouTube Actor:

```text
streamers/youtube-scraper
```

The SEO request deliberately runs separate recent and popular cohorts. This
prevents historical view count, recency, and query relevance from collapsing
into one misleading winner score.

Operator path:

```bash
npm run seo -- seo:validate \
  --file .ops/seo_requests/worthscan_scooter_youtube_20260715.json

npm run seo -- seo:preflight \
  --file .ops/seo_requests/worthscan_scooter_youtube_20260715.json \
  --env-file .env

npm run seo -- seo:discover \
  --file .ops/seo_requests/worthscan_scooter_youtube_20260715.json \
  --out .semantic-artifacts/seo \
  --env-file .env

npm run seo -- seo:strategy \
  --request .ops/seo_requests/worthscan_scooter_youtube_20260715.json \
  --discovery .semantic-artifacts/seo/worthscan-scooter-youtube-20260715-discovery.json \
  --out .semantic-artifacts/seo/worthscan-scooter-youtube-20260715-strategy.json
```

The live discovery command requires:

```text
ALLOW_PUBLIC_SEO_RESEARCH=true
ALLOW_PAID_GENERATION=true
APIFY_TOKEN=<server-side token>
APIFY_ACTOR_YOUTUBE=streamers/youtube-scraper
```

Actor build numbers should be pinned through `APIFY_ACTOR_BUILD_YOUTUBE` after a
reviewed canary. Store prices and builds can change, so neither is treated as a
permanent code constant.

Official references: [Apify API v2](https://docs.apify.com/api/v2), [run an
Actor](https://docs.apify.com/api/v2/act-runs-post), [dataset
items](https://docs.apify.com/api/v2/dataset-items-get), and [YouTube Scraper
input](https://apify.com/streamers/youtube-scraper/input-schema).

## TwelveLabs contract

The current integration uses API `v1.3`, `x-api-key` authentication,
`marengo3.0` embeddings, and `pegasus1.5` analysis. Local videos are uploaded
once with `POST /assets`, polled with `GET /assets/{asset_id}`, then the ready
asset ID is reused by both `/analyze` and `/embed-v2`. This avoids encoding and
sending the same local video twice.

Provider generation IDs and asset IDs are preserved. `pegasus1.5` is stored as
the model name; the provider revision stays null/unknown unless TwelveLabs
actually returns one. A `finish_reason` of `length` is incomplete and fails
closed.

The local SQLite embedding store remains the default retrieval backend. Hosted
TwelveLabs indexes are optional and are not created by this workflow, avoiding
unnecessary indexing and monthly infrastructure charges.

Before analysis, Viral-Bench estimates the ceiling from video duration,
Pegasus output-token allowance, Marengo video embeddings, and text embedding
requests. The estimate is a policy guard, not an invoice. Actual provider
usage remains a separate measurement when the API does not return a dollar
amount.

`/gist` and `/summarize` are not used; those endpoints were removed in 2026.

Official references: [create an
asset](https://docs.twelvelabs.io/api-reference/upload-content/direct-uploads/create),
[analyze](https://docs.twelvelabs.io/api-reference/analyze-videos/analyze),
[structured responses](https://docs.twelvelabs.io/docs/guides/analyze-videos/structured-responses),
[embeddings v2](https://docs.twelvelabs.io/api-reference/create-embeddings-v2/create-embeddings),
and [model concepts](https://docs.twelvelabs.io/docs/concepts/models).

## Originality and publication boundary

The strategy report must retain evidence IDs and includes these non-negotiable
rules:

- do not copy a source title, script, shot order, thumbnail, footage, or creator
  identity;
- adapt structural principles across multiple sources;
- use only owned/licensed/purpose-created media;
- keep observed metrics separate from recommendations and predicted outcomes;
- validate recommendations with metrics from our own posts.

Discovery and analysis never post. Publishing remains subject to the repository
launch checklist, a verified account owned through an authorized non-personal
identity, human asset/copy approval, and exact-post confirmation immediately
before the public action.

For a channel-specific release, scope the handoff report so another platform's
setup does not become evidence against the selected launch:

```bash
npm run harness -- publishing-handoff-plan \
  --platform "YouTube Shorts" \
  --env-file .env
```

Omitting `--platform` preserves the full TikTok, Instagram, and YouTube
readiness audit. The scoped report still fails closed on the selected channel's
work-account confirmation, profile, 2FA, analytics, asset approval, and
account-owner confirmation gates.

## WorthScan proof-first house style

`worthscan_proof_first_v1` converts the research into a recognizable format
without copying any source creative. Each job that enables it must declare a
visual mode and short proof cues for every slide. The five recurring devices
are:

1. a hidden-cost question rather than a generic attention claim;
2. visible evidence chips that tell the viewer what to request or inspect;
3. a three-comparison board with no fabricated prices;
4. explicit uncertainty labels instead of invented condition or severity; and
5. an unselected buy/bargain/pass decision frame that requires real evidence.

The renderer writes these devices from manifest data, so other categories can
reuse the visual grammar with category-specific proof cues. An illustrative
asset remains labeled as illustrative. It cannot silently become listing
evidence, an inspection record, or support for an exact valuation.

TwelveLabs analysis is then used as a draft QA surface: confirm the opening hook,
beat sequence, visible proof, speech, CTA, and limitations. It does not approve
the post, predict causal performance, or replace human review. Revisions should
address observed draft limitations while preserving the source evidence and
originality boundary.
