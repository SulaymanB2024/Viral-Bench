# WorthScan Launch Checklist

This checklist is the account-readiness gate before the launch queue is used.
Codex may assist in the configured in-app browser, but account verification and
the final public submission stay live-confirmation steps in the official
platform UI.

## Content Readiness

- [ ] The launch item is listed in `.ops/launch/launch_queue.md`.
- [ ] The rendered package exists under `.ops/creative_jobs/rendered/<job_id>/`.
- [ ] Slides, caption, hashtags, spoken script, posting notes, QA checklist, and
  approval file were reviewed by a human.
- [ ] Placeholder visuals were replaced with approved local item visuals before
  posting.
- [ ] Any valuation range is based on visible item details and manually checked
  local comps, not invented certainty.
- [ ] Public wording says estimate, range, and confidence.

## Account Readiness

- [ ] Public profile metadata is complete in `.ops/accounts/socials.md`.
- [ ] Account access material is stored outside the repo.
- [ ] 2FA is enabled on TikTok, Instagram, and YouTube before first post.
- [ ] Recovery ownership is confirmed outside the repo.
- [ ] Profile image, bio, and link-in-bio copy are approved.
- [ ] No account creation, login, verification, CAPTCHA, or posting workflow was
  automated.

## Manual Posting Boundary

- [ ] The human poster uses only the official platform app or website.
- [ ] No scraping, hidden endpoint use, auto-posting, or account automation is
  used.
- [ ] DMs and comments are answered manually from reviewed templates only.
- [ ] A job moves to `posted/` only after the human operator confirms the post is
  live and records the public URL.

## Metrics Boundary

- [ ] Create a metrics record only after the post is live.
- [ ] Enter the 1-hour metrics snapshot manually.
- [ ] Enter 24-hour, 72-hour, and 7-day snapshots manually.
- [ ] Compare early launch posts by saves, shares, comments, follows, and DMs,
  not only views.
