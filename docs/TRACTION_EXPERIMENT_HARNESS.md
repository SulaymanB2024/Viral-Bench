# Traction Experiment Harness

The harness has one objective: grow audience traction through repeatable,
evidence-backed creative experiments. It does not optimize for leads, revenue,
DMs, or automated publishing.

## Production lanes

- `image_slideshow`: generated or purpose-created images delivered as a native
  carousel or a locally rendered video.
- `generated_video`: provider-generated portrait video delivered as a rendered
  video.

The creative lane is separate from the audio plan. Commercial platform music is
recorded as a recommendation and added manually at posting; copyrighted trend
audio is not downloaded into the repository. Provider-native or operator-owned
audio remains review-gated.

## Validate an experiment

```bash
npm run traction -- validate \
  --file .ops/traction_experiments/sample_slideshow_traction_001.json

npm run traction -- validate \
  --file .ops/traction_experiments/sample_video_traction_001.json
```

Every experiment must:

- use `objective: "audience_traction"`;
- include `view_velocity` plus at least one quality signal;
- change no more than one or two declared dimensions per variant;
- wait for at least the declared checkpoint before choosing a winner;
- repeat a pattern at least twice before promoting it as reusable;
- stop after two or three non-improving variants;
- keep posting manual and human-approved.

## Metrics contract

Link public posts back to `experiment_id`, `variant_id`, `creative_lane`,
`delivery_mode`, and `audio_mode`. Record the usual public counters plus the
platform analytics available to the operator:

- average watch time;
- completion rate;
- rewatch rate;
- view velocity;
- share, save, follow, and profile-visit rates.

Completion and rewatch rates are stored as fractions from `0` to `1`. Share,
save, follow, and profile-visit rates are derived as the event count divided by
views. View velocity is derived as views divided by elapsed hours since posting.
The harness exposes these signals separately instead of hiding them inside one
arbitrary composite score.

Compare variants inside a matched content family and checkpoint. A model's
pre-publish opinion is a QA signal, not observed traction.
