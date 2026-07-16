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
  source_image_input_path: string | null;
  source_image_is_placeholder: boolean;
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
  const localSourceVisual = findLocalSourceVisual(job);
  const sourceImageIsPlaceholder = localSourceVisual === null;
  if (localSourceVisual) {
    await sharp(localSourceVisual.absolute_path)
      .rotate()
      .resize({ width: 1080, height: 1440, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 88 })
      .toFile(sourceImagePath);
  } else {
    await sharp(Buffer.from(renderSourcePlaceholderSvg(job))).jpeg({ quality: 88 }).toFile(sourceImagePath);
  }
  // librsvg can intermittently return incomplete JPEG tiles when a data URI is
  // embedded in a larger SVG. Normalize the source to PNG in memory so each
  // slide render is deterministic while preserving the legacy source artifact.
  const sourceImageBuffer = await sharp(sourceImagePath).png().toBuffer();
  const sourceImageDataUri = `data:image/png;base64,${sourceImageBuffer.toString('base64')}`;

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
    await sharp(Buffer.from(renderSlideSvg(job, slide, sourceImageDataUri, sourceImageIsPlaceholder))).png().toFile(slidePath);
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
    source_image_input_path: localSourceVisual?.manifest_path ?? null,
    source_image_is_placeholder: sourceImageIsPlaceholder,
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

