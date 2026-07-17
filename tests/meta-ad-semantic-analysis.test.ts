import assert from 'node:assert/strict';
import test from 'node:test';

import { metaAdReportId } from '../src/meta-ad-semantic-analysis';

test('derives the semantic report id from the requested output artifact', () => {
  assert.equal(
    metaAdReportId('.semantic-artifacts/reports/internship-paid-meta-all-video-ads-semantic-20260717.json'),
    'internship-paid-meta-all-video-ads-semantic-20260717',
  );
  assert.equal(metaAdReportId('/tmp/meta-report'), 'meta-report');
});
