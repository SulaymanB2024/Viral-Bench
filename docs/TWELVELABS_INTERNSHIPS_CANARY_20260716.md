# TwelveLabs Internships.com canary — 2026-07-16

## Scope

The first live TwelveLabs run analyzed one purpose-created, locally rendered
Internships.com draft:

```text
.ops/creative_jobs/rendered/internships_com_signal_stack_001/output/internships_com_signal_stack_001.mp4
```

The request declared the 65-item Apify job-content feed as research provenance,
but it did not download or submit competitor media. The run performed no social
login, upload, or publishing action.

Request and prompt:

- `.ops/provider_requests/internships_com_twelvelabs_analysis_20260716.json`
- `.ops/prompts/twelvelabs/internships_com_job_content_analysis.md`

Local result:

```text
.ops/creative_jobs/rendered/internships_com_signal_stack_001/provider_outputs/twelvelabs/job_content_analysis.json
```

The rendered package is intentionally ignored by Git; the creative job manifest
retains a tracked `video_qa_artifacts` pointer to the local result.

## Live execution

- API: TwelveLabs `v1.3`
- Model: `pegasus1.5`
- Input: one 24-second, 586,254-byte MP4
- External calls: 5
- Returned usage: 8,979 input tokens and 825 output tokens
- Pre-call ceiling: `$0.05`
- Pricing-derived usage estimate: `$0.017868`
- Actual provider charge: not returned by the API response and therefore not
  claimed
- Approval state: unapproved; human review remains required

The usage estimate applies the published Developer rates of `$0.0292` per
analyzed video minute and `$0.0075` per 1,000 output tokens. A free or negotiated
account plan can produce a different actual charge.

## What Pegasus observed

- The opening `Before you apply, check these 4 signals` was detected from
  `0–2s`, matching the feed's common direct-statement opening.
- The model recognized the draft as a concise list explainer with a steady
  five-slide pace of approximately 12 cuts per minute.
- It identified the original `match, prove, people, review` structure and the
  visible no-guarantee language.
- It found no explicit in-video CTA.
- The Internships.com product mention arrived at the end, after the standalone
  guidance. That is intentional useful-before-promotional sequencing, even
  though the model listed the late mention as a limitation.

## Human interpretation and next revision

Keep:

- the direct two-second hook;
- the four-part original framework;
- the useful-before-promotional order;
- the visible and spoken control/no-guarantee language.

Revise before posting:

- add one short, non-promissory final action such as `Save this four-signal
  check` or `Build your next application at Internships.com`;
- inspect slide-level readability manually because the model grouped several
  distinct on-screen text events into the broad `2–24s` range;
- retain human review of exact claims, account destination, caption, and final
  file hash.

The result is evidence about this draft, not proof that the format will perform.
Owned-account watch-time, completion, saves, profile visits, and conversion
metrics must determine future iterations.

## Official API references

- [Create an asset](https://docs.twelvelabs.io/api-reference/upload-content/direct-uploads/create)
- [Analyze videos](https://docs.twelvelabs.io/docs/guides/analyze-videos)
- [Pegasus model](https://docs.twelvelabs.io/docs/concepts/models/pegasus)
- [Pricing calculator](https://www.twelvelabs.io/pricing-calculator)
