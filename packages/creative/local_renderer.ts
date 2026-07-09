import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

import {
  type CreativeJobManifest,
  type GeneratedAsset,
  validateCreativeJobManifest,
} from './job_schema';

export interface LocalRenderResult {
  job_id: string;
  output_dir: string;
  slide_paths: string[];
  source_image_path: string;
  listing_path: string;
  trend_examples_path: string;
  research_notes_path: string;
  gemini_image_prompt_path: string;
  openai_image_prompt_path: string;
  caption_prompt_path: string;
  caption_path: string;
  hashtags_path: string;
  spoken_script_path: string;
  posting_notes_path: string;
  qa_checklist_path: string;
  approval_path: string;
  rendered_manifest_path: string;
}

export async function renderLocalPostPackage(
  input: CreativeJobManifest | unknown,
  outDir?: string,
): Promise<LocalRenderResult> {
  const job = validateCreativeJobManifest(input);
  const packageDir = outDir ?? path.join(process.cwd(), '.ops', 'creative_jobs', 'rendered', job.job_id);
  resetDirectory(packageDir);
  const sourceDir = path.join(packageDir, 'source');
  const researchDir = path.join(packageDir, 'research');
  const promptsDir = path.join(packageDir, 'prompts');
  const outputDir = path.join(packageDir, 'output');
  const qaDir = path.join(packageDir, 'qa');
  for (const dir of [sourceDir, researchDir, promptsDir, outputDir, qaDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const createdAt = new Date().toISOString();
  const generatedAssets: GeneratedAsset[] = [];
  const slidePaths: string[] = [];

  const sourceImagePath = path.join(sourceDir, 'bike_001.jpg');
  await sharp(Buffer.from(renderSourcePlaceholderSvg(job))).jpeg({ quality: 88 }).toFile(sourceImagePath);

  const listingPath = path.join(sourceDir, 'listing.txt');
  fs.writeFileSync(listingPath, renderListingSource(job));

  const trendExamplesPath = path.join(researchDir, 'trend_examples.json');
  fs.writeFileSync(trendExamplesPath, `${JSON.stringify(job.trend_examples, null, 2)}\n`);

  const researchNotesPath = path.join(researchDir, 'notes.md');
  fs.writeFileSync(researchNotesPath, renderResearchNotes(job));

  const geminiImagePromptPath = path.join(promptsDir, 'gemini_image_prompt.md');
  fs.writeFileSync(geminiImagePromptPath, renderImagePrompt(job, 'Gemini image'));

  const openaiImagePromptPath = path.join(promptsDir, 'openai_image_prompt.md');
  fs.writeFileSync(openaiImagePromptPath, renderImagePrompt(job, 'OpenAI image'));

  const captionPromptPath = path.join(promptsDir, 'caption_prompt.md');
  fs.writeFileSync(captionPromptPath, renderCaptionPrompt(job));

  for (const slide of job.output_requirements.slides) {
    const slidePath = path.join(outputDir, `slide_${String(slide.slide_number).padStart(2, '0')}.png`);
    await sharp(Buffer.from(renderSlideSvg(job, slide))).png().toFile(slidePath);
    slidePaths.push(slidePath);
    generatedAssets.push(assetFor(job, 'slide', slidePath, createdAt, `Slide ${slide.slide_number}`));
  }

  const captionPath = path.join(outputDir, 'caption.txt');
  fs.writeFileSync(captionPath, job.output_requirements.caption);
  generatedAssets.push(assetFor(job, 'caption', captionPath, createdAt));

  const hashtagsPath = path.join(outputDir, 'hashtags.txt');
  fs.writeFileSync(hashtagsPath, job.output_requirements.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '));
  generatedAssets.push(assetFor(job, 'hashtags', hashtagsPath, createdAt));

  const spokenScriptPath = path.join(outputDir, 'spoken_script.txt');
  fs.writeFileSync(spokenScriptPath, job.output_requirements.spoken_script);
  generatedAssets.push(assetFor(job, 'spoken_script', spokenScriptPath, createdAt));

  const postingNotesPath = path.join(outputDir, 'posting_notes.md');
  fs.writeFileSync(postingNotesPath, renderPostingNotes(job));
  generatedAssets.push(assetFor(job, 'posting_notes', postingNotesPath, createdAt));

  const qaChecklistPath = path.join(qaDir, 'checklist.md');
  fs.writeFileSync(qaChecklistPath, renderQaChecklist(job));
  generatedAssets.push(assetFor(job, 'qa', qaChecklistPath, createdAt, 'QA checklist'));

  const approvalPath = path.join(qaDir, 'approval.md');
  fs.writeFileSync(approvalPath, renderApprovalRecord(job));
  generatedAssets.push(assetFor(job, 'qa', approvalPath, createdAt, 'Human approval record'));

  const renderedManifest: CreativeJobManifest = {
    ...job,
    generated_assets: [
      ...job.generated_assets,
      ...generatedAssets,
    ],
    qa_notes: [
      ...job.qa_notes,
      `Rendered locally at ${createdAt}; generated assets remain unapproved for posting.`,
    ],
  };
  const renderedManifestPath = path.join(packageDir, 'manifest.json');
  fs.writeFileSync(renderedManifestPath, `${JSON.stringify(renderedManifest, null, 2)}\n`);

  return {
    job_id: job.job_id,
    output_dir: packageDir,
    slide_paths: slidePaths,
    source_image_path: sourceImagePath,
    listing_path: listingPath,
    trend_examples_path: trendExamplesPath,
    research_notes_path: researchNotesPath,
    gemini_image_prompt_path: geminiImagePromptPath,
    openai_image_prompt_path: openaiImagePromptPath,
    caption_prompt_path: captionPromptPath,
    caption_path: captionPath,
    hashtags_path: hashtagsPath,
    spoken_script_path: spokenScriptPath,
    posting_notes_path: postingNotesPath,
    qa_checklist_path: qaChecklistPath,
    approval_path: approvalPath,
    rendered_manifest_path: renderedManifestPath,
  };
}

function assetFor(
  job: CreativeJobManifest,
  kind: GeneratedAsset['kind'],
  filePath: string,
  createdAt: string,
  notes?: string,
): GeneratedAsset {
  return {
    provider: 'local_renderer',
    kind,
    path: path.relative(process.cwd(), filePath),
    sha256: sha256File(filePath),
    created_at: createdAt,
    approved_for_posting: false,
    notes,
  };
}

function renderSlideSvg(
  job: CreativeJobManifest,
  slide: CreativeJobManifest['output_requirements']['slides'][number],
): string {
  const { width, height } = job.output_requirements.dimensions;
  const colors = ['#16a085', '#f4c430', '#ef476f', '#118ab2', '#4f46e5'];
  const accent = colors[(slide.slide_number - 1) % colors.length];
  const titleLines = wrapLines(slide.on_screen_text, 24, 4);
  const directionLines = wrapLines(slide.visual_direction, 36, 7);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#15171c"/>
  <rect x="54" y="66" width="${width - 108}" height="${height - 132}" fill="#f7f3e9"/>
  <rect x="54" y="66" width="${width - 108}" height="22" fill="${accent}"/>
  <text x="94" y="154" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#15171c">${escapeXml(job.niche.toUpperCase())}</text>
  ${titleLines.map((line, index) => (
    `<text x="94" y="${275 + index * 86}" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" fill="#15171c">${escapeXml(line)}</text>`
  )).join('\n  ')}
  <rect x="94" y="640" width="${width - 188}" height="640" fill="#ffffff" stroke="#d8d2c3" stroke-width="4"/>
  <text x="132" y="728" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#15171c">Visual placeholder</text>
  ${directionLines.map((line, index) => (
    `<text x="132" y="${806 + index * 56}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#272a31">${escapeXml(line)}</text>`
  )).join('\n  ')}
  <rect x="94" y="1390" width="${width - 188}" height="240" fill="${accent}" opacity="0.18"/>
  <text x="132" y="1472" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#15171c">Operator review required</text>
  <text x="132" y="1534" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#15171c">Replace placeholder visuals with approved item photos.</text>
  <text x="94" y="1740" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#4b505a">Job: ${escapeXml(job.job_id)}</text>
  <text x="${width - 180}" y="1740" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" fill="#15171c">${slide.slide_number}/${job.output_requirements.slide_count}</text>
</svg>`;
}

function renderPostingNotes(job: CreativeJobManifest): string {
  return [
    `# Posting Notes: ${job.job_id}`,
    '',
    `Niche: ${job.niche}`,
    `Content type: ${job.content_type}`,
    `Platforms: ${job.platform_targets.join(', ')}`,
    '',
    '## Caption',
    job.output_requirements.caption,
    '',
    '## Hashtags',
    job.output_requirements.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '),
    '',
    '## Spoken Script',
    job.output_requirements.spoken_script,
    '',
    '## Operator Notes',
    ...job.output_requirements.posting_notes.map((note) => `- ${note}`),
    '',
    '## Trend Examples',
    ...job.trend_examples.map((example) => `- ${example.id}: ${example.hook} (${example.source_name})`),
    '',
    '## Hard Gates',
    '- Do not auto-post.',
    '- Do not automate account creation, login, CAPTCHA, phone verification, or terms gates.',
    '- Move to posted only after human approval and manual posting confirmation.',
    '',
  ].join('\n');
}

function renderQaChecklist(job: CreativeJobManifest): string {
  return [
    `# QA Checklist: ${job.job_id}`,
    '',
    '- [ ] Source image is operator-approved and contains no private account data.',
    '- [ ] Listing text contains no seller contact details or credentials.',
    '- [ ] Trend examples are manually recorded observations, not scraped data.',
    '- [ ] Caption, hashtags, and spoken script match the approved job manifest.',
    '- [ ] Slides use approved visuals and do not claim a guaranteed appraisal.',
    '- [ ] No account creation, login, CAPTCHA, phone verification, or posting was automated.',
    '- [ ] Human reviewer completed approval.md before any posted ledger move.',
    '',
    '## Job Notes',
    ...job.qa_notes.map((note) => `- ${note}`),
    '- Local renderer output is not approved for posting by default.',
    '- Check every slide for factual valuation claims before publishing.',
    '',
  ].join('\n');
}

function renderApprovalRecord(job: CreativeJobManifest): string {
  return [
    `# Approval: ${job.job_id}`,
    '',
    'Status: not approved',
    'Human reviewer: TBD',
    'Reviewed at: TBD',
    '',
    'Nothing moves to posted/ until a human approves.',
    '',
    '## Required Human Signoff',
    '',
    '- [ ] Slides approved',
    '- [ ] Caption approved',
    '- [ ] Hashtags approved',
    '- [ ] Posting notes approved',
    '- [ ] Account owner confirms manual posting boundary',
    '',
  ].join('\n');
}

function renderListingSource(job: CreativeJobManifest): string {
  return [
    `Job: ${job.job_id}`,
    `Niche: ${job.niche}`,
    `Content type: ${job.content_type}`,
    '',
    'Source inputs:',
    ...job.source_inputs.map((input) => `- ${input.label}: ${input.value ?? input.path ?? input.url ?? input.notes ?? ''}`),
    '',
    'Replace this placeholder with the human-approved marketplace listing text.',
    'Do not include seller contact details, account credentials, private messages, or phone verification material.',
    '',
  ].join('\n');
}

function renderResearchNotes(job: CreativeJobManifest): string {
  return [
    `# Research Notes: ${job.job_id}`,
    '',
    'Use manually recorded observations only. Do not scrape, bypass login gates, or automate Creative Center.',
    '',
    '## Trend Examples',
    ...job.trend_examples.map((example) => `- ${example.id}: ${example.hook} (${example.platform}, ${example.format})`),
    '',
  ].join('\n');
}

function renderImagePrompt(job: CreativeJobManifest, providerLabel: string): string {
  return [
    `# ${providerLabel} Prompt: ${job.job_id}`,
    '',
    'Gate: do not run paid generation unless ALLOW_PAID_GENERATION=true and this job explicitly approves the provider.',
    '',
    `Create 9:16 short-form visuals for ${job.niche}. Use real, operator-approved item photos or listing screenshots as references. Keep the look native, phone-camera, and resale-marketplace oriented. Do not render text inside the image; text overlay is handled by the local renderer.`,
    '',
    '## Slide Directions',
    ...job.output_requirements.slides.map((slide) => `${slide.slide_number}. ${slide.visual_direction}`),
    '',
  ].join('\n');
}

function renderCaptionPrompt(job: CreativeJobManifest): string {
  return [
    `# Caption Prompt: ${job.job_id}`,
    '',
    'Gate: local drafting only unless an approved external provider is explicitly enabled.',
    '',
    `Draft captions for ${job.platform_targets.join(', ')} using this content type: ${job.content_type}.`,
    '',
    'Required caption:',
    job.output_requirements.caption,
    '',
    'Required hashtags:',
    job.output_requirements.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '),
    '',
  ].join('\n');
}

function renderSourcePlaceholderSvg(job: CreativeJobManifest): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <rect width="1080" height="1440" fill="#e8e2d2"/>
  <rect x="80" y="96" width="920" height="1248" fill="#f8f5ef" stroke="#c9c0ae" stroke-width="6"/>
  <text x="130" y="230" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" fill="#15171c">SOURCE PLACEHOLDER</text>
  <text x="130" y="335" font-family="Arial, Helvetica, sans-serif" font-size="42" fill="#272a31">Job: ${escapeXml(job.job_id)}</text>
  <text x="130" y="435" font-family="Arial, Helvetica, sans-serif" font-size="38" fill="#272a31">Replace with an approved bike or scooter photo.</text>
  <text x="130" y="520" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#4b505a">No credentials, private messages, or seller contact details.</text>
</svg>`;
}

function resetDirectory(dirPath: string): void {
  const resolved = path.resolve(dirPath);
  if (resolved === path.parse(resolved).root) {
    throw new Error('Refusing to render into filesystem root.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  return [
    ...lines.slice(0, maxLines - 1),
    `${lines.slice(maxLines - 1).join(' ').slice(0, maxChars - 1)}...`,
  ];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
