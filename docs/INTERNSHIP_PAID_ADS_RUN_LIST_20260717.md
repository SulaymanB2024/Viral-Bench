# Internship Paid Ads and Reels Run List

Generated: 2026-07-17

## Outcome

The runnable expansion cohort is at
`.ops/competitor_research/internship-paid-ads-reels-expansion-20260717.json`.
It targets 15 advertiser pages and pairs them with public TikTok and Instagram
profiles so paid creative can be compared with each company's strongest or most
recent short-form content.

The list is intentionally paid-ad-first. It uses exact advertiser pages rather
than broad Meta Ad Library keyword searches, downloads no videos, collects no
comments, keeps publishing out of scope, and caps the complete discovery batch
at $3.80.

## Existing paid-ad baseline

The 2026-07-16 Meta artifact already provides a useful starting point:

| Company | Active ads observed | Active video ads | Oldest active start | Observable signal |
| --- | ---: | ---: | --- | --- |
| Handshake | 13 | 5 | 2026-05-20 | Twelve distinct active copy/offer concepts and several video ads still running after roughly eight weeks. |
| Simplify | 8 | 5 | 2026-07-09 | Five active video ads, three copy/offer concepts, and multiple placements across Meta products. |

These are persistence and creative-breadth signals, not ROAS or conversion
proof. The source artifact is
`.semantic-artifacts/competitor-content/discovery/meta-active-competitor-ads-expanded-relevant-20260716.json`.

## Company queue

| Priority | Company | Paid-ad lane | Meta advertiser target | Short-form comparison target | Why run it |
| ---: | --- | --- | --- | --- | --- |
| 1 | Simplify | Observed active leader | `facebook.com/joinsimplify` | TikTok `@joinsimplify`; Instagram `@simplify.jobs` | Existing active video breadth; direct job-search product comparison. |
| 1 | Handshake | Observed active leader | `facebook.com/joinhandshake` | TikTok/Instagram `@joinhandshake` | Longest-lived active cohort in the current artifact; both student and employer offers. |
| 1 | Capital Placement | Managed placement | `facebook.com/capitalinternship` | TikTok/Instagram `@capitalplacement` | Guarantees, deadlines, advisor support, and high-consideration placement offer. |
| 1 | The Intern Group | Managed placement | `facebook.com/TheInternGroup` | TikTok `@theinterngroupint`; Instagram `@theinterngroup` | International destination, alumni proof, and transformation framing. |
| 1 | CIEE | Managed placement / study abroad | `facebook.com/ciee` | TikTok/Instagram `@cieestudyabroad` | Scholarship, destination, institutional trust, and internship messaging. |
| 1 | Jobright | AI job search | `facebook.com/jobrightai` | TikTok/Instagram `@jobright.ai` | Closest new comparison for AI matching, resumes, autofill, and referrals. |
| 2 | Absolute Internship | Managed placement | `facebook.com/absoluteinternship` | Instagram `@absoluteinternship` | City-led programs, structured experience, and student transformation proof. |
| 2 | Virtual Internships | Managed remote placement | `facebook.com/virtualintern` | TikTok `@virtual_internships`; Instagram `@virtualinternships` | Remote-access promise and clear "how it works" creative opportunities. |
| 2 | Parker Dewey | Micro-internships | `facebook.com/parkerdeweyco` | TikTok/Instagram `@microinternships` | Paid project work as a bridge around the experience gap. |
| 2 | Acadium | Proof building | `facebook.com/AcadiumOfficial` | Instagram `@acadiumofficial` | Apprenticeship, mentorship, portfolio, and job-conversion offer. |
| 2 | Riipen | Proof building | `facebook.com/Riipen` | Instagram `@riipennetworks` | Real employer projects and work-integrated-learning proof. |
| 2 | Internshala | Marketplace / education | `facebook.com/internshala` | Instagram `@internshala` | Large non-US student market spanning internships, jobs, courses, and resume support. |
| 2 | Careerflow | AI preparation | `facebook.com/faangpath` | Instagram `@careerflow.ai` | Full job-search workflow; Facebook identity is the legacy FAANGPath page linked by the current official site. |
| 3 | College Recruiter | Early-career marketplace | `facebook.com/EntryLevelJobs` | TikTok `@collegerecruiter.com` | Candidate and employer acquisition messaging in one brand. |
| 3 | Ladder Internships | High-school programs | `facebook.com/ladderinterns` | Instagram `@ladder_internships` | Younger audience, parent trust, founder access, and admissions-value framing. |

