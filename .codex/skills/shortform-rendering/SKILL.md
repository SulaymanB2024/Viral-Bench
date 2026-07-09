---
name: shortform-rendering
description: Use when rendering local short-form slide packages from ViralBench-lite creative job manifests.
---

# Shortform Rendering

Render from a creative job manifest through the local renderer. This creates a
review package only; it does not publish.

## Command

```bash
npm run creative -- render --job .ops/creative_jobs/incoming/used-bikes-scooters-scan-worth.json
```

The default output path is:

```text
.ops/creative_jobs/rendered/<job_id>/
```

## Review Contract

- Rendered slides are placeholders until item photos or listing screenshots are
  reviewed by the operator.
- Caption, hashtags, and posting notes must be checked before approval.
- Generated assets require human approval before a job can be recorded as
  posted.
- Do not auto-post or queue social posts from this skill.
