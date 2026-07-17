# US internship content and data expansion

Generated: 2026-07-17T19:24:39.581Z

## Outcome

The live, public-data-only US batch completed discovery, deterministic selection, identity-redacted audience collection, market-source registration, multimodal analysis, and content planning under the $25 hard cap. It produced 637 provider rows, 527 normalized candidates, 487 unique candidates, all 36 required selections, and 36 of 36 fresh TwelveLabs analyses.

## Spend and reconciliation

| Stage | Count |
| --- | ---: |
| Provider rows | 637 |
| Normalized candidates | 527 |
| Unique candidates | 487 |
| Canonical duplicates removed | 40 |
| Selected posts | 36 |
| Existing unique posts / multimodally mapped | 72 / 68 |
| Existing semantic rows | 906 |
| Existing ad executions / unique concepts | 21 / 15 |

- Reported plus usage-priced provider cost: $4.172801.
- Conservative spend including unsettled discovery and analysis ceilings: $4.774335.
- Remaining uncommitted batch ceiling: $20.2257.
- Selection quotas: competitor_product=12, student_problem_creator=12, contrast_outlier=6, opportunity_access_safety=6; platform floor result: tiktok=20, instagram=8, youtube_shorts=8; shortfalls: none.

Unique posts, repeated semantic rows, ad executions, and unique ad concepts remain separate counts. Raw cross-platform view rankings are prohibited; selection uses within-platform and age-bucket percentiles.

## Audience voice

- 24 identity-free public-community thread signals.
- 73 identity-free public-comment signals from 15 of 18 targeted posts.
- Recurring themes: general_early_career_uncertainty=61, access_compensation_and_cost=12, resume_and_proof=12, international_work_authorization=4, internship_performance=2, application_silence_and_volume=1, career_direction=1, interview_preparation=1, networking_and_outreach=1, rejection_and_wellbeing=1, starting_without_formal_experience=1.
- Usernames, profile URLs, raw comment text, comment IDs, names, emails, résumé text, and applicant histories are not persisted.

## Analytical synthesis

The reasoning contract is observation → alternative explanation → owned test. Audience counts are paired with unique source pages, and competitor-performance patterns remain exploratory until they replicate on owned content.

| Finding | Confidence | Reasoning | Decision implication |
| --- | --- | --- | --- |
| Broad early-career uncertainty is a routing signal, not a sufficiently specific creative brief. | medium | 61 of 97 signals were assigned to the broad uncertainty theme across 18 source pages. The breadth is real enough to prioritize diagnosis, but the label is too broad to identify one intervention. | Open with one recognizable moment, then route the viewer to one bounded next action instead of publishing generic job-search reassurance. |
| Proof-building is a credible product wedge, but “resume content” is not automatically a reach mechanism. | medium | Proof appears in 12 audience signals across 12 source pages and in 18 of 72 mapped videos. Yet the resume/application label is 28.6 percentage points underrepresented in the exploratory high-performance split. | Keep Close the Proof Gap as the core demonstration, but package it as a visible requirement-to-evidence transformation rather than another resume tip. |
| Affordability and access deserve an explicit exploration lane, but the current count cannot support a prevalence claim. | low | 12 signals mention cost or access, but they come from only 4 source pages and the largest page supplies 58.3% of them. | Test Can I Afford This Internship? as a bounded editorial lane and judge it on qualified saves, comments, and downstream actions—not on the current raw signal count. |
| Question is a candidate mechanism to test, not a template to copy. | low | Hook type "question" is 27.2 percentage points more prevalent in the at-or-above 75th-percentile group. The direction survives 72/72 leave-one-video-out runs; the delta ranges from +24.3 percentage points to +29.3 percentage points. The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is +5.4 percentage points to +37.1 percentage points. Treat this as a matched-test candidate, not a winning formula. The contrast remains observational and shares causes with creator, topic, platform, age, and production differences. | Use a matched owned-content pair to isolate the pattern while holding topic, platform, duration, and posting window as constant as practical. |

### What could overturn these conclusions

- **broad_uncertainty_is_a_routing_signal.** Alternatives: The comment classifier may default ambiguous short comments into the broad theme. / A few selected videos may invite generic questions that do not represent the wider student population.
  - Change our mind if: Human recoding splits most broad-theme signals into stable, narrower needs. / Owned generic-advice posts outperform matched specific-diagnostic posts on retention and saves.
- **proof_is_a_product_wedge_not_an_automatic_reach_mechanism.** Alternatives: The topic label combines weak generic tips with stronger visible transformations. / Platform, creator, recency, and execution quality may explain the observed performance split.
  - Change our mind if: Matched owned proof-transformation posts fail to improve saves or completion versus generic advice. / Human recoding shows that the apparent cross-source proof theme is a taxonomy artifact.
