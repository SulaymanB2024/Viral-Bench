# Creative Center Research Protocol

TikTok Creative Center can be used as a manual research surface for visible examples. It is not a programmatic provider and is not a replacement for an official API.

Process:

1. Open Creative Center manually in a normal browser session.
2. Search the target niche and format without bypassing gates or hidden endpoints.
3. Record only facts visible in the UI: source URL, format, visible metrics, hook, caption or visible text, and visual notes.
4. Write the observation into `.ops/browser/samples/` or another local capture file using `schemas/browser-capture.schema.json`.
5. Set `human_review_status` to `pending_review` until a human reviewer approves the capture.
6. Ingest only approved captures with `npm run trend -- browser:ingest-capture --file <capture.json> --db trend_examples.sqlite`.

Evidence notes must describe what was visible and how it was collected. Do not claim inaccessible metrics, private audience data, account ownership, or platform endorsement.
