# Browser MCP Setup

Use browser tooling only for operator-reviewed, manual research support. The default state is blocked.

Required gate before any browser UI workflow:

- The provider request must use `provider: "browser_manual"`.
- The provider request must set `cost_policy.allow_browser_ui` to `true`.
- The shell environment must include `ALLOW_BROWSER_UI=true`.
- The task must fit `.ops/browser/allowed_browser_tasks.md`.

The browser workflow is not a scraper. Do not automate login, account creation, CAPTCHA, phone verification, posting, or platform bypass behavior. Do not store cookies, session tokens, private account details, or raw credentials in the repo.

Approved outputs are local notes, JSON capture files, and screenshots or references explicitly reviewed by the operator. Ingest only the structured capture JSON after human review.