The new Facebook targets were linked by the companies' current official sites
on 2026-07-17; Simplify, Handshake, and Parker Dewey also had verified existing
artifact coverage. Careerflow is kept with an explicit identity caveat because
its official site currently links to the legacy `faangpath` Facebook page.

## Executed run results

The batch completed on 2026-07-17 with all five Apify runs successful:

| Run | Returned items | Reported cost |
| --- | ---: | ---: |
| Meta: observed and AI job search | 28 | $0.1624 |
| Meta: managed internship programs | 18 | $0.1044 |
| Meta: proof building and marketplaces | 8 | $0.0058 |
| TikTok: popular reels | 54 | $0.2008 |
| Instagram: recent reels | 112 | $0.3024 |
| **Total** | **220** | **$0.7758** |

The output is
`.semantic-artifacts/competitor-content/discovery/internship-paid-ads-reels-expansion-20260717.json`.
The provider reported 143 external calls, zero failed runs, and finalized usage
for every run.

A companion ad-to-landing-page analysis is available at
`docs/INTERNSHIP_PAID_AD_STRATEGY_AND_WEB_METADATA_20260717.md`, with structured
page and strategy metadata at
`.ops/competitor_research/internship-paid-ad-website-metadata-20260717.json`.
The Apify Website Content Crawler pass captured all eight live Meta
destinations plus four high-performing comparators; all 12 pages returned HTTP
200. The finalized website run cost $0.036435 and is stored at
`.semantic-artifacts/competitor-content/discovery/internship-paid-ad-web-metadata-apify-20260717.json`.

### Active Meta coverage

These counts describe the capped returned cohort, not each advertiser's complete
account-wide history:

| Advertiser | Active ads returned | Active video ads | Oldest active start | Distinct copy/offer concepts |
| --- | ---: | ---: | --- | ---: |
| Simplify | 12 | 9 | 2026-07-09 | 3 |
| Handshake | 12 | 1 | 2026-07-09 | 11 |
| Capital Placement | 12 | 2 | 2026-07-08 | 3 |
| Absolute Internship | 2 | 2 | 2023-04-26 | 1 |
| Internshala | 6 | 0 | 2025-05-23 | 2 |

Parker Dewey, College Recruiter, Jobright, The Intern Group, CIEE, Ladder
Internships, Virtual Internships, Riipen, and Acadium returned complete
zero-active-ad results for their verified pages. Careerflow's legacy
`faangpath` target returned an unattributed `no_items` actor result, so its Meta
status remains unresolved rather than zero.

### Strongest TikTok profile examples

