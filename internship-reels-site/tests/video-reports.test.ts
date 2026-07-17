import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVideoEvidence,
  parseVideoRecordsFromIndex,
  storedVideoReport,
  validateVideoReportOutput,
  videoReportContentHash,
  videoReportPrompt,
} from '../lib/video-reports.js';

const fixture = {
  candidate_id: 'video:1',
  platform: 'instagram',
  source_group: 'competitor_product',
  chosen_pillar: 'student_problem',
  duration_sec: 12,
  posted_at: '2026-07-01T00:00:00.000Z',
  metric_snapshot_at: '2026-07-17T00:00:00.000Z',
  cohort: {
    success_percentile: 0.91,
  },
  metrics: {
    views: 1_000,
    likes: 50,
    comments: 4,
  },
  strategy: {
    data: {
      opening: {
        start_sec: 0,
        end_sec: 2,
        mechanism: 'Benefit-first text overlay.',
        observed_visual: 'A student points toward a checklist.',
        observed_words: 'A source phrase that should never become reusable campaign copy for any future operator.',
      },
      content_arc: {
        audience_problem: 'Students are unsure where to begin.',
        progression: 'A short checklist moves from preparation to action.',
        payoff: 'The final frame names one next step.',
      },
      cta: {
        requested_action: 'Save the checklist for later.',
      },
      claims: [{
        observed_claim: 'The checklist takes ten minutes.',
        evidence_status: 'visible',
      }],
      evidence_limitations: [
        'The clip does not verify whether viewers completed the checklist.',
      ],
    },
  },
  segmentation: {
    segments: {
      visual_shots: [{
        start_time: 0,
        end_time: 4,
        metadata: {
          visual_description: 'The speaker introduces a three-step checklist.',
          camera_and_motion: 'Static medium shot.',
        },
      }],
      audio_beats: [{
        start_time: 0,
        end_time: 4,
        metadata: {
          delivery: 'Measured direct address.',
        },
      }],
      editing_beats: [{
        start_time: 0,
        end_time: 4,
        metadata: {
          attention_device: 'Numbered text reveal.',
        },
      }],
    },
  },
};

function validOutput() {
  return {
    summary: 'A checklist format may make an uncertain starting point feel more concrete while preserving a single next action.',
    audience_read: 'The framing appears suited to students who want a bounded first step rather than a comprehensive job-search system.',
    findings: [
      {
        title: 'Immediate problem framing',
        analysis: 'The opening pairs a student context with a visible checklist, which may clarify the topic before the sequence begins.',
        evidence_ids: ['opening:0', 'visual:0'],
      },
      {
        title: 'Bounded progression',
        analysis: 'The reviewed arc moves from uncertainty through a short sequence to one next step, suggesting a manageable information load.',
        evidence_ids: ['arc:0', 'editing:0'],
      },
      {
        title: 'Save-oriented close',
        analysis: 'The retained CTA asks for a save rather than an outcome claim, making it suitable for a controlled utility test.',
        evidence_ids: ['cta:0'],
      },
    ],
    tests: [
      {
        hypothesis: 'A numbered three-step opening may improve early comprehension for first-time internship seekers.',
        adaptation: 'Create an original Internships.com checklist with new wording and measure it against a single-tip control.',
        success_metric: '3-second hold rate',
        evidence_ids: ['opening:0', 'editing:0'],
      },
      {
        hypothesis: 'A save-oriented close may signal utility without promising an application result.',
        adaptation: 'Compare a save CTA with a neutral learn-more CTA while keeping the body identical.',
        success_metric: 'Save rate',
        evidence_ids: ['cta:0', 'arc:0'],
      },
    ],
    risks: ['Do not repeat the source checklist wording or imply that the process guarantees a response.'],
    limitations: ['The reviewed clip does not establish whether the format changed viewer behavior.'],
  };
}

