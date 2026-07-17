# Instagram general-post feed expansion — 2026-07-17

## Outcome

Viral-Bench now treats ordinary Instagram feed content as a first-class research
surface alongside TikTok, YouTube Shorts, and Instagram Reels. Images,
carousels, feed videos, and Reels remain distinct content types. Performance
comparisons are limited to the same platform, content type, and age bucket.

The existing discovery reports already contain useful feed data that was being
discarded by the short-video-only library filter. At the local audit point they
contained 53 image posts and 39 carousels, all with public like and comment
counts. Those posts do not expose a public view denominator, so the library
ranks them by visible interactions and labels that limitation explicitly.

## Source strategy

The first canary uses four complementary lanes:

1. **Known profile feeds** — recent posts from 18 reviewed internship,
   early-career, experience-building, and job-search accounts.
2. **Hashtag feeds** — general posts from bounded internship, career, resume,
   interview, and early-career hashtags.
3. **Profile discovery** — keyword searches for additional creators and
   editorial accounts outside the fixed competitor list.
4. **Mentions and UGC** — public posts that tag selected brands, which can
   surface students, alumni, partner organizations, and independent creators.

The config is
`.ops/competitor_research/instagram-general-posts-canary-20260717.json`. Its
combined maximum charge is `$4`; that is a ceiling, not a spending target.

Validate the current Actor input contract without a credential or external call:

```bash
npm run content-map:discover -- \
  --config .ops/competitor_research/instagram-general-posts-canary-20260717.json \
  --validate-only
```

Do not start the paid run until the operator has confirmed the credential and
budget gate. A future live output should be written under
`.semantic-artifacts/competitor-content/discovery/`, not committed.

## Provider portfolio

The primary route remains the Apify-maintained
[Instagram Scraper](https://apify.com/apify/instagram-scraper). Its current
contract supports profile posts, hashtagged posts, Reels, mentions, carousels,
date filters, user/profile discovery, and structured public engagement fields.
The canary pins the inspected `0.0.691` build so a later Actor schema change
cannot silently reinterpret these inputs.
Keeping the first canary on the existing Apify execution path avoids introducing
a second billing and provenance adapter before relevant yield is known.

Useful fallback or expansion providers are:

- [Meta Instagram Hashtag Search](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search)
  for an official, permissioned hashtag lane when the required professional
  account, app review, linked assets, and tokens exist. It is not a general
  public keyword feed.
- [Bright Data Instagram Scraper API](https://docs.brightdata.com/datasets/scrapers/instagram/introduction)
  for URL-based and asynchronous discovery of profiles, posts, Reels, and
  comments with a separately managed API contract.
- [EnsembleData Instagram API](https://ensembledata.com/instagram-api/scraping-overview)
  for user posts, keyword/hashtag search, tagged content, and additional trend
  surfaces such as music.
- [ScrapeCreators hashtag-post search](https://scrapecreators.com/instagram-search-hashtag-posts-api)
  as a low-friction public-data fallback. Its hashtag discovery depends on
  Google-indexed Instagram pages, so missing results are an indexing gap rather
  than evidence that content is absent.

These providers should enter through a provider adapter that emits the same
normalized discovery report contract. Do not mix raw vendor shapes directly
into ranking or semantic analysis.

## Analysis contract

- Reels and videos may use public views plus engagement rate when available.
- Images and carousels use visible likes, comments, shares, and saves only.
- Compare only within platform, content type, and age bucket.
- Repeated captures may establish view or interaction velocity; one snapshot
  cannot.
- A high percentile adds a post to the analysis queue. It does not prove that
  its cover, slide order, caption, hook, or CTA caused distribution.
- Images and carousels stay out of the TwelveLabs video-analysis path unless a
  separate reviewed visual-analysis contract is added.

## Canary decision gate

Expand beyond the `$4` canary only if all of the following hold:

- at least 25 relevant non-video Instagram posts survive normalization;
- at least three source lanes produce relevant items;
- at least 20% of returned post rows are relevant to internship, job-search,
  early-career, proof-building, access, or interview themes;
- publication timestamps and at least one public interaction metric are present
  on at least 80% of retained ordinary posts; and
- no single account supplies more than half of the retained ordinary-post pool.

Stop after two consecutive provider failures or if relevant yield remains below
20%. Missing or blocked sources remain measurement gaps, not negative evidence.
