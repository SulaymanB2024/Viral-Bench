# WorthScan Metrics Tracking Template

Metrics are entered manually after a human posts. Use the local CLI store under
`.ops/metrics/post_metrics.json`.

## Create A Post Record

```bash
npm run metrics:create-post -- \
  --post-id worthscan-post-001 \
  --job-id worthscan_bike_commuter_001 \
  --platform TikTok \
  --account-handle @worthscan \
  --posted-url https://example.com/manual-post-url \
  --posted-at 2026-07-06T20:00:00.000Z \
  --content-type slideshow \
  --hook "Scan this commuter bike before you pay" \
  --format slideshow \
  --cta "Comment scan with the next listing" \
  --notes "manual post"
```

## Add A Snapshot

```bash
npm run metrics:add-snapshot -- \
  --post-id worthscan-post-001 \
  --captured-at 2026-07-06T21:00:00.000Z \
  --views 1200 \
  --likes 140 \
  --comments 24 \
  --shares 18 \
  --saves 90 \
  --follows 7 \
  --profile-visits 35 \
  --dms 2 \
  --notes "1 hour read"
```

## Compare Posts

```bash
npm run metrics:compare -- --metric saves
npm run metrics:compare -- --metric dms --platform TikTok
```

## Export

```bash
npm run metrics:export -- --format json --out .ops/metrics/post_metrics_export.json
npm run metrics:export -- --format csv --out .ops/metrics/post_metrics_export.csv
```

Tracked comparison metrics:

- views
- likes
- comments
- shares
- saves
- follows
- profile_visits
- dms

Interpretation rule:

- Treat early comparisons as directional only until the first three launch posts
  have complete 1-hour, 24-hour, 72-hour, and 7-day snapshots.
