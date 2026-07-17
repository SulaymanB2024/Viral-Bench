import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  loadTractionExperimentManifest,
  validateTractionExperimentManifest,
} from '../src/traction-experiment';

const SLIDESHOW_SAMPLE = path.join(
  process.cwd(),
  '.ops',
  'traction_experiments',
  'sample_slideshow_traction_001.json',
);
const VIDEO_SAMPLE = path.join(
  process.cwd(),
  '.ops',
  'traction_experiments',
  'sample_video_traction_001.json',
);

function sample(filePath = SLIDESHOW_SAMPLE): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

test('both traction production lanes validate with manual publishing boundaries', () => {
  const slideshow = loadTractionExperimentManifest(SLIDESHOW_SAMPLE);
  const video = loadTractionExperimentManifest(VIDEO_SAMPLE);

  assert.equal(slideshow.objective, 'audience_traction');
  assert.equal(slideshow.creative_lane, 'image_slideshow');
  assert.equal(slideshow.delivery_mode, 'native_carousel');
  assert.equal(video.creative_lane, 'generated_video');
  assert.equal(video.delivery_mode, 'rendered_video');
  assert.deepEqual(video.publishing_policy, {
    manual_only: true,
    human_approval_required: true,
    auto_posting_allowed: false,
  });
});

test('traction experiments reject conversion objectives', () => {
  assert.throws(
    () => validateTractionExperimentManifest({ ...sample(), objective: 'lead_generation' }),
    /objective must be audience_traction/,
  );
});

test('traction variants change at most the declared one or two dimensions', () => {
  const input = sample();
  const variants = structuredClone(input.variants) as Array<Record<string, unknown>>;
  variants[1].changed_dimensions = ['hook', 'first_frame', 'audio'];

  assert.throws(
    () => validateTractionExperimentManifest({ ...input, variants }),
    /changes more than 2 dimensions/,
  );
});

test('image slideshows cannot claim provider-native audio', () => {
  const input = sample();
  const variants = structuredClone(input.variants) as Array<Record<string, unknown>>;
  variants[0].audio_plan = {
    mode: 'provider_native_audio',
    track_id: null,
    track_title: null,
    source_url: null,
    captured_at: null,
    region: null,
    commercial_use_status: 'provider_generated',
    added_at_posting: false,
    notes: [],
  };

  assert.throws(
    () => validateTractionExperimentManifest({ ...input, variants }),
    /provider_native_audio is valid only for generated_video/,
  );
});

test('commercial platform music stays precleared and posting-time only', () => {
  const input = sample();
  const variants = structuredClone(input.variants) as Array<Record<string, unknown>>;
  const audio = variants[0].audio_plan as Record<string, unknown>;
  audio.added_at_posting = false;

  assert.throws(
    () => validateTractionExperimentManifest({ ...input, variants }),
    /must be a pending draft selection or a precleared track added at posting/,
  );
});

test('a platform-music variant cannot become post-ready before a real precleared track is selected', () => {
  const input = sample();
  const variants = structuredClone(input.variants) as Array<Record<string, unknown>>;
  variants[0].status = 'ready_for_manual_post';

  assert.throws(
    () => validateTractionExperimentManifest({ ...input, variants }),
    /must be a pending draft selection or a precleared track added at posting/,
  );
});
