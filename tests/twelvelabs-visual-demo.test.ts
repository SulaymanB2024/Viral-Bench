import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { classifyEnglishEvidence } from '../src/content-language';
import { generateTwelveLabsDashboard } from '../src/twelvelabs-visual-demo';

test('English evidence gate keeps spoken and text-led English videos', () => {
  const spoken = classifyEnglishEvidence(
    'The world will push you to choose a path after college, but what is the right choice?',
    'After graduation, some people choose industry and some choose more school.',
  );
  const textLed = classifyEnglishEvidence(
    'none',
    'Free services for fresh graduates: NBI Clearance, Barangay Clearance, Medical Certificate, Birth Certificate, Marriage Certificate, Transcript of Records, Tax Identification Number, and Unified Multi-Purpose ID Card. Note: Use the First Time Jobseeker Certificate only once.',
  );

  assert.equal(spoken.is_english, true);
  assert.equal(spoken.basis, 'spoken_and_on_screen');
  assert.equal(spoken.classification_version, 'english_evidence_v2');
  assert.equal(spoken.human_override, null);
  assert.ok(spoken.classification_confidence > 0.7);
  assert.equal(textLed.is_english, true);
  assert.equal(textLed.basis, 'on_screen');
});

test('English evidence gate excludes a mostly non-English video with isolated English terms', () => {
  const result = classifyEnglishEvidence(
    'none',
    'Ceritain dong pengalaman magang lo yang paling random, gue magang jadi social media specialist, ternyata kerjaannya jadi buzzer.',
  );

  assert.equal(result.is_english, false);
  assert.equal(result.basis, 'insufficient');
});

test('English evidence records an explicit human override without hiding automated evidence', () => {
  const result = classifyEnglishEvidence('none', 'Ceritain pengalaman magang', {
    is_english: true,
    reviewed_by: 'reviewer-1',
    reviewed_at: '2026-07-17T00:00:00.000Z',
    reason: 'Reviewed bilingual source context.',
  });

  assert.equal(result.is_english, true);
  assert.equal(result.basis, 'human_override');
  assert.equal(result.classification_confidence, 1);
  assert.equal(result.classification_version, 'english_evidence_v2');
  assert.equal(result.human_override?.reviewed_by, 'reviewer-1');
});