- **access_is_important_but_currently_source_concentrated.** Alternatives: One source video may have elicited a locally intense concern that is not broadly prevalent. / Cost concerns may be undercounted elsewhere because the collection queries did not target affordability directly.
  - Change our mind if: A broader source sample does not reproduce the theme. / Matched owned tests show no qualified engagement or useful follow-up behavior.
- **observed_winner_pattern_requires_owned_replication.** Alternatives: The category may be correlated with a topic or creator rather than performance. / The heuristic label may not capture the actual opening mechanism.
  - Change our mind if: The contrast disappears after human recoding or basic stratification. / Three matched owned pairs do not reproduce the directional retention difference.

### Audience evidence depth

| Theme | Signals | Share | Unique source pages | Largest-page share | Source pattern | Evidence strength |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| general_early_career_uncertainty | 61 | 62.9% | 18 | 16.4% | mixed | moderate |
| resume_and_proof | 12 | 12.4% | 12 | 8.3% | distributed | moderate |
| access_compensation_and_cost | 12 | 12.4% | 4 | 58.3% | concentrated | directional |
| international_work_authorization | 4 | 4.1% | 4 | 25.0% | distributed | directional |
| internship_performance | 2 | 2.1% | 2 | 50.0% | concentrated | thin |
| application_silence_and_volume | 1 | 1.0% | 1 | 100.0% | concentrated | thin |
| career_direction | 1 | 1.0% | 1 | 100.0% | concentrated | thin |
| interview_preparation | 1 | 1.0% | 1 | 100.0% | concentrated | thin |
| networking_and_outreach | 1 | 1.0% | 1 | 100.0% | concentrated | thin |
| rejection_and_wellbeing | 1 | 1.0% | 1 | 100.0% | concentrated | thin |
| starting_without_formal_experience | 1 | 1.0% | 1 | 100.0% | concentrated | thin |

Signal volume and source breadth answer different questions. Repeated comments on one page can show intensity around one stimulus; they do not establish population prevalence.

### Exploratory performance contrasts

High-performance means at or above the within-platform and posting-age 75th percentile. The comparison group is the remaining scored corpus.

| Dimension | Category | High-performance group | Comparison group | Difference | Leave-one-out direction | Leave-one-out range | Stability |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| topic | resume_and_application | 1/21 (4.8%) | 17/51 (33.3%) | -28.6 pp | 100.0% (direction_holds) | -33.3 pp to -27.2 pp | fragile |
| hook_type | question | 9/21 (42.9%) | 8/51 (15.7%) | +27.2 pp | 100.0% (direction_holds) | +24.3 pp to +29.3 pp | directional |
| hook_type | direct_statement | 8/21 (38.1%) | 31/51 (60.8%) | -22.7 pp | 100.0% (direction_holds) | -25.8 pp to -20.8 pp | directional |
| cta_type | none | 6/21 (28.6%) | 25/51 (49.0%) | -20.4 pp | 100.0% (direction_holds) | -24.0 pp to -19.0 pp | directional |
| format | talking_point | 6/21 (28.6%) | 5/51 (9.8%) | +18.8 pp | 100.0% (direction_holds) | +15.2 pp to +20.6 pp | directional |
| topic | interview | 5/21 (23.8%) | 4/51 (7.8%) | +16.0 pp | 100.0% (direction_holds) | +12.2 pp to +17.8 pp | directional |
| cta_type | soft_prompt | 9/21 (42.9%) | 14/51 (27.5%) | +15.4 pp | 100.0% (direction_holds) | +12.6 pp to +17.5 pp | directional |
| cta_type | follow_or_comment | 4/21 (19.1%) | 3/51 (5.9%) | +13.2 pp | 100.0% (direction_holds) | +9.1 pp to +15.0 pp | fragile |

#### Platform sensitivity

- **topic: resume_and_application.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is -37.1 percentage points to -10.7 percentage points.
- **hook_type: question.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is +5.4 percentage points to +37.1 percentage points.
- **hook_type: direct_statement.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is -32.9 percentage points to -0.9 percentage points.
- **cta_type: none.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is -42.0 percentage points to -10.0 percentage points.
- **format: talking_point.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is +10.0 percentage points to +36.6 percentage points.
- **topic: interview.** The direction survives 1/2 leave-one-platform-out runs; the platform-omission range is -12.5 percentage points to +30.0 percentage points, with 1 sign flips and 0 zero-delta runs.
- **cta_type: soft_prompt.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is +12.8 percentage points to +19.6 percentage points.
- **cta_type: follow_or_comment.** The direction survives 2/2 leave-one-platform-out runs; the platform-omission range is +12.9 percentage points to +14.3 percentage points.

