# WorthScan Manual Launch Packet

This is the step-by-step human checklist from account creation to the first
metric entry. It is intentionally manual-only.

## 1. Confirm Launch Boundary

- [ ] Read `.ops/accounts/account_setup_checklist.md`.
- [ ] Confirm no account creation, login, verification, CAPTCHA, posting, DM, or
  account change will be automated.
- [ ] Confirm account access material stays outside the repo.
- [ ] Confirm the human account owner controls account setup and recovery.

## 2. Choose Public Brand Metadata

- [ ] Pick the first available handle from
  `.ops/accounts/handle_ideas.md`.
- [ ] Pick display name and bio from `.ops/accounts/profile_copy.md`.
- [ ] Generate or prepare profile image from the approved prompt.
- [ ] Generate or prepare YouTube banner from the approved prompt.
- [ ] Pick the link-in-bio copy and destination after human review.

## 3. Create Accounts Manually

- [ ] Create TikTok manually in the official platform UI.
- [ ] Create Instagram manually in the official platform UI.
- [ ] Create YouTube Brand Channel manually in the official Google/YouTube UI.
- [ ] Apply public handle, display name, bio, profile image, and banner.
- [ ] Enable 2FA manually for each platform.
- [ ] Confirm account recovery manually outside the repo.
- [ ] Record only public handles, public URLs, setup status, and approval status
  in `.ops/accounts/socials.md`.

## 4. Confirm First Rendered Packages

- [ ] Confirm `.ops/creative_jobs/rendered/worthscan_bike_commuter_001/`
  exists.
- [ ] Confirm `.ops/creative_jobs/rendered/worthscan_scooter_battery_001/`
  exists.
- [ ] Confirm `.ops/creative_jobs/rendered/worthscan_minifridge_001/`
  exists.
- [ ] Open each package's `manifest.json`, `output/posting_notes.md`,
  `qa/checklist.md`, and `qa/approval.md`.
- [ ] Confirm generated assets are not treated as approved until a human reviews
  them.

## 5. Review First Launch Item

- [ ] Open `.ops/launch/launch_queue.md`.
- [ ] Start with `worthscan_bike_commuter_001`.
- [ ] Review the TikTok caption, Instagram caption, YouTube Shorts
  title/description, hashtags, first comment, posting checklist, and metric
  snapshot schedule.
- [ ] Replace placeholder visuals with approved local item visuals.
- [ ] Verify three current local comps manually.
- [ ] Confirm private seller details are removed from visuals and text.
- [ ] Confirm estimate, range, confidence, and disclaimer language.

## 6. Post Manually

- [ ] Open the official platform app or website manually.
- [ ] Upload the reviewed WorthScan package manually.
- [ ] Paste the reviewed platform caption manually.
- [ ] Add the reviewed hashtags manually.
- [ ] Publish manually only after final human approval.
- [ ] Add the reviewed first comment manually after the post is live.
- [ ] Save the public post URL outside private account surfaces, then enter it
  into the metrics CLI.

## 7. Create First Metric Record

After the first manual post is live, run:

```bash
npm run metrics:create-post -- \
  --post-id worthscan-post-001 \
  --job-id worthscan_bike_commuter_001 \
  --platform TikTok \
  --account-handle @worthscan \
  --posted-url https://example.com/manual-post-url \
  --content-type slideshow \
  --hook "Scan this commuter bike before you pay" \
  --format slideshow \
  --cta "Comment scan with the next listing" \
  --notes "manual post"
```

Use the actual public post URL only after the human post is live.

## 8. Add 1-Hour Metric Snapshot

At the 1-hour mark after manual posting, run:

```bash
npm run metrics:add-snapshot -- \
  --post-id worthscan-post-001 \
  --views 0 \
  --likes 0 \
  --comments 0 \
  --shares 0 \
  --saves 0 \
  --follows 0 \
  --profile-visits 0 \
  --dms 0 \
  --notes "1-hour manual snapshot"
```

Replace the zero values with the visible metrics at capture time.

## 9. Schedule Follow-Up Metric Entries

- [ ] 1-hour snapshot: views, likes, comments, shares, saves, follows, profile
  visits, DMs, and comment themes.
- [ ] 24-hour snapshot: same metrics plus save/share quality.
- [ ] 72-hour snapshot: same metrics plus save/share quality.
- [ ] 7-day snapshot: final pilot read and next-batch decision.
- [ ] Compare the first three posts after all 7-day snapshots are entered.

## 10. Move To Next Launch Item

- [ ] Repeat the review, manual posting, and metrics steps for
  `worthscan_scooter_battery_001`.
- [ ] Repeat the review, manual posting, and metrics steps for
  `worthscan_minifridge_001`.
- [ ] Do not move any job to `posted/` until the human operator confirms the
  live post URL and approval record.