test('parses only the per-video records assignment', () => {
  const source = [
    '<script>',
    '    const records = [{"candidate_id":"video:1"}];',
    '    const laneSpecs = [];',
    '</script>',
  ].join('\n');
  assert.deepEqual(parseVideoRecordsFromIndex(source), [{ candidate_id: 'video:1' }]);
});

test('builds deterministic, bounded evidence and content hashes', () => {
  const evidence = buildVideoEvidence(fixture);
  assert.ok(evidence.some((item) => item.evidence_id === 'visual:0' && item.start_sec === 0));
  assert.ok(evidence.some((item) => item.evidence_id === 'metrics:0'));
  assert.ok(videoReportPrompt(fixture, evidence).length < 42_000);
  assert.equal(videoReportContentHash(fixture), videoReportContentHash(structuredClone(fixture)));
  const changed = structuredClone(fixture);
  changed.metrics.views += 1;
  assert.notEqual(videoReportContentHash(fixture), videoReportContentHash(changed));
});

test('accepts a citation-complete observational report and redacts contacts', () => {
  const output = validOutput();
  output.risks.push('Escalate questions to analyst@example.com before publishing.');
  const validated = validateVideoReportOutput(output, buildVideoEvidence(fixture));
  assert.equal(validated.findings.length, 3);
  assert.equal(validated.tests.length, 2);
  assert.match(validated.risks.at(-1) ?? '', /\[email redacted\]/);
});

test('keeps opaque numeric post identifiers while redacting prose contacts', () => {
  const numericIdFixture = {
    ...fixture,
    candidate_id: 'live:tiktok:7138472018504076586:reviewed',
  };
  const evidence = buildVideoEvidence(numericIdFixture);
  const validated = validateVideoReportOutput(validOutput(), evidence);
  const stored = storedVideoReport(numericIdFixture, validated, evidence, '2026-07-17T00:00:00.000Z');
  assert.equal(stored.candidate_id, numericIdFixture.candidate_id);
});

test('rejects unknown evidence IDs and unsupported causal language', () => {
  const evidence = buildVideoEvidence(fixture);
  const unknown = validOutput();
  unknown.findings[0]!.evidence_ids = ['visual:99'];
  assert.throws(
    () => validateVideoReportOutput(unknown, evidence),
    /unknown evidence ID/,
  );

  const causal = validOutput();
  causal.summary = 'The checklist caused the clip to perform well.';
  assert.throws(
    () => validateVideoReportOutput(causal, evidence),
    /unsupported causal language/,
  );

  const deterministic = validOutput();
  deterministic.tests[0]!.hypothesis = 'A numbered opening will increase retention versus the control.';
  assert.throws(
    () => validateVideoReportOutput(deterministic, evidence),
    /deterministic test outcome/,
  );

  const attributed = validOutput();
  attributed.summary = 'The format achieved high engagement through a numbered checklist.';
  assert.throws(
    () => validateVideoReportOutput(attributed, evidence),
    /mixes performance outcomes/,
  );

  const outcomeInFinding = validOutput();
  outcomeInFinding.findings[1]!.analysis = 'The numbered sequence is consistent with high viewer retention.';
  assert.throws(
    () => validateVideoReportOutput(outcomeInFinding, evidence),
    /mixes performance outcomes/,
  );

  const viewerBehavior = validOutput();
  viewerBehavior.findings[1]!.analysis = 'The numbered sequence may assist in maintaining viewer focus.';
  assert.throws(
    () => validateVideoReportOutput(viewerBehavior, evidence),
    /unsupported viewer behavior/,
  );
});

test('rejects long reusable source phrasing', () => {
  const copied = validOutput();
  copied.summary = 'A source phrase that should never become reusable campaign copy for any future operator appears exactly as written.';
  assert.throws(
    () => validateVideoReportOutput(copied, buildVideoEvidence(fixture)),
    /reuses a long source phrase/,
  );
});
