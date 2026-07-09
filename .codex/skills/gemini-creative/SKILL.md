---
name: gemini-creative
description: Use when planning Gemini image or video-understanding work for ViralBench-lite creative jobs with paid-provider gates and local fallback requirements.
---

# Gemini Creative

Gemini is an optional external provider. It is never required for the local
operator scaffold.

## Gate Checks

1. Confirm the creative job lists `gemini_image` or
   `gemini_video_understanding` in `provider_policy.approved_providers`.
2. Confirm `ALLOW_PAID_GENERATION=true` before any paid generation or external
   provider call.
3. Confirm source media is operator-approved and contains no credentials,
   private account data, or verification material.

## Default Fallback

When the gate is closed, use `local_renderer` and manual notes instead. Return a
blocked-provider result rather than asking for secrets or attempting a live call.

## Output Rules

- Store generated files under `.ops/creative_jobs/rendered/<job_id>/`.
- Mark generated assets as not approved for posting until human review.
- Do not move anything to `posted/` or publish to social platforms.
