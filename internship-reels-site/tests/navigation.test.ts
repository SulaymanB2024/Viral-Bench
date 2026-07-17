import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const primaryRoutes = ['/', '/benchmarks', '/ask', '/work'];
const pages = [
  'index.html',
  'benchmarks.html',
  'ask.html',
  'work.html',
  'analysis.html',
  'dashboard.html',
  'queue.html',
  'operator.html',
  'ads.html',
];

function readSiteFile(relativePath: string): string {
  return fs.readFileSync(path.join(siteRoot, relativePath), 'utf8');
}

test('every rendered page uses the shared four-destination navigation contract', () => {
  for (const page of pages) {
    const html = readSiteFile(page);
    const navigation = html.match(/<nav class="site-navigation"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(navigation, `${page} should render the shared primary navigation`);
    const routes = [...navigation.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(routes, primaryRoutes, `${page} should use the canonical navigation routes`);
    assert.match(html, /src="\/site-navigation\.js"/, `${page} should load shared navigation behavior`);
    assert.match(html, /class="site-skip"/, `${page} should expose a skip link`);
    assert.match(html, /id="main"/, `${page} should expose the skip-link target`);
  }
});

test('shared navigation behavior owns active state and accessible mobile menu controls', () => {
  const script = readSiteFile('site-navigation.js');
  assert.match(script, /workRoutes = new Set\(\['\/work', '\/analysis', '\/dashboard', '\/queue', '\/operator', '\/signals', '\/ads'\]\)/);
  assert.match(script, /setAttribute\('aria-current', 'page'\)/);
  assert.match(script, /setAttribute\('aria-expanded'/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /restoreFocus: true/);

  const styles = readSiteFile('styles.css');
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('library exposes primary filters before results and keeps advanced controls collapsible', () => {
  const html = readSiteFile('index.html');
  assert.ok(html.indexOf('id="searchInput"') < html.indexOf('id="libraryList"'));
  assert.ok(html.indexOf('data-platform="all"') < html.indexOf('id="libraryList"'));
  assert.match(html, /<details class="library-advanced">[\s\S]*?<summary>More filters<\/summary>/);
  assert.match(html, /id="resetFilters"/);
  assert.match(html, /<dialog class="library-dialog" id="libraryDialog"/);
});

test('work hub and permanent redirects preserve the public route contract', () => {
  const work = readSiteFile('work.html');
  for (const route of ['/analysis', '/dashboard', '/queue', '/operator']) {
    assert.match(work, new RegExp(`href="${route}"`));
  }
  assert.match(work, /Inspect one reviewed video in detail/);
  assert.match(work, /Compare winners and research signals/);
  assert.match(work, /Review unreviewed candidates/);
  assert.match(work, /Operator[\s\S]*?Private/);

  const config = JSON.parse(readSiteFile('vercel.json')) as {
    redirects?: Array<{ source: string; destination: string; permanent: boolean }>;
  };
  assert.deepEqual(config.redirects, [
    { source: '/library', destination: '/', permanent: true },
    { source: '/signals', destination: '/dashboard', permanent: true },
  ]);
});
