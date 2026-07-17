import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSpendScenarios,
  estimateProductionEnvelope,
  observedActiveDays,
  perceivedValueScore,
} from '../src/internship-paid-ad-site-build';

test('spend scenarios remain explicit functions of active days and daily assumptions', () => {
  assert.equal(observedActiveDays('2026-07-08T07:00:00.000Z', '2026-07-17T19:32:42.514Z'), 10);
  assert.deepEqual(buildSpendScenarios(10), {
    lean: { daily_budget_usd: 25, cumulative_usd: 250 },
    working: { daily_budget_usd: 100, cumulative_usd: 1_000 },
    scaled: { daily_budget_usd: 500, cumulative_usd: 5_000 },
  });
});

test('production planning distinguishes static, lean video, and produced montage work', () => {
  assert.deepEqual(estimateProductionEnvelope('image'), {
    kind: 'Static social creative',
    low_usd: 50,
    high_usd: 500,
    basis: 'Template or light art direction.',
  });
  assert.equal(
    estimateProductionEnvelope('video', ['Direct-to-camera', 'Screen recording']).kind,
    'Lean creator or product demo',
  );
  assert.equal(
    estimateProductionEnvelope('video', ['Fast-paced montage', 'Testimonials']).kind,
    'Produced brand montage',
  );
});

test('perceived value is bounded and rewards a specific, evidenced offer', () => {
  const thin = perceivedValueScore({
    body: '{{product.brand}}',
    title: '{{product.name}}',
    cta: '',
    linkUrl: '',
    format: 'dco',
    analysisCta: '',
    analysisStyles: [],
    visibleProofCount: 0,
    claimCount: 0,
    creativeBeatCount: 0,
    websiteProofCount: 0,
    websiteCtaCount: 0,
  });
  const strong = perceivedValueScore({
    body: 'Promote your job for $34/day and reach qualified candidates faster.',
    title: 'Reach 25M ready-to-work candidates',
    cta: 'Learn more',
    linkUrl: 'https://example.com/hire',
    format: 'video',
    analysisCta: 'Promote your job now',
    analysisStyles: ['Screen recording', 'Text-based'],
    visibleProofCount: 3,
    claimCount: 2,
    creativeBeatCount: 4,
    websiteProofCount: 4,
    websiteCtaCount: 2,
  });
  assert.ok(thin.total >= 0 && thin.total <= 100);
  assert.ok(strong.total >= 0 && strong.total <= 100);
  assert.ok(strong.total > thin.total);
});