test('dashboard generator emits a live local snapshot shell without provider calls', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'twelvelabs-dashboard-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'dashboard.html');
  const mediaOutputDir = path.join(directory, 'media');

  const result = generateTwelveLabsDashboard({
    outputPath,
    mediaOutputDir,
    mediaPublicBase: '/media',
    siteNavigation: true,
  });
  const html = fs.readFileSync(outputPath, 'utf8');
  const dataScript = fs.readFileSync(path.join(directory, 'twelvelabs-dashboard-data.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(directory, 'twelvelabs-dashboard-manifest.json'),
    'utf8',
  )) as {
    dashboard_kind: string;
    owned_marketing_data_state: string;
    reconciliation: { failures: unknown[]; excluded_non_english: number };
    analysis_cache: {
      fingerprinted_records: number;
      legacy_unfingerprinted_records: number;
      reuse_policy: string;
    };
    media_assets: Array<{ output_path: string; output_sha256: string }>;
  };
  const mediaAssets = fs.readdirSync(mediaOutputDir);

  assert.ok(result.english_records >= 10);
  assert.ok(result.analyzed_records >= result.english_records);
  assert.equal(result.external_calls_made, 0);
  assert.match(html, /Competitor research/);
  assert.match(html, /Live snapshot/);
  assert.match(html, /Paid evidence/);
  assert.match(html, /id="searchInput"/);
  assert.match(html, /id="sortSelect"/);
  assert.match(html, /Views · high to low/);
  assert.match(html, /id="filterSummary"/);
  assert.match(html, /No matches/);
  assert.match(html, /#videoTableBody tr\[data-id\]/);
  assert.match(html, /id="visualStage"/);
  assert.match(html, /id="stageVideo"/);
  assert.match(html, /View evidence/);
  assert.match(html, /Selected video/);
  assert.match(html, /id="liveSemanticTime"/);
  assert.match(html, /id="semanticInference"/);
  assert.match(html, /id="semanticVisual"/);
  assert.match(html, /id="semanticAudio"/);
  assert.match(html, /id="semanticEditing"/);
  assert.match(html, /id="semanticWalkthrough"/);
  assert.match(html, /function renderLiveSemantic/);
  assert.match(html, /stageVideo\.addEventListener\('timeupdate'/);
  assert.match(html, /stageSourceChanged/);
  assert.match(html, /stageVideo\.getAttribute\('src'\) !== record\.media_src/);
  assert.match(html, /data-semantic-step/);
  assert.match(html, /visual_description/);
  assert.match(html, /speech_exact/);
  assert.match(html, /attention_device/);
  assert.match(html, /@media \(min-width: 901px\)/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) minmax\(330px, 380px\)/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) minmax\(520px, 560px\)/);
  assert.match(html, /\.visual-stage \{[\s\S]*?grid-column: 2;[\s\S]*?position: sticky;/);
  assert.match(html, /\.sources \{[\s\S]*?display: none;/);
  assert.match(html, /Research signals/);
  assert.ok(html.indexOf('id="visualStage"') < html.indexOf('id="researchSynthesis"'));
  assert.match(html, /Could overturn/);
  assert.match(html, /Leave-one-out tests direction, not causality or precision/);
  assert.match(html, /sensitivity\.direction_consistency/);
  assert.match(html, /platformSensitivity\.direction_consistency/);
  assert.match(html, /id="detailDialog"/);
  assert.equal((html.match(/<dialog\b/g) ?? []).length, 1);
  assert.match(html, /dialog\.showModal/);
  assert.match(html, /event\.target === dialog/);
  assert.match(html, /body\.classList\.add\('modal-open'\)/);
  assert.match(html, /lastDialogTrigger\.focus/);
  assert.match(html, /window\.setInterval/);
  assert.match(html, /30000/);
  assert.match(html, /Patterns require owned tests/);
  assert.match(html, /Void Agency brand palette/);
  assert.match(html, /--void-paper: #fcfcfc/);
  assert.match(html, /--void-sage: #8b9b87/);
  assert.match(html, /class="topbar site-header"/);
  assert.match(html, /src="\/site-navigation\.js"/);
  assert.match(html, /href="\/" data-site-route="library">Library/);
  assert.match(html, /href="\/benchmarks" data-site-route="benchmarks">Benchmarks/);
  assert.match(html, /href="\/ask" data-site-route="ask">Ask/);
  assert.match(html, /href="\/work" data-site-route="work">Work/);
  assert.doesNotMatch(html, /href="\/signals(?:\.html)?"/);
  assert.doesNotMatch(html, /href="\/library(?:\.html)?"/);
  assert.match(html, /"media_src":"\/media\//);
  assert.doesNotMatch(html, /#d6ff4b/);
  assert.equal(mediaAssets.length, result.english_records);
  assert.match(dataScript, /twelvelabs_dashboard_snapshot_v1/);
  assert.match(dataScript, /"dashboard_kind":"competitor_creative_research"/);
  assert.match(dataScript, /"owned_marketing_data_state":"not_connected"/);
  assert.match(dataScript, /proof_is_a_product_wedge_not_an_automatic_reach_mechanism/);
  assert.doesNotMatch(dataScript, /Ceritain/);
  assert.doesNotMatch(dataScript, /tlk_[A-Za-z0-9_-]+/);
  assert.equal(manifest.dashboard_kind, 'competitor_creative_research');
  assert.equal(manifest.owned_marketing_data_state, 'not_connected');
  assert.deepEqual(manifest.reconciliation.failures, []);
  assert.equal(manifest.reconciliation.excluded_non_english, result.excluded_non_english);
  assert.equal(
    manifest.analysis_cache.fingerprinted_records + manifest.analysis_cache.legacy_unfingerprinted_records,
    result.analyzed_records,
  );
  assert.equal(manifest.analysis_cache.reuse_policy, 'exact_fingerprint_and_quality_gate_required');
  assert.equal(manifest.media_assets.length, result.english_records);

  const firstMedia = path.join(directory, manifest.media_assets[0].output_path);
  fs.writeFileSync(firstMedia, 'stale-media');
  generateTwelveLabsDashboard({
    outputPath,
    mediaOutputDir,
    mediaPublicBase: '/media',
    preserveExistingMedia: true,
    siteNavigation: true,
  });
  assert.notEqual(fs.readFileSync(firstMedia, 'utf8'), 'stale-media');
});

test('dashboard generator fails closed when a deep-analysis row cannot join selection evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'twelvelabs-dashboard-join-'));
  const analysisDir = path.join(directory, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(path.join(analysisDir, 'missing-deep.json'), JSON.stringify({
    candidate_id: 'missing-selection',
    platform: 'tiktok',
    platform_post_id: 'missing-selection',
    cohort: { rank: 1, success_percentile: 1, complexity_score: 1 },
    quality: { passed: true },
    segmentation: { segments: {} },
  }));
  const mediaPath = path.join(directory, 'media.json');
  const selectionPath = path.join(directory, 'selection.json');
  const researchPath = path.join(directory, 'research.json');
  fs.writeFileSync(mediaPath, JSON.stringify({ rows: [] }));
  fs.writeFileSync(selectionPath, JSON.stringify({
    generated_at: '2026-07-17T00:00:00.000Z',
    entries: [],
  }));
  fs.writeFileSync(researchPath, JSON.stringify({ collection: { profiles: [] } }));

  assert.throws(() => generateTwelveLabsDashboard({
    analysisDir,
    outputPath: path.join(directory, 'dashboard.html'),
    mediaManifestPath: mediaPath,
    selectionLedgerPath: selectionPath,
    researchManifestPath: researchPath,
    researchExpansionPath: path.join(directory, 'missing-expansion.json'),
  }), /Dashboard reconciliation failed: missing-selection: selection ledger row missing/);
});
