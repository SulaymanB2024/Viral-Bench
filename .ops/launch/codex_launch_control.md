# Viral Wrench Codex Launch Control

Use this prompt as the operating contract for a Codex agent running the
WorthScan launch loop.

## Current Launch Authority

- Use the Codex in-app browser for live account and publishing work.
- Read the ignored local environment with `--env-file .env`; do not print its
  values.
- `ALLOW_BROWSER_UI=true` permits the approved browser-assisted research lane.
- `ALLOW_SOCIAL_PUBLISHING=true` permits a queued job to proceed after its job
  policy, asset approval, and live account confirmation are satisfied.
- The initial launch jobs are `worthscan_scooter_battery_001`,
  `worthscan_bike_commuter_001`, and `worthscan_minifridge_001`.
- Account automation remains disabled. Do not store or expose account access
  material in the repository.

## Live Account Handoff Checkpoint (2026-07-12)

- TikTok is at its official birthday gate in the Codex in-app browser; no date
  is filled and Next is disabled. It still requires the account owner's real
  birthday, password, and email code. The observed Google option did not surface
  a consent or account-selection page. Do not retry a missing popup or infer an
  OAuth result.
- No official Instagram tab is currently retained. Public signup preparation is
  recorded with candidate handle `@tryworthscan`; no account has been submitted.
- No verified birth date is available from the approved non-secret context. Do
  not infer a legal age, date of birth, password, code, or recovery detail.
- Public-safe profile and banner assets are prepared in `.ops/accounts/assets/`;
  review them in the official platform UI before upload.
- The account owner must complete the remaining real-date and credential or
  platform-verified OAuth step in the official UI before profile setup can
  continue.

## Required Operating Loop

1. Start with `npm run harness -- publishing-handoff-plan --env-file .env` and
   `npm run harness -- launch-map --env-file .env`.
2. Select one queued job, validate it, and render it through the local renderer.
3. Replace every placeholder with approved public-safe visual material. Do not
   invent an item, an exact valuation, a comp, a seller detail, or a test result.
4. Check every slide, caption, hashtag, description, and first comment against
   the job manifest and the posting QA checklist.
5. Record factual launch readiness in the relevant approval record; do not mark
   an asset approved unless it has actually been reviewed.
6. In the in-app browser, verify the intended public account, handle, channel,
   and platform surface before typing or uploading anything.
7. Before a final create-account, publish, comment, DM, follow, like, or
   permission-changing action, state the exact destination, public content, and
   external effect, then obtain a live confirmation.
8. After a verified public post, create the local metrics record with the real
   public URL and collect 1-hour, 24-hour, 72-hour, and 7-day snapshots.
9. Use `npm run metrics:compare -- --metric saves` after comparable snapshots
   exist, then use the highest-signal hook for the next batch.

## First-Frame Hook Set

- `worthscan_scooter_battery_001`: “Scan this scooter before battery risk eats
  the deal.”
- `worthscan_bike_commuter_001`: “Scan this commuter bike before you pay.”
- `worthscan_minifridge_001`: “Scan this mini fridge before move-in week.”

## Publish-Confirmation Prompt

Use this wording immediately before each final public submission:

> Ready to publish the reviewed `<job_id>` package to `<platform>` on
> `<public handle>`? This will make the listed caption and media publicly
> visible. Confirm this exact post.

## Non-Negotiable Content Rules

- Keep all valuation claims as estimates and ranges, never guarantees or exact
  appraisals.
- Keep private seller details, private messages, personal contact information,
  and access material out of visuals and copy.
- Use only official visible platform surfaces. Do not use hidden endpoints,
  bypass challenges, or collect non-public analytics.
- Treat a missing account, verification step, or platform restriction as a
  handoff state; preserve the prepared package and report the exact blocker.
