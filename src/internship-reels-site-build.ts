import * as path from 'node:path';

import { generateTwelveLabsDashboard } from './twelvelabs-visual-demo';

const repoRoot = path.resolve(__dirname, '..');
const siteRoot = path.join(repoRoot, 'internship-reels-site');

const result = generateTwelveLabsDashboard({
  outputPath: path.join(siteRoot, 'dashboard.html'),
  mediaOutputDir: path.join(siteRoot, 'media'),
  mediaPublicBase: '/media',
  preserveExistingMedia: true,
  siteNavigation: true,
});

process.stdout.write(`${JSON.stringify({
  ...result,
  site_root: path.relative(repoRoot, siteRoot),
}, null, 2)}\n`);