export function renderSlideSvg(
  job: CreativeJobManifest,
  slide: CreativeJobManifest['output_requirements']['slides'][number],
  sourceImageDataUri: string,
  sourceImageIsPlaceholder: boolean,
): string {
  const { width, height } = job.output_requirements.dimensions;
  const colors = ['#16a085', '#f4c430', '#ef476f', '#118ab2', '#4f46e5'];
  const accent = colors[(slide.slide_number - 1) % colors.length];
  const nicheLines = wrapLines(job.niche.toUpperCase(), 52, 2);
  const titleLines = wrapLines(slide.on_screen_text, 21, 5);
  const titleFontSize = titleLines.length >= 4 ? 60 : 68;
  const titleLineHeight = titleFontSize + 16;
  const directionLines = wrapLines(slide.visual_direction, 36, 7);
  const visualLabel = sourceImageIsPlaceholder ? 'Visual placeholder' : 'Illustrative visual';
  const visualNote = sourceImageIsPlaceholder
    ? directionLines
    : ['Purpose-created brand visual; verify every factual claim.'];
  const showVisualProvenanceBlock = sourceImageIsPlaceholder
    || job.output_requirements.house_style?.system !== 'internships_signal_stack_v1';
  const proofOverlay = renderHouseStyleOverlay(
    slide,
    job.output_requirements.house_style,
    accent,
    sourceImageIsPlaceholder,
  );
  const stylePromise = job.output_requirements.house_style?.promise
    ?? 'Check: model • condition • comps • repair risk';
  const footerNote = job.output_requirements.house_style?.footer_note
    ?? (job.output_requirements.house_style?.system === 'worthscan_proof_first_v1'
      ? 'Estimates guide a decision, not a guaranteed appraisal.'
      : 'Review the source and claims before posting.');
  const brandName = job.brand?.display_name
    ?? (job.job_id.startsWith('worthscan_') ? 'WorthScan' : 'Viral Bench');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#15171c"/>
  <rect x="54" y="66" width="${width - 108}" height="${height - 132}" fill="#f7f3e9"/>
  <rect x="54" y="66" width="${width - 108}" height="22" fill="${accent}"/>
  ${nicheLines.map((line, index) => (
    `<text x="94" y="${148 + index * 30}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#15171c">${escapeXml(line)}</text>`
  )).join('\n  ')}
  ${titleLines.map((line, index) => (
    `<text x="94" y="${265 + index * titleLineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${titleFontSize}" font-weight="800" fill="#15171c">${escapeXml(line)}</text>`
  )).join('\n  ')}
  <clipPath id="visual-${slide.slide_number}"><rect x="94" y="640" width="${width - 188}" height="640" rx="0"/></clipPath>
  <image x="94" y="640" width="${width - 188}" height="640" preserveAspectRatio="xMidYMid slice" clip-path="url(#visual-${slide.slide_number})" href="${sourceImageDataUri}"/>
  <rect x="94" y="640" width="${width - 188}" height="640" fill="#15171c" opacity="${sourceImageIsPlaceholder ? '0' : '0.16'}" stroke="#d8d2c3" stroke-width="4"/>
  ${proofOverlay}
  ${showVisualProvenanceBlock ? `
  <rect x="94" y="${sourceImageIsPlaceholder ? 640 : 1104}" width="${width - 188}" height="${sourceImageIsPlaceholder ? 640 : 176}" fill="${sourceImageIsPlaceholder ? '#ffffff' : '#15171c'}" opacity="${sourceImageIsPlaceholder ? '0.94' : '0.82'}"/>
  <text x="132" y="${sourceImageIsPlaceholder ? 728 : 1162}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="${sourceImageIsPlaceholder ? '#15171c' : '#ffffff'}">${escapeXml(visualLabel)}</text>
  ${visualNote.map((line, index) => (
    `<text x="132" y="${sourceImageIsPlaceholder ? 806 + index * 56 : 1222 + index * 42}" font-family="Arial, Helvetica, sans-serif" font-size="${sourceImageIsPlaceholder ? 40 : 30}" fill="${sourceImageIsPlaceholder ? '#272a31' : '#ffffff'}">${escapeXml(line)}</text>`
  )).join('\n  ')}` : ''}
  ${sourceImageIsPlaceholder ? `
  <rect x="94" y="1390" width="${width - 188}" height="240" fill="${accent}" opacity="0.18"/>
  <text x="132" y="1472" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#15171c">Operator review required</text>
  <text x="132" y="1534" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#15171c">Replace placeholder visuals with approved item photos.</text>` : `
  <rect x="94" y="1390" width="${width - 188}" height="160" fill="${accent}" opacity="0.15"/>
  <text x="132" y="1460" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#15171c">${escapeXml(stylePromise)}</text>
  <text x="132" y="1520" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#15171c">${escapeXml(footerNote)}</text>`}
  <text x="94" y="1740" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#4b505a">${escapeXml(brandName)}</text>
  <text x="${width - 130}" y="1740" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="800" fill="#15171c">${slide.slide_number}/${job.output_requirements.slide_count}</text>
</svg>`;
}

function renderHouseStyleOverlay(
  slide: CreativeJobManifest['output_requirements']['slides'][number],
  houseStyle: CreativeJobManifest['output_requirements']['house_style'],
  accent: string,
  sourceImageIsPlaceholder: boolean,
): string {
  if (sourceImageIsPlaceholder || !slide.visual_mode || !slide.proof_cues?.length) return '';
  const cues = slide.proof_cues;
  const panelX = 118;
  const panelY = 824;
  const panelWidth = 844;
  const panelHeight = 246;
  const labels = houseStyle?.overlay_labels ?? {
    hero: 'PROOF-FIRST CHECK',
    checklist: 'VERIFY THE VISIBLE PROOF',
    comparison: 'COMPARE LIKE WITH LIKE',
    uncertainty: 'PRICE THE UNKNOWN — DO NOT INVENT IT',
    decision: 'RANGE + CONFIDENCE = DECISION',
    uncertainty_badge: 'VERIFY',
  };
  const base = [
    `<g data-proof-mode="${slide.visual_mode}">`,
    `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="24" fill="#15171c" opacity="0.88"/>`,
  ];

  if (slide.visual_mode === 'hero') {
    base.push(`<text x="152" y="884" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(labels.hero)}</text>`);
    const gap = 14;
    const chipWidth = (panelWidth - 68 - gap * (cues.length - 1)) / cues.length;
    cues.forEach((cue, index) => {
      const x = panelX + 34 + index * (chipWidth + gap);
      base.push(`<rect x="${x}" y="918" width="${chipWidth}" height="112" rx="18" fill="${accent}"/>`);
      base.push(`<text x="${x + chipWidth / 2}" y="960" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="900" fill="#15171c">${index + 1}</text>`);
      base.push(`<text x="${x + chipWidth / 2}" y="1002" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="800" fill="#15171c">${escapeXml(cue.toUpperCase())}</text>`);
    });
  } else if (slide.visual_mode === 'checklist') {
    base.push(`<text x="152" y="876" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(labels.checklist)}</text>`);
    const gap = 16;
    const chipWidth = (panelWidth - 68 - gap) / 2;
    cues.slice(0, 4).forEach((cue, index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const x = panelX + 34 + column * (chipWidth + gap);
      const y = 908 + row * 70;
      base.push(`<rect x="${x}" y="${y}" width="${chipWidth}" height="54" rx="14" fill="#ffffff" opacity="0.96"/>`);
      base.push(`<circle cx="${x + 30}" cy="${y + 27}" r="12" fill="none" stroke="${accent}" stroke-width="6"/>`);
      base.push(`<text x="${x + 56}" y="${y + 36}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#15171c">${escapeXml(cue.toUpperCase())}</text>`);
    });
  } else if (slide.visual_mode === 'comparison') {
    base.push(`<text x="152" y="876" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(labels.comparison)}</text>`);
    const gap = 16;
    const cardWidth = (panelWidth - 68 - gap * (cues.length - 1)) / cues.length;
    cues.forEach((cue, index) => {
      const x = panelX + 34 + index * (cardWidth + gap);
      base.push(`<rect x="${x}" y="910" width="${cardWidth}" height="126" rx="18" fill="#ffffff" opacity="0.96"/>`);
      base.push(`<text x="${x + cardWidth / 2}" y="958" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="${accent}">${String(index + 1).padStart(2, '0')}</text>`);
      base.push(`<text x="${x + cardWidth / 2}" y="1004" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="800" fill="#15171c">${escapeXml(cue.toUpperCase())}</text>`);
    });
  } else if (slide.visual_mode === 'uncertainty') {
    base.push(`<text x="152" y="876" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(labels.uncertainty)}</text>`);
    const gap = 12;
    const chipWidth = (panelWidth - 68 - gap * (cues.length - 1)) / cues.length;
    cues.forEach((cue, index) => {
      const x = panelX + 34 + index * (chipWidth + gap);
      base.push(`<rect x="${x}" y="920" width="${chipWidth}" height="102" rx="18" fill="#ffffff" stroke="${accent}" stroke-width="5" opacity="0.98"/>`);
      base.push(`<text x="${x + chipWidth / 2}" y="965" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#15171c">${escapeXml(cue.toUpperCase())}</text>`);
      base.push(`<text x="${x + chipWidth / 2}" y="1002" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#15171c">${escapeXml(labels.uncertainty_badge)}</text>`);
    });
  } else {
    base.push(`<text x="152" y="876" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(labels.decision)}</text>`);
    const gap = 18;
    const chipWidth = (panelWidth - 68 - gap * (cues.length - 1)) / cues.length;
    cues.forEach((cue, index) => {
      const x = panelX + 34 + index * (chipWidth + gap);
      base.push(`<rect x="${x}" y="920" width="${chipWidth}" height="102" rx="51" fill="#ffffff" stroke="${accent}" stroke-width="6" opacity="0.98"/>`);
      base.push(`<text x="${x + chipWidth / 2}" y="983" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#15171c">${escapeXml(cue.toUpperCase())}</text>`);
    });
  }

  base.push('</g>');
  return base.join('\n  ');
}

