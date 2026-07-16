import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildConcatManifest, buildSrtCaptions } from '../src/short-video-renderer';

test('short-video concat manifest gives every slide an equal duration and repeats the last frame', () => {
  const slides = ['slide_01.png', "slide_'02.png", 'slide_03.png'];
  const manifest = buildConcatManifest(slides, 4);
  assert.equal((manifest.match(/duration 4\.000/g) ?? []).length, 3);
  assert.equal((manifest.match(/^file /gm) ?? []).length, 4);
  assert.match(manifest, new RegExp(path.resolve('slide_03.png').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(manifest, /'\\''/);
});

test('short-video concat manifest rejects empty or non-positive inputs', () => {
  assert.throws(() => buildConcatManifest([], 4), /at least one slide/);
  assert.throws(() => buildConcatManifest(['slide.png'], 0), /must be positive/);
});

test('short-video captions cover the full duration in bounded readable chunks', () => {
  const srt = buildSrtCaptions('One two three four five six seven eight nine ten eleven twelve.', 8, 6);
  assert.match(srt, /00:00:00,000 --> 00:00:04,000/);
  assert.match(srt, /00:00:04,000 --> 00:00:08,000/);
  assert.equal((srt.match(/-->/g) ?? []).length, 2);
  assert.throws(() => buildSrtCaptions('', 8), /must not be empty/);
});
