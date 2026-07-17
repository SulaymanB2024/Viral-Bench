import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildCompetitorContentMap, renderCompetitorContentMapMarkdown } from '../src/competitor-content-map';

test('content map separates source items, semantic rows, ad concepts, heuristics, and normalized performance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-content-map-'));
  const dbPath = path.join(root, 'semantic.sqlite');
  const discoveryPath = path.join(root, 'discovery.json');
  const adsPath = path.join(root, 'ads.json');
  const adAnalysisPath = path.join(root, 'ad-analysis.json');
  const expansionPath = path.join(root, 'expansion.json');
  const resourcesPath = path.join(root, 'resources.json');
  const outJsonPath = path.join(root, 'out.json');
  const outMarkdownPath = path.join(root, 'out.md');
  execFileSync('sqlite3', [dbPath], {
    input: `
      CREATE TABLE social_accounts (evidence_id TEXT PRIMARY KEY, handle TEXT NOT NULL);
      CREATE TABLE social_posts (
        evidence_id TEXT PRIMARY KEY, platform TEXT NOT NULL, canonical_url TEXT NOT NULL,
        caption TEXT NOT NULL, posted_at TEXT, account_id TEXT NOT NULL
      );
      CREATE TABLE performance_observations (
        observation_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, captured_at TEXT NOT NULL,
        views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER
      );
      CREATE TABLE video_analyses (
        analysis_id TEXT PRIMARY KEY, video_asset_id TEXT NOT NULL, created_at TEXT NOT NULL,
        analysis_json TEXT
      );
      CREATE TABLE semantic_items (item_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, item_type TEXT NOT NULL);
      INSERT INTO social_accounts VALUES ('account:one', 'joinhandshake');
      INSERT INTO social_accounts VALUES ('account:two', 'ripplematch');
      INSERT INTO social_accounts VALUES ('account:three', 'careercreator');
      INSERT INTO social_posts VALUES ('post:one', 'tiktok', 'https://www.tiktok.com/@joinhandshake/video/10000000001', 'Internship applications are open', '2026-07-01T00:00:00.000Z', 'account:one');
      INSERT INTO social_posts VALUES ('post:two', 'instagram', 'https://www.instagram.com/reel/ABC123/', 'Resume proof before you apply', '2026-07-02T00:00:00.000Z', 'account:two');
      INSERT INTO social_posts VALUES ('post:three', 'youtube_shorts', 'https://www.youtube.com/shorts/ABC123', 'Interview warmup gives you options: how many golf balls fit in an airplane—maybe a million', '2026-07-03T00:00:00.000Z', 'account:three');
      INSERT INTO performance_observations VALUES ('observation:one', 'post:one', '2026-07-16T00:00:00.000Z', 100000, 1000, 20, 10, 5);
      INSERT INTO performance_observations VALUES ('observation:two', 'post:two', '2026-07-16T00:00:00.000Z', 500, 100, 10, 5, 20);
      INSERT INTO performance_observations VALUES ('observation:three', 'post:three', '2026-07-16T00:00:00.000Z', 2500, 200, 15, 8, 12);
      INSERT INTO semantic_items VALUES ('semantic:one', 'post:one', 'caption');
      INSERT INTO semantic_items VALUES ('semantic:two', 'post:one', 'hashtag');
      INSERT INTO semantic_items VALUES ('semantic:three', 'post:two', 'caption');
      INSERT INTO semantic_items VALUES ('semantic:four', 'post:three', 'caption');
    `,
  });
  fs.writeFileSync(discoveryPath, JSON.stringify({ items: [] }));
  fs.writeFileSync(adsPath, JSON.stringify({
    items: [
      { adArchiveID: '1', pageName: 'Handshake', isActive: true, publisherPlatform: ['INSTAGRAM'], snapshot: { body: { text: 'Same copy' }, title: 'Apply', caption: '', ctaText: 'Sign up', videos: [] } },
      { adArchiveID: '2', pageName: 'Handshake', isActive: true, publisherPlatform: ['INSTAGRAM'], snapshot: { body: { text: 'Same copy' }, title: 'Apply', caption: '', ctaText: 'Sign up', videos: [] } },
    ],
  }));
  fs.writeFileSync(adAnalysisPath, JSON.stringify({ items: [] }));
  fs.writeFileSync(expansionPath, JSON.stringify({
    batch_id: 'internship-us-content-expansion-test',
    ledger: { status: 'partially_ready', lanes: [{ measurement_gaps: ['provider gap'] }] },
    selection_summary: { unique_candidates: 10, selected: 8 },
    selection_shortfalls: ['selection gap'],
    audience_summary: { collected: 42, measurement_gaps: [] },
    semantic_summary: { newly_multimodally_analyzed_posts: 8 },
  }));
  fs.writeFileSync(resourcesPath, JSON.stringify({
    resources: [{
      resource_id: 'careeronestop-job-search',
      title: 'Job Search',
      publisher: 'CareerOneStop',
      url: 'https://www.careeronestop.org/JobSearch/job-search.aspx',
      source_class: 'job_search_guidance',
      authority: 'us_government',
      jurisdiction: 'US',
      semantic_topics: ['resume_and_application', 'interview'],
      audience_states: ['proof_gap'],
      series: ['Close the Proof Gap', 'Application Leak Check'],
      use_for: 'Ground resume, application, networking, and interview process guidance.',
      evidence_boundary: 'General guidance does not verify a specific employer or opportunity.',
      freshness_policy: 'stable_reference',
      verified_at: '2026-07-17T12:00:00.000Z',
    }],
  }));

  const map = buildCompetitorContentMap({
    dbPath,
    instagramDiscoveryPath: discoveryPath,
    metaAdsPath: adsPath,
    metaAdAnalysisPath: adAnalysisPath,
    researchExpansionPath: expansionPath,
    semanticResourceCatalogPath: resourcesPath,
    outJsonPath,
    outMarkdownPath,
  });

  assert.equal(map.schema_version, 4);
  assert.equal(map.coverage.videos_in_database, 3);
  assert.equal(map.coverage.semantic_items, 4);
  assert.deepEqual(map.coverage.semantic_item_composition, { caption: 3, hashtag: 1 });
  assert.equal(map.coverage.active_meta_ads_observed, 2);
  assert.equal(map.coverage.unique_meta_ad_concepts_observed, 1);
  assert.equal(map.taxonomy.method, 'heuristic_keyword_rules');
  assert.equal(map.taxonomy.observed_or_derived, 'derived');
  assert.deepEqual(map.taxonomy.audience_states, { interview_uncertain: 1, late_or_urgent: 1, proof_gap: 1 });
  assert.deepEqual(map.taxonomy.content_promises, { evidence_translation: 1, opportunity_discovery: 1, process_instruction: 1 });
  assert.equal(map.videos.find((video) => video.evidence_id === 'post:three')?.next_action, 'practice');
  assert.equal(map.videos.find((video) => video.evidence_id === 'post:three')?.proof_mode, 'none_observed');
  assert.equal(map.resource_catalog.resources.length, 1);
  assert.deepEqual(map.resource_catalog.by_source_class, { job_search_guidance: 1 });
  assert.equal(map.performance_comparison.raw_cross_platform_ranking_allowed, false);
  assert.equal(map.research_expansion.public_audience_signals, 42);
  assert.equal(map.research_expansion.selected_for_analysis, 8);
  assert.equal(map.research_expansion.newly_multimodally_analyzed, 8);
  assert.equal(map.recommended_series.length, 15);
  assert.deepEqual(map.recommended_series[0]?.resource_ids, ['careeronestop-job-search']);
  assert.ok(map.videos.every((video) => video.normalized_performance_score === 0.5));
  assert.ok(map.coverage_gaps.includes('provider gap'));

  const markdown = renderCompetitorContentMapMarkdown(map);
  assert.match(markdown, /## Video-by-video analysis/);
  assert.equal((markdown.match(/^#### Video \d+:/gm) ?? []).length, map.videos.length);
  assert.match(markdown, /Evidence state: metadata only; evidence ID `post:three`/);
  assert.match(markdown, /No timestamped creative-beat structure is available/);
  assert.match(markdown, /Craft read: pacing unavailable/);
  assert.match(markdown, /Primary-source anchors: \[Job Search\]/);
});