function findLocalSourceVisual(job: CreativeJobManifest): { absolute_path: string; manifest_path: string } | null {
  const rootDir = path.resolve(process.cwd());
  const imageExtensions = new Set(['.avif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

  for (const input of job.source_inputs) {
    if (input.kind !== 'local_file' || !input.path || !imageExtensions.has(path.extname(input.path).toLowerCase())) {
      continue;
    }
    const absolutePath = path.resolve(rootDir, input.path);
    const relativePath = path.relative(rootDir, absolutePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue;
    }
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return { absolute_path: absolutePath, manifest_path: input.path };
    }
  }

  return null;
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
    '- [ ] Source content contains no private personal data, contact details, or credentials.',
    '- [ ] Trend examples are cited observations or bounded provider results with provenance.',
    '- [ ] Caption, hashtags, and spoken script match the approved job manifest.',
    '- [ ] Slides use approved visuals and contain no unsupported outcome or value claims.',
    '- [ ] No account creation, login, CAPTCHA, phone verification, or posting was automated.',
    '- [ ] Human reviewer completed approval.md before any posted ledger move.',
    '',
    '## Job Notes',
    ...job.qa_notes.map((note) => `- ${note}`),
    '- Local renderer output is not approved for posting by default.',
    '- Check every slide for factual and outcome claims before publishing.',
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
    'Replace this placeholder with human-approved source material when the job requires it.',
    'Do not include private contact details, account credentials, private messages, or verification material.',
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
    `Create 9:16 short-form visuals for ${job.niche}. Use only owned, licensed, purpose-created, or operator-approved source material. Keep the visual language native to the selected platform and brand. Do not render text inside the image; text overlay is handled by the local renderer.`,
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
  <text x="130" y="435" font-family="Arial, Helvetica, sans-serif" font-size="38" fill="#272a31">Replace with approved source or purpose-created media.</text>
  <text x="130" y="520" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#4b505a">No credentials, private messages, or personal data.</text>
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
