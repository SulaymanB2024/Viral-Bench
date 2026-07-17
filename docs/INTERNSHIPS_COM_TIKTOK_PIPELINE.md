# Internships.com TikTok Pipeline

## Current operating boundary

Internships.com is a separate brand lane. Its account registry, research request,
creative manifest, rendered package, launch queue, and metrics must not reuse or
overwrite WorthScan account state.

The current public positioning is grounded in
[Internships.com](https://www.internships.com/): personalized internship
openings, truthful role-specific application drafts, alumni-path research, and
student review before send. Public content must not imply auto-submission or a
guaranteed internship, referral, interview, response, or offer.

## House style: `internships_signal_stack_v1`

Every episode should deliver useful guidance before the product CTA:

1. **Match** — identify the role language supported by the student's real
   experience.
2. **Prove** — translate coursework, projects, or work into specific, accurate
   evidence.
3. **People** — research a relevant alumni path without assuming access or a
   referral.
4. **Review** — keep the student visibly responsible for the final application
   and submission.

The visual system uses deep ink, orange, cream, and purple observed in the
current public-site CSS. This is an operating palette, not a claim about formal
brand guidelines.

## Bounded TikTok research

The reviewed Apify route is `clockworks/tiktok-scraper`. Its current input
supports `searchQueries`, `/video` search, `LATEST` or `MOST_LIKED` sorting, and
date filters. The pipeline explicitly disables video, cover, slideshow, avatar,
music, subtitle, related-video, and comment collection. See the
[current Actor input contract](https://apify.com/clockworks/tiktok-scraper/input-schema).

Prepared request:

```bash
npm run seo -- seo:validate \
  --file .ops/seo_requests/internships_com_tiktok_20260715.json

npm run seo -- seo:preflight \
  --file .ops/seo_requests/internships_com_tiktok_20260715.json \
  --env-file .env
```

Live discovery remains fail-closed until `ALLOW_PUBLIC_SEO_RESEARCH=true`,
`ALLOW_PAID_GENERATION=true`, `APIFY_TOKEN`, and the reviewed TikTok Actor are
present. On 2026-07-16, the approved pipeline collected 120 search records and
360 profile-follow-up records for `$2.092` in total Apify usage. The profile
records deduplicated to 326 unique posts. The operator-approved `$100` limit
remains a hard ceiling, not a spending target or expected charge.

Media downloads stayed disabled. The resulting creator map is documented in
[`INTERNSHIPS_COM_CREATOR_RESEARCH_20260716.md`](./INTERNSHIPS_COM_CREATOR_RESEARCH_20260716.md).
Missing or filtered research remains a measurement gap; it does not become
evidence that a content pattern failed.

## First package

```bash
npm run creative -- validate \
  --job .ops/creative_jobs/incoming/internships_com_signal_stack_001.json

npm run creative -- render \
  --job .ops/creative_jobs/incoming/internships_com_signal_stack_001.json

npm run shorts -- \
  --package-dir .ops/creative_jobs/rendered/internships_com_signal_stack_001 \
  --duration 24
```

The renderer creates review artifacts only. Upload and public submission require
the verified Internships.com TikTok handle, approved non-personal brand access,
human asset/copy approval, and exact confirmation of the final video hash and
destination account.

## TwelveLabs draft analysis

The first TwelveLabs canary analyzes the purpose-created local draft, not
competitor footage. The request also declares the bounded Apify job-content feed
as a provenance input so the prompt can test whether the original
`match, prove, people, review` format expresses the observed category grammar
without treating metadata correlations as causal findings.

```bash
npm run trend -- provider:validate-request \
  --file .ops/provider_requests/internships_com_twelvelabs_analysis_20260716.json

ALLOW_PAID_GENERATION=true \
TWELVELABS_ESTIMATED_ANALYSIS_COST_USD=0.05 \
npm run trend -- provider:run-live \
  --env-file .env \
  --file .ops/provider_requests/internships_com_twelvelabs_analysis_20260716.json \
  --package-dir .ops/creative_jobs/rendered/internships_com_signal_stack_001
```

The live command requires `TWELVELABS_API_KEY` in the process environment or
ignored `.env`. It uploads the local video once, polls the asset until ready,
and writes validated Pegasus analysis only to
`provider_outputs/twelvelabs/job_content_analysis.json`. The request has a
`$0.08` hard ceiling and uses a `$0.05` pre-call estimate for the approximately
24-second draft. The output remains unapproved QA evidence and performs no
account or publishing action. The first live result and revision decisions are
recorded in
[`TWELVELABS_INTERNSHIPS_CANARY_20260716.md`](./TWELVELABS_INTERNSHIPS_CANARY_20260716.md).

## First research-derived generated-video package

```bash
npm run creative -- validate \
  --job .ops/creative_jobs/incoming/internships_com_proof_gap_002.json
```

The corresponding browser-generation prompt is
`.ops/prompts/gemini/internships_com_proof_gap_002.md`. It requests one
purpose-created 9:16 draft with no competitor branding, creator likeness,
recognizable application UI, or baked-in captions. Any generated video remains
unapproved until its local file, prompt, technical QA, and human-review record
are attached to the rendered package.
