# Internships.com job-content draft analysis

Analyze only the supplied locally rendered Internships.com draft. It is
purpose-created media and contains no competitor footage or private student
data.

Use the following bounded Apify research as comparison context, not as causal
proof:

- Feed: `job-search-content-sources-20260716`
- Sample: 65 public TikTok metadata records across the reviewed Runway founder
  profile, the official Handshake profile, and an internship-search category
  proxy.
- Recurring metadata-inferred openings: direct statement, warning or
  contrarian framing, opportunity alert, and numbered list.
- Recurring metadata-inferred formats: short talking point, long explainer, and
  list explainer.
- Most posts in the sample had no explicit CTA; when present, question prompts,
  follow prompts, save/share prompts, and apply/click prompts appeared.
- The source artifact explicitly states that observed views do not prove a hook
  or format caused distribution, and the Internships.com cohort is a category
  proxy rather than official brand content.

Report only what is visibly or audibly present, with timestamps. Evaluate:

- whether the opening two seconds establish a direct, student-relevant problem
  or promise;
- whether the four-part `match, prove, people, review` structure is clear
  without relying on the caption outside the video;
- whether each slide remains on screen long enough to read and whether narration
  stays synchronized with the visible beat;
- whether the draft functions as a concise list explainer or feels overloaded;
- the exact on-screen text, spoken claims, hook, pacing, transitions, CTA, and
  disclaimer actually present;
- whether the useful guidance arrives before the product mention;
- whether any claim implies a guaranteed internship, interview, referral,
  response, offer, or automated submission;
- technical, accessibility, or evidence limitations that should be fixed before
  human review.

Do not infer virality, ranking causation, conversion, brand-account ownership,
or performance. Do not recommend copying source wording, footage, shot order,
creator identity, or branding. Return the requested structured
creative-analysis schema.
