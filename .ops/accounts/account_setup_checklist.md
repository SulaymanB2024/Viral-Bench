# WorthScan Manual Account Setup Checklist

Use this checklist only in the official TikTok, Instagram, and YouTube
interfaces. Account creation, login, verification, posting, and account recovery
are human actions.

## Manual-Only Scope

- [ ] Do not automate signup, login, verification, CAPTCHA, posting, DMs, or
  account changes.
- [ ] Do not write passwords, recovery codes, 2FA codes, platform contact
  values, or account owner identity documents in this repo.
- [ ] Store account access material only in the account owner's approved
  password manager.
- [ ] Record only public, non-secret metadata in `.ops/accounts/socials.md`.
- [ ] Keep final posting approval separate from account setup approval.

## Preflight

- [ ] Pick the first available handle from `.ops/accounts/handle_ideas.md`.
- [ ] Pick the display name, bio, profile image prompt, and link-in-bio copy
  from `.ops/accounts/profile_copy.md`.
- [ ] Confirm the human account owner and backup recovery owner outside the repo.
- [ ] Confirm platform age, business, creator, and brand-channel requirements.
- [ ] Prepare the profile image and banner manually from approved assets.
- [ ] Confirm the first three rendered packages exist:
  `worthscan_bike_commuter_001`, `worthscan_scooter_battery_001`, and
  `worthscan_minifridge_001`.

## TikTok Setup Checklist

- [ ] Create the account manually in the official TikTok app or website.
- [ ] Claim the best available WorthScan handle.
- [ ] Set display name to `WorthScan` or the selected fallback.
- [ ] Add the approved bio and profile image.
- [ ] Switch to Business Account only if the operator wants analytics and the
  selected category fits the brand.
- [ ] Set category to a broad fit such as Education, Shopping and Retail, or
  Personal Finance only if it is accurate in the UI.
- [ ] Enable 2FA manually from platform settings.
- [ ] Confirm public profile URL and analytics access.
- [ ] Record status, handle, public URL, and setup date in
  `.ops/accounts/socials.md`.

## Instagram Professional Account Setup Checklist

- [ ] Create the account manually in the official Instagram app or website.
- [ ] Claim the best available WorthScan handle.
- [ ] Set display name to `WorthScan`.
- [ ] Add the approved bio, profile image, and link-in-bio copy.
- [ ] Switch to a Professional account manually.
- [ ] Choose Business or Creator based on the account owner's intended use.
- [ ] Select a truthful category; do not choose regulated financial advice.
- [ ] Enable 2FA manually from platform settings.
- [ ] Confirm Reels upload flow, insights access, and public profile URL.
- [ ] Record status, handle, public URL, and setup date in
  `.ops/accounts/socials.md`.

## YouTube Shorts Brand Channel Setup Checklist

- [ ] Create or select the Google account manually.
- [ ] Create a Brand Channel manually with channel name `WorthScan`.
- [ ] Claim the best available WorthScan handle.
- [ ] Add the approved channel description, profile image, and banner.
- [ ] Add the approved link only after the destination is human-reviewed.
- [ ] Confirm Shorts upload flow, channel visibility, and analytics access.
- [ ] Enable 2FA manually from Google account settings.
- [ ] Record status, handle, channel URL, and setup date in
  `.ops/accounts/socials.md`.

## 2FA And Password-Manager Checklist

- [ ] Generate the platform password inside the account owner's approved password
  manager.
- [ ] Store only the account name and platform in repo docs, never the password
  value.
- [ ] Turn on 2FA for each platform before posting.
- [ ] Store recovery codes only in the password manager or another approved
  secure location outside the repo.
- [ ] Confirm a backup recovery owner exists outside the repo.
- [ ] Confirm no screenshots or exports with access material were added to the
  workspace.

## Account Recovery Checklist

- [ ] Account owner confirms recovery contact methods in the platform UI.
- [ ] Backup owner confirms they can help recover access without needing repo
  files.
- [ ] Recovery codes are generated and stored outside the repo.
- [ ] Public profile URL is recorded in `.ops/accounts/socials.md`.
- [ ] Account owner documents the support path outside the repo.
- [ ] Account is marked ready only after the human owner confirms recovery is
  complete.

## Manual Posting Checklist

- [ ] Open `.ops/launch/launch_queue.md` and pick the next approved launch item.
- [ ] Open the rendered package under `.ops/creative_jobs/rendered/<job_id>/`.
- [ ] Review the output caption, hashtags, spoken script, posting notes, QA
  checklist, and approval file.
- [ ] Replace placeholder visuals with approved local item images before posting.
- [ ] Verify current comps manually on the posting day.
- [ ] Approve final platform caption, first comment, and public disclaimer.
- [ ] Post manually in the official app or website.
- [ ] Record the final public URL with `npm run metrics:create-post`.
- [ ] Add 1-hour, 24-hour, 72-hour, and 7-day metric reminders to the operator
  calendar.