| Company | Public video | Views | Likes | Shares | Saves | Observed format/promise |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| CIEE | [Free study-abroad giveaway](https://www.tiktok.com/@cieestudyabroad/video/7438717559668591914) | 5,400,000 | 22,700 | 1,346 | 6,083 | High-value giveaway and direct entry CTA. |
| Simplify | [LinkedIn headline formula](https://www.tiktok.com/@joinsimplify/video/7236616679957089579) | 1,700,000 | 63,500 | 4,984 | 47,289 | Searchable step-by-step career utility. |
| Capital Placement | [LinkedIn profile-picture advice](https://www.tiktok.com/@capitalplacement/video/7207516769605471494) | 561,200 | 18,200 | 1,604 | 11,773 | Concrete first-impression advice. |
| The Intern Group | [Salary anticipation joke](https://www.tiktok.com/@theinterngroupint/video/7449424743133940997) | 270,500 | 32,200 | 9,046 | 1,128 | Relatable salary humor tied to international experience. |
| Handshake | [Coffee-chat outreach](https://www.tiktok.com/@joinhandshake/video/7138472018504076586) | 244,500 | 2,564 | 13 | 175 | Pause-to-read networking script. |

The TikTok actor returned six popular videos for each of the nine requested
profiles. These raw counts are observed platform metadata, not audited unique
reach or causal performance.

### TwelveLabs incremental analysis

Concept deduplication produced six paid videos: three Simplify concepts, one
Handshake concept, one Capital Placement concept, and one Absolute Internship
concept. The Simplify and Handshake items already had completed TwelveLabs
evidence from the 2026-07-16 report, so only the two new advertiser concepts
were analyzed again.

The new report is
`.semantic-artifacts/competitor-content/reports/internship-paid-meta-video-ads-semantic-20260717.json`:

- 2 of 2 videos completed with zero errors.
- Pegasus 1.5 creative analysis plus Marengo 3.0 video and copy embeddings.
- 12 external provider calls.
- Estimated TwelveLabs cost: $0.150835.
- Combined Apify reported cost plus TwelveLabs estimate: $0.926635.

Capital Placement opens with the direct question, “Do you want a finance
internship that is fully remote and paid?”, then frames an eight-week placement
guarantee, names finance roles, and closes with an apply-now CTA. The video is
offer-dense but does not show eligibility details, application mechanics, or
student outcomes.

Absolute Internship uses a lifestyle-and-testimonial montage: branded cohorts,
work settings, city travel, group activities, and alumni statements. It offers
substantial experiential proof but no explicit in-video CTA, specific
eligibility information, or balanced discussion of tradeoffs.

## What counts as "successful"

Use the strongest evidence available for each platform and keep the labels
separate:

1. **TikTok Top Ads:** platform-labeled high-performing ad creative. Record
   visible CTR percentile, budget tier, likes, comments, shares, hook, offer,
   proof, and CTA when a relevant example is available.
2. **Meta active ads:** use active duration, number of active video ads, repeated
   variants, placement breadth, and distinct offer concepts as testing and
   persistence proxies. Do not infer spend, targeting, conversions, or ROAS.
3. **Organic TikTok/Instagram:** rank public posts within each profile using
   observed views and interactions, then compare within a similar age window.
   Popularity is a creative-selection signal, not proof that an ad will convert.

One useful adjacent paid benchmark is LinkedIn's public TikTok Top Ad, "Save
this tip for your job search": 18K visible likes, 57 shares, a high budget tier,
and CTR in the top 12% at the time the Creative Center page was indexed. Use it
as a job-search creative reference, not as evidence about internship-platform
performance.

## Executed command

The credentials are now present in the ignored project `.env`, and the batch
below has already completed. Do not rerun it merely to reproduce the same
snapshot because another run can incur additional provider cost.

```bash
npm run content-map:discover -- \
  --config .ops/competitor_research/internship-paid-ads-reels-expansion-20260717.json \
  --out .semantic-artifacts/competitor-content/discovery/internship-paid-ads-reels-expansion-20260717.json
```

Configured ceilings:

| Run | Maximum items | Charge ceiling |
| --- | ---: | ---: |
| Meta: observed and AI job search | 72 | $0.80 |
| Meta: managed internship programs | 72 | $0.80 |
| Meta: proof building and marketplaces | 36 | $0.50 |
| TikTok: popular reels | 54 | $0.80 |
| Instagram: recent reels | 112 | $0.90 |
| **Total** | **346** | **$3.80** |

## Selection after the run

1. Reject actor errors, inactive ads, non-video ads for the reel-analysis lane,
   and any page name that does not match the expected advertiser.
2. For each company, retain at most three paid videos: the longest-running,
   the most repeated/variant-heavy concept, and the newest materially different
   concept.
3. Retain at most two organic videos per company: one highest-performing recent
   post and one distinct format or promise.
4. Build a balanced 12-video semantic cohort: four direct job-search products,
   four managed-placement programs, two proof-building platforms, and up to two
   adjacent high-performing paid benchmarks when comparable examples are
   available.
5. Only after URL review, create a separate approved intake request for media or
   TwelveLabs analysis. This discovery batch itself authorizes neither.

## Evidence boundaries and blocker ledger

- Meta says its Ad Library exposes currently active general ads; ordinary ads do
  not expose the political-ad spend and reach fields. Active status therefore
  does not establish business success.
- The previous keyword searches for `Extern`, `Forage`, and `RippleMatch`
  returned unrelated pages such as Nutrena Feed, UEI College, and Story Hour.
  This run removes those noisy keyword targets and uses verified advertiser
  pages only.
- TikTok describes Top Ads as high-performing, advertiser-authorized creatives,
  but the visible catalog is not a complete set of every top-performing ad.
- No private account data, login state, cookies, comments, media downloads,
  publishing actions, or competitor assets were collected in the discovery
  batch. The two selected paid videos were downloaded only for the explicitly
  authorized TwelveLabs analysis and stored under the ignored semantic-artifact
  directory.
- Provider authentication is no longer blocked. A zero Meta result means the
  actor observed no active ads for that exact page at run time; it does not prove
  the company never advertises, uses no other page, or is inactive on another
  paid channel.
- Careerflow's Meta identity remains unresolved because the current official
  site points to a legacy Facebook page and the actor did not attribute its
  `no_items` result to an input URL.

## Public references

- [Meta Ad Library help](https://www.facebook.com/help/259468828226154)
- [TikTok About Top Ads](https://ads.tiktok.com/help/article/top-ads?lang=en)
- [TikTok internship trend page](https://ads.tiktok.com/business/creativecenter/hashtag/internship/pc/en)
- [LinkedIn job-search Top Ad](https://ads.tiktok.com/business/creativecenter/topads/7161114838555426817/pc/en?countryCode=ALL&period=7)