The leave-one-out diagnostics ask whether removing any single scored video or one entire platform changes the observed direction; they do not repair confounding or make the estimate precise. These contrasts remain hypothesis generators. They do not control for creator, topic, time, audience, or production quality and therefore do not identify causes.

### Research tensions

- **A topic can be strategically important even when it is not overrepresented among observed high performers; resume/application is -28.6 percentage points in this split.** Optimizing only for competitor reach would erase product differentiation and audience utility. Resolution: Use competitor performance to shape packaging, while audience evidence and product truth determine which problems deserve coverage.
- **12 affordability signals compress to 4 source pages.** Repeated comments can show intensity around one stimulus without establishing broad prevalence. Resolution: Report both signal count and unique source pages; treat concentrated themes as exploration lanes.
- **Within-cohort performance contrasts are useful for hypothesis generation but cannot identify why distribution occurred.** A plausible creative story can become false certainty if creator, platform, timing, and audience are ignored. Resolution: Translate each pattern into a matched owned test with an explicit falsification rule.
- **Heuristic labels are reproducible, but reproducibility alone does not make them semantically correct.** Broad or overlapping labels can manufacture apparent gaps and performance differences. Resolution: Keep labels as exploratory metadata and require human recoding before confirmatory decisions.

## Prioritized content program

| Priority | Series | Voice | Audience problem | Evidence rule |
| ---: | --- | --- | --- | --- |
| 1 | Close the Proof Gap | operator | My resume is all coursework or responsibilities. | Show requirement, truthful evidence, rewrite, and review. |
| 2 | Student Scam Check | radar | I cannot tell whether this opportunity is legitimate. | Verify employer source and apply current FTC checks. |
| 3 | Opportunity Radar | radar | I need a current opening that actually fits me. | Show timestamp, pay, location, eligibility, deadline, and first-party URL. |
| 4 | Application Leak Check | operator | I applied everywhere and heard nothing. | Diagnose one observable weakness without claiming it caused rejection. |
| 5 | No Internship, Still Build Proof | operator | I missed summer recruiting or have no formal experience. | Use bounded project, campus, work, or community evidence. |
| 6 | Interview Process, Not Perfect Answers | operator | I freeze or ramble in interviews. | Teach a repeatable reasoning and practice loop. |
| 7 | Coffee Chat Without the Cringe | peer | Networking feels transactional and awkward. | Use a low-pressure research question and explicit follow-up boundary. |
| 8 | Rejection Reset | peer | Ghosting and rejection are becoming personal. | Separate known facts, guesses, process review, and next action. |
| 9 | Internship Reality Check | peer | I do not know the unwritten rules after I start. | Use observable workplace signals and a feedback loop. |
| 10 | AI, But Keep It True | operator | AI makes my application generic or inaccurate. | Show source evidence, generated draft, human edit, and final control. |
| 11 | CPT and OPT Question Router | radar | I do not know where work-authorization questions belong. | Link USCIS guidance and direct personal cases to the student DSO. |
| 12 | Can I Afford This Internship? | operator | Pay, housing, transit, and lost wages may make the role inaccessible. | Calculate disclosed costs and label unknowns; do not give legal conclusions. |
| 13 | Small Employer Radar | radar | Large-brand roles are crowded and close early. | Verify smaller-employer freshness and explain role fit. |
| 14 | Community College and Transfer Proof | peer | Generic advice assumes a four-year residential network. | Use audience-specific sources and avoid deficit framing. |
| 15 | Return Offer Signal Check | operator | I want to turn an internship into a full-time offer. | Teach feedback, contribution, communication, and decision checkpoints without guarantees. |

## Falsifiable owned-content tests

| Test | Hypothesis | Minimum design | Falsification rule |
| --- | --- | --- | --- |
| proof_transformation_vs_generic_advice | A visible requirement-to-evidence transformation will improve completion and saves relative to generic resume advice. | At least three paired posts with topic, duration, posting window, and distribution conditions matched as closely as practical. | Reject the directional hypothesis if the intervention fails to beat its matched comparator on median completion and saves across the paired set. |
| question_diagnosis_vs_direct_statement | A specific diagnostic question will improve early retention relative to a direct statement on the same student problem. | At least three within-platform matched pairs before treating the direction as repeatable. | Reject the directional hypothesis if the question opening does not improve median 3-second retention across the matched pairs. |
| affordability_utility_lane | A full-cost internship check will earn more qualified saves and specific follow-up questions than prestige-led opportunity coverage. | Run at least three matched opportunity pairs across different cost profiles and review comment quality manually. | Pause the lane if it does not improve qualified saves or produce materially more specific access questions across the matched set. |

