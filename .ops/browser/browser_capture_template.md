# Browser Capture Template

Copy this shape into a JSON file and fill it from manual observation only.

```json
{
  "capture_id": "creative-center-example-001",
  "source_name": "TikTok Creative Center",
  "source_url": "https://ads.tiktok.com/business/creativecenter/...",
  "captured_at": "2026-07-06T18:00:00.000Z",
  "niche": "AI-assisted resale valuation: used bikes",
  "platform": "TikTok",
  "observed_format": "slideshow",
  "visible_metrics": {
    "likes": "visible count if shown",
    "comments": "visible count if shown",
    "saves": "visible count if shown"
  },
  "hook": "Visible opening hook",
  "caption_or_visible_text": "Visible caption or on-screen text",
  "visual_notes": "Item-first opening, proof steps, payoff frame.",
  "why_it_may_work": "Concrete price tension and fast buy/pass payoff.",
  "remake_notes": "How to remake this for the target job.",
  "evidence_notes": "Manually observed in Creative Center; no scraping or hidden data.",
  "human_review_status": "pending_review"
}
```

Validation command:

```bash
npm run trend -- browser:validate-capture --file .ops/browser/samples/creative_center_bike_capture.json
```
