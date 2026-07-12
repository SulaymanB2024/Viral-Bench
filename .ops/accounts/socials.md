# WorthScan Social Account Registry

Record only public account metadata and non-secret operator status here. Keep
all account access material outside the repo.

Machine-readable, non-secret launch status lives in
`.ops/accounts/account_readiness.json`. Keep it aligned with this registry after
each real platform change.

## Brand

Brand name:
- WorthScan

Public positioning:
- AI-assisted resale estimate content for used bikes, scooters, dorm gear, and
  student resale listings.
- WorthScan compares visible item details, local comps, repair risk, and pickup
  hassle before giving a range.
- Public language must say estimate, range, and confidence; it must not promise
  a guaranteed appraisal.

## Account Status Matrix

| Platform | Target Public Name | Preferred Handle | Backup Handles | Account Type | Status | Public URL |
| --- | --- | --- | --- | --- | --- | --- |
| TikTok | WorthScan | `@worthscan` | `@tryworthscan`, `@worthscanhq`, `@worthscanlab` | Business Account if suitable | Signup prepared; not created | Pending |
| Instagram | WorthScan | `@tryworthscan` | `@worthscan`, `@worthscanhq`, `@worthscanlab` | Professional, Business or Creator | Signup prepared; not created | Pending |
| YouTube Shorts | WorthScan | `@worthscan` | `@tryworthscan`, `@worthscanhq`, `@scanworth` | Brand Channel | Created; profile setup awaiting security verification | https://www.youtube.com/@worthscan |

## Metadata Allowed In This File

- Public handle.
- Public profile URL.
- Public display name.
- Public bio or channel description.
- Platform account type.
- Setup status.
- Human owner role, written generically, such as `Account owner`.
- Manual setup date.
- Manual approval date.

## Metadata Not Allowed In This File

- Passwords.
- Recovery codes.
- 2FA codes.
- Platform contact values.
- Identity verification material.
- Private account screenshots.
- Private messages.
- Billing details.

## Manual Setup Status

### TikTok

- Status: Official TikTok birthday gate is retained in the Codex in-app browser;
  account is not created.
- Prepared profile asset: `.ops/accounts/assets/worthscan-profile-v1.png`.
- Next action: Human owner enters their actual birth date, chooses and retains a
  password outside this repository, then completes the official email-code
  verification. Resume profile setup only after that live verification succeeds.
- Required completion evidence: public URL, display name, bio, profile image,
  2FA enabled confirmation, and analytics access confirmation.

### Instagram

- Status: Public signup preparation is recorded, but no official Instagram tab
  is currently retained in the Codex in-app browser; account is not created.
  The public candidate handle `@tryworthscan` was valid at the last live check.
- Prepared profile asset: `.ops/accounts/assets/worthscan-profile-v1.png`.
- Next action: Human owner enters their actual birth date, chooses and retains a
  password outside this repository, then completes the official verification,
  switches to Professional, and applies the approved bio/profile image.
- Required completion evidence: public URL, display name, professional category,
  2FA enabled confirmation, and Reels insights access confirmation.

### YouTube Shorts

- Status: Brand Channel created as `WorthScan` / `@worthscan` on 2026-07-10.
  The public channel URL is https://www.youtube.com/@worthscan.
- Next action: Complete Google's live `Verify it's you` security check in the
  official browser, then apply the channel description, profile image, and
  banner. Do not attempt to bypass the security check.
- Prepared profile and banner assets:
  `.ops/accounts/assets/worthscan-profile-v1.png` and
  `.ops/accounts/assets/worthscan-youtube-banner-v1.png`.
- Required completion evidence: public URL, channel handle, channel description,
  2FA enabled confirmation, and Shorts upload confirmation.