Each test must keep equivalent measurement windows and retain its stated guardrails. A directional competitor pattern is not promoted to a content rule unless the owned test reproduces it.

## Nine-post owned test

| Post | Voice | Series | Hypothesis | Primary measures |
| ---: | --- | --- | --- | --- |
| 1 | operator | Close the Proof Gap | A visible truthful before/after earns saves and completion. | hook retention, completion, saves |
| 2 | peer | Rejection Reset | Recognition plus one bounded action earns shares and comments. | shares, comments, completion |
| 3 | radar | Opportunity Radar | Verified specifics earn saves and link clicks. | saves, link clicks, profile visits |
| 4 | operator | Application Leak Check | A one-leak diagnostic sustains average watch time. | average watch time, completion, saves |
| 5 | peer | Coffee Chat Without the Cringe | A low-pressure script earns shares without overpromising referrals. | shares, saves, comments |
| 6 | radar | Student Scam Check | An urgent official-source check earns completion and shares. | completion, shares, follows |
| 7 | operator | AI, But Keep It True | Visible human review differentiates the product and drives profile visits. | profile visits, link clicks, saves |
| 8 | peer | Internship Reality Check | A workplace-recognition moment grows follows and comments. | follows, comments, shares |
| 9 | radar | Small Employer Radar | A less-crowded verified alternative drives qualified clicks. | link clicks, saves, completion |

Compare posts after equivalent measurement windows. Retain platform and age cohorts; do not treat raw views from different platforms as a shared performance scale.

## Ranked additional data sources

| Rank | Source | Category | Access | Freshness | Privacy |
| ---: | --- | --- | --- | --- | --- |
| 1 | [Handshake Internships Index 2025](https://joinhandshake.com/network-trends/handshake-internships-index-2025/) | market_demand | public_web | 2025 | low |
| 2 | [Handshake Internship Report 2026](https://joinhandshake.com/employers/internship-report-2026/) | market_demand | public_web_summary | 2026 | low |
| 3 | [NACE Internship and Co-op Report 2025](https://www.naceweb.org/docs/default-source/default-document-library/2025/publication/executive-summary/2025-nace-internship-and-coop-report-executive-summary.pdf) | market_demand | public_pdf | 2025 | low |
| 4 | [NACE skills-based hiring evidence](https://www.naceweb.org/talent-acquisition/best-practices/d78c118a-edaa-4cec-beef-7f59827d264e) | skills_and_proof | public_web | 2025 | low |
| 5 | [FTC college student job-scam guidance](https://consumer.ftc.gov/consumer-alerts/2025/05/college-students-avoid-scammers-while-you-job-hunt) | safety | public_web | 2025 | low |
| 6 | [USCIS practical training guidance](https://www.uscis.gov/node/92821) | work_authorization | public_web | 2026 | low |
| 7 | [Department of Labor internship fact sheet](https://www.dol.gov/agencies/whd/fact-sheets/71-flsa-internships) | compensation_and_access | public_web | 2018_current_guidance | low |
| 8 | [BLS employment by educational attainment and age](https://www.bls.gov/cps/cpsaat07b.htm) | labor_market | public_table | 2025 | low |
| 9 | [Google Trends US demand](https://trends.google.com/trends/?geo=US) | search_demand | public_web_rate_limited | current | low |
| 10 | [Internships.com Search Console](https://search.google.com/search-console/about) | owned_search_demand | future_owned_interface | future | medium_aggregate_only |
| 11 | [College Recruiter](https://www.collegerecruiter.com/) | marketplace_and_editorial | public_web | current | low |
| 12 | [Jobright](https://jobright.ai/) | ai_marketplace | public_web | current | low |
| 13 | [Riipen](https://www.riipen.com/) | experience_building | public_web | current | low |
| 14 | [Acadium](https://www.acadium.com/) | experience_building | public_web | current | low |
| 15 | [Careerflow for Students](https://www.careerflow.ai/for-students) | ai_preparation | public_web | current | low |
| 16 | [Big Interview](https://www.biginterview.com/) | interview_preparation | public_web | current | low |
| 17 | [12twenty](https://12twenty.com/) | campus_infrastructure | public_web | current | low |
| 18 | [uConnect](https://www.gouconnect.com/) | campus_infrastructure | public_web | current | low |
| 19 | [AfterCollege](https://www.aftercollege.com/) | marketplace | public_web | current_unknown | low |
| 20 | [Teal](https://www.tealhq.com/) | ai_preparation | public_web | current | low |
| 21 | [Huntr](https://huntr.co/) | ai_preparation | public_web | current | low |
| 22 | [Final Round AI](https://www.finalroundai.com/) | ai_preparation | public_web | current | low |
| 23 | [r/internships RSS](https://www.reddit.com/r/internships/new/.rss?limit=25) | audience_voice | public_rss | current | medium_redact_identity |
| 24 | [r/college internship search RSS](https://www.reddit.com/r/college/search.rss?q=internship%20OR%20job&restrict_sr=on&sort=new&t=year&limit=25) | audience_voice | public_rss | current | medium_redact_identity |
| 25 | [r/careerguidance early-career RSS](https://www.reddit.com/r/careerguidance/search.rss?q=internship%20OR%20recent%20graduate&restrict_sr=on&sort=new&t=year&limit=25) | audience_voice | public_rss | current | medium_redact_identity |
| 26 | [r/resumes student RSS](https://www.reddit.com/r/resumes/search.rss?q=internship%20OR%20college%20student&restrict_sr=on&sort=new&t=year&limit=25) | audience_voice | public_rss | current | medium_redact_identity |
| 27 | [r/cscareerquestions internship and new-grad RSS](https://www.reddit.com/r/cscareerquestions/search.rss?q=internship%20OR%20new%20grad&restrict_sr=on&sort=new&t=year&limit=25) | audience_voice | public_rss | current | medium_redact_identity |
| 28 | [Public employer and marketplace opportunity pages](https://www.collegerecruiter.com/jobs) | opportunity_market | public_web | current_revalidation_required | low |
| 29 | [Internships.com aggregate product events](schemas/owned-research-events.schema.json) | owned_product_demand | future_owned_interface | future | medium_aggregate_only |
| 30 | [Internships.com owned social analytics](schemas/owned-research-events.schema.json) | owned_content_outcomes | future_owned_interface | future | low_aggregate_only |

The registry contains 30 ranked sources, 12 observed first-party/public market signals, and 6 opportunity-format examples. Opportunity availability, compensation, deadline, location, and eligibility require immediate first-party revalidation before content use.

## Coverage and blocker ledger

- **discovery: partial.** Cap $5; actual $3.0251; committed $0.275.
  - 1 discovery run failed; 0.275 USD remains a conservative unsettled ceiling, not a known charge.
- **audience_voice: partial.** Cap $4; actual $0.342; committed $0.
  - 3 of 18 selected posts returned no retained public comment signal; this is a comment-coverage gap, not negative audience evidence.
  - Reconciled from existing completed datasets with 10 read-only provider calls; no Actor was started.
  - The exact original comment-collection HTTP call count was not retained; five completed provider runs and their settled costs are recorded.
- **multimodal_analysis: completed.** Cap $12; actual $0.793701; committed $0.326534.
  - TwelveLabs does not report an invoice charge per analysis response; actual_cost_usd is the usage-pricing estimate and the remaining maximum estimate is conservatively retained.
- **supplemental_retrieval: partial.** Cap $2; actual $0.012; committed $0.
  - Collected 24 of the 40-signal minimum because public RSS coverage was incomplete or filtered as off-topic.
  - r/college returned a provider failure; this is a coverage gap, not negative audience evidence.
  - r/careerguidance returned a provider failure; this is a coverage gap, not negative audience evidence.
  - r/cscareerquestions returned a provider failure; this is a coverage gap, not negative audience evidence.
- **retry_reserve: reserved.** Cap $2; actual $0; committed $0.
- Google Trends returned HTTP 429; this is a measurement gap, so no relative search-demand ranking is claimed.
- One Instagram popular search failed; this is a provider gap, not evidence of absent demand.

## Evidence boundaries

- Observed evidence, company claims, heuristic classifications, and recommendations remain distinct fields.
- Missing, skipped, failed, and rate-limited providers are measurement gaps, never negative market evidence.
- Safety claims must use current FTC guidance; work-authorization claims must use current USCIS guidance and route individual cases to the student's DSO.
- All 36 newly selected items have timestamp-grounded Pegasus analysis. The prior historical corpus remains separately counted at 68 mapped posts and 906 semantic rows.
- Audience-signal counts are not survey prevalence estimates; the synthesis reports 39 unique source pages alongside 97 signals.
- The analytical synthesis retains alternative explanations and explicit falsification rules; recommendations are not treated as conclusions.
- This batch publishes nothing and contacts nobody.
