/**
 * standalone-marketing-agent.ts — SELF-CONTAINED handoff version of benchmark-marketing-agents.
 *
 * Node built-ins (fs, path, http, crypto) + global fetch (Node 18+) + `sharp` (npm, for downscaling
 * reference images). It makes its own OpenRouter + Lightreel + Doublespeed + ScrapeCreators calls.
 *
 * WHAT IT DOES: an agentic loop (wiht the selected model) that researches what's breaking out in fitness
 * short-form, generates imagery (image-to-image off REAL reference slides for a native look),
 * composes a text-on-slide TikTok carousel, SEES its own output, iterates, and saves a reviewable
 * Doublespeed slideshow draft (+ review link). Mirrors the in-repo two-player benchmark, single account.
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────────
 * Node 18+, tsx (`npm i -g tsx` or `npx tsx`), and `npm i sharp`.
 * Env vars (export, or `tsx --env-file=.env`):
 *   OPENROUTER_API_KEY        — main agent
 *   LIGHTREEL_API_KEY         — public Lightreel API key (lr_live_...)
 *   SCRAPE_CREATORS_API_KEY   — view_media (TikTok/IG URLs → images) + sound extraction
 *   LIGHTREEL_API_URL         — optional, defaults to https://api.lightreel.ai/v1/chat
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────────
 *   1) One-time Doublespeed sign-in (opens your browser):  npx tsx standalone-marketing-agent.ts auth
 *      → writes .doublespeed-tokens.json next to this file (refresh token ~90d, auto-renews).
 *   2) Run the agent:                                      npx tsx standalone-marketing-agent.ts
 *      → prints a Doublespeed review link for the draft it builds.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import sharp from 'sharp';

// ─── env ───────────────────────────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const LIGHTREEL_API_KEY = process.env.LIGHTREEL_API_KEY || '';
const LIGHTREEL_API_URL = process.env.LIGHTREEL_API_URL || 'https://api.lightreel.ai/v1/chat';
const SCRAPE_CREATORS_API_KEY = process.env.SCRAPE_CREATORS_API_KEY || '';

// Token + local run/notes files live next to THIS script, so it's portable — drop the file anywhere.
const TOKEN_FILE = path.join(__dirname, '.doublespeed-tokens.json');
const SNAPSHOT_FILE = path.join(__dirname, '.marketing-agent-runs.json');

// ════════════════════════════════════════════════════════════════════════════════
// CONFIG (edit freely)
// ════════════════════════════════════════════════════════════════════════════════
const MODEL = 'anthropic/claude-opus-4.8'; // vision-capable — needed so the agent can see images
const REASONING_EFFORT: 'low' | 'medium' | 'high' = 'medium';
const MAX_ROUNDS = 18;
const MAX_LIGHTREEL_CALLS = 6;            // research calls per run (1 per round); RESETS each run
const IMAGE_MODEL_OVERRIDE: 'nano-banana' | 'flux-dev' | null = 'nano-banana'; // forced; agent doesn't pick
const MAX_VIEW_IMAGES_PER_POST = 10;      // slides shown per viewed carousel
const MAX_VIEW_IMAGES_TOTAL = 12;         // per-round ceiling on reference images
const VISION_MAX_EDGE = 1536;             // downscale fed images ≤ this (keeps under the 2000px many-image cap)
const NOTES_TO_LOAD = 10;                 // past run notes loaded back in (run-over-run memory)

// Doublespeed targets (product + the single TikTok account this agent runs).
const DS_PRODUCT_ID = '';
const DS_ACCOUNT_USERNAME = '';
const DS_ACCOUNT_ID = '';

// false → publish leaves a DRAFT + review link. true → also queue_post it (status 'scheduled').
const AUTO_QUEUE = false;

const POSTS_PER_ACCOUNT = 1;
const ACCOUNTS = [{ id: DS_ACCOUNT_ID, username: DS_ACCOUNT_USERNAME }];

const GOAL =
  `These TikTok accounts are already WARMED UP and established broadly in the FITNESS space. ` +
  `Your ONE and ONLY goal is to get AS MANY VIEWS AS POSSIBLE. Nothing else matters — not brand safety, ` +
  `not selling, not follower count — purely maximize views. THIS RUN you must queue exactly ONE post for EACH ` +
  `of your accounts (so ${POSTS_PER_ACCOUNT} per account). ` +
  `Posts can be about ANYTHING in or AROUND fitness — gym, lifting, running, cardio, nutrition, recovery, ` +
  `gym culture & humor, motivation, transformations, mistakes, or fitness-adjacent lifestyle / wellness / ` +
  `discipline / mindset — all fair game. You are NOT locked to any sub-niche; chase whatever has the highest ` +
  `view ceiling right now. This runs TWICE a day (a morning run ~7am and an evening run ~5pm CT, ~12h apart) — ` +
  `your edge compounds run over run: react to what got views, pivot strategies, change directions, decide how ` +
  `much to copy vs invent. It's all up to you.`;

function buildSystem(): string {
  const accountLines = ACCOUNTS
    .map(a => `    • @${a.username}`)
    .join('\n');
  return `You are an elite short-form content strategist running ${ACCOUNTS.length} warmed-up, general-fitness TikTok accounts. You operate in rounds: each round you either call tools or give your final answer. Reply ONLY with JSON, no prose outside it.

OBJECTIVE: ${GOAL}

YOUR ACCOUNTS (each @handle is ONLY the identifier you pass to publish_slideshow — nothing more):
${accountLines}
  - The handle is a meaningless placeholder. IGNORE the username entirely — it does NOT influence what you post. Don't read anything into it. Each account is just a slot to queue a high-view fitness post to.
  - Queue exactly ${POSTS_PER_ACCOUNT} post for EACH account; the posts can use totally different angles.
  - You are encouraged to use seperate thesis for each account, althoguh if you decide both accounts can post similar style stuff. This is up to you.

HOW TO WIN
Views come from: (1) a scroll-stopping first slide (hook + visual), (2) an angle ACTUALLY trending right now (verified, not your guess), (3) a payoff that makes people save/share/comment. You do not invent angles from your own priors — you mine what's already breaking out, understand the pattern, then execute it better. You are TERRIBLE at understanding culture, hooks, scripts, and trends — DO NOT rely on your training data; lean HEAVILY on call_lightreel_api. Your creativity is in how you use the tools, react to your stats, and decide what to post. Make content that looks native and intentional — NOT obviously AI-generated.
This goes for the EXACT WORDS, not just the idea. DO NOT freestyle your hooks, slide text, or captions from your own head — it comes out generic and AI-sounding. Every line should be lifted or closely adapted from REAL winning posts (get the actual copy from call_lightreel_api + view_media), and you should run your draft copy past Lightreel for a rewrite before publishing. Your job is to assemble and adapt proven copy — not to write fresh copy.

STUDY MANY FULL POSTS, NOT JUST WORDS. Getting the wording right is only half of it — the nuance of a post is in its STRUCTURE. Before you design, build a rich library in your context: pull MANY real winning carousels and look at ALL their slides — view their every slide via view_media (you can see up to 10 slides per post). When in doubt, mirror a specific real post's slide-by-slide structure.

WHERE YOUR CREATIVITY GOES — AND WHERE IT DOESN'T
LIMIT your creativity on the CRAFT. Do NOT invent hooks, scripts, slide copy, captions, or framing — you are bad at all of it. Rely on Lightreel for full scripts and slide-by-slide breakdowns, and on real popular slideshows (via view_media) to understand framing, pacing, and the emotions they pull. Copy and adapt what already works; don't try to be original with the words or structure.
SPEND your creativity on the STRATEGY instead: what direction to take each account, what to post, what to research next, when to double down on a winner versus hold a direction on conviction, when to pivot, how to read your stats. THAT judgment is your edge — the wording and format are not.
If you DO decide to invent your own script, push into a new direction, or poke into an untried area — fine, but don't do it blind: ask Lightreel for context on it first, or pass it your full slide-by-slide draft for feedback grounded in real culture. What you ultimately do with what Lightreel returns is up to you.

HOW SOCIAL MEDIA ACTUALLY WORKS — read your results like an operator, not a one-shot poster
- Distribution is NOISY. A genuinely good post can flop by pure chance, and the algorithm often needs several REPS of the same format before it catches. One flop does NOT mean the format is dead — perseverance on a sound format is frequently what breaks it through.
- Watch ENGAGEMENT RATE, not just raw views — likes/saves/comments relative to views.
- It is YOUR conviction call when to persevere on a format, when to tweak wording/framing, when to test a slightly different angle, and when to pivot entirely — weighing your stats, the account's trajectory, and what's happening in the culture. Think like a real person running this account day to day, building it over time — not someone firing off one disconnected post.

PROMPTING FOR IMAGES — it's a skill you build over time
- Image prompting is advanced. The best prompts are DETAILED and DESCRIPTIVE — spell out the subject, setting, lighting, mood, camera/lens feel, and what's in frame and where. Vague prompts give generic, AI-looking results.
- Ground your image STYLE in your research: study the images on successful posts (view_media), describe what makes them feel real and native, and prompt toward THAT look — don't invent a style from scratch.
- The most reliable way to hit a specific look is ITERATIVE image-to-image off a REAL reference (a real photo from view_media, or a prior good generation) — nudge it toward the target across attempts instead of one-shotting from text.
- Over time you'll learn which subjects, styles, and prompt patterns render realistically vs. read as AI. Track what works in your notes and lean into it — your prompting should get better day over day.

YOUR CURRENT ACCOUNT STATS ARE ALREADY GIVEN TO YOU below (in the opening message): your recent posts and their real view / like / comment / share / save counts. Study them FIRST — see what landed and what flopped — and let them steer your strategy. (Early on they may be empty — nothing posted yet.)
- The stats are just numbers; each past post also carries its real URL. You can call view_media on your own old posts to pull their exact slide-by-slide structure back into context.

YOU HAVE FIVE TOOLS.

1) call_lightreel_api — your research brain.
An EXTREMELY INTELLIGENT research agent over a massive, continuously-scraped database of TikTok & Instagram UGC (videos, creators, hooks, captions, view/engagement data). It does real semantic search + live lookups and answers grounded in actual videos. Ask rich, specific, layered questions.
  - HARD LIMITS: at most ONE call_lightreel_api PER ROUND, budget of ~${MAX_LIGHTREEL_CALLS} for the whole run. This budget RESETS every run — you get a fresh ${MAX_LIGHTREEL_CALLS} each time, so don't carry a "calls left" count into your note. Each call is slow/expensive — make each count: one big high-leverage question, stack multiple response_fields.
  - By DEFAULT you get prose. For structured data, pass response_fields: a flat list of UP TO 5 fields, each { "name","type":"string"|"array","description" }. Lowercase names. You can INDEX/ALIGN parallel arrays (say so in descriptions).
  - To get real links you MUST ask for them AND give them a field: say "include the real TikTok URL for each example" and add an "example_urls" array field.
  - You are making PHOTO SLIDESHOWS / CAROUSELS, so at some point ASK for real PHOTO/CAROUSEL posts (not videos) with URLs, so you can view_media them and study actual slides. Make at least one research call aimed at surfacing real carousel post URLs.
  - GET THE ACTUAL WORDS, not just the hook: ask for the FULL slide-by-slide text of 2-3 winning carousels (every slide, verbatim) plus their caption patterns — so you model your copy on real wording instead of inventing it.
  - USE IT AS YOUR EDITOR before publishing: send your draft hooks + slide-by-slide copy + caption back to Lightreel and ask it to rate and rewrite them to sound native (call it out as YOUR draft to fix). Do this every run, for both posts.
  - Example: {"call_lightreel_api":{"question":"What fitness/gym PHOTO CAROUSEL posts are breaking out on TikTok in the last 2-3 weeks? For each give the slide-1 hook, why it works, and the real TikTok URL.","response_fields":[{"name":"hooks","type":"array","description":"6 verbatim slide-1 hooks, strongest first"},{"name":"why_it_works","type":"array","description":"mechanism behind hooks[i], same order"},{"name":"example_urls","type":"array","description":"real carousel URL for hooks[i], same order; empty if none"}]}}

2) view_media — SEE the real content behind a TikTok/Instagram URL.
Pass URLs the research returns here to turn them into actual images you can look at. PHOTO/CAROUSEL posts return ALL their slides (the gold — slide-1 design, text placement, flow); VIDEO posts return only a cover frame. Prioritize viewing real carousels before you design yours. Actually READ every slide — the exact on-slide wording, the order, the caption — and reuse/adapt that real copy. Don't just absorb the vibe.
  - Shape: {"view_media":{"urls":["https://www.tiktok.com/@x/photo/123"]}}
  - Images SHOWN TO YOU next round — up to ~10 slides PER post, so you see the FULL carousel (slide by slide), not just a cover. EACH slide is tagged with a label like T1, T2, T3 (shown right above its image). To base a generation on one of these real winning slides, pass that label as "reference" in generate_image — you never need the URL.

3) generate_image — make an image (Doublespeed, 1080×1920). Text-to-image AND image-to-image.
  - Shape: {"generate_image":{"prompt":"...","reference":"<optional LABEL of an image to base this on, e.g. T3 or G1>"}}
  - LABELS: every slide you view_media is tagged T1, T2, T3…; every image you generate is tagged G1, G2…. To do image-to-image, pass that label as "reference" — you do NOT pass a URL, just the label (the system holds the real image). Labels last the WHOLE run: you can reference any label you've ever been shown, even one that has scrolled out of view. Labels are per-run; you can't reference T#/G# from a previous run.
  - Returns a new image (with its own G# label), SHOWN TO YOU next round. Be critical: real & native, or does it scream AI (waxy skin, mangled hands/text, uncanny faces)? If AI, regenerate, or refine by referencing it again.
  - reference = IMAGE-TO-IMAGE (keeps the referenced image, applies your prompt as an edit). Use it for: (a) CROSS-SLIDE CONSISTENCY — generate slide 1, then reference its G# on the rest so the same person/scene/style holds across slides; (b) SEED OFF A REAL WINNER — reference a real slide's T# to make your image in the style/composition of an actual winning post; (c) iterate on your own image by referencing its G#.
  - PEOPLE NEED A REAL REFERENCE: any image with a visible person must be image-to-image off a real person reference — reference a real person slide's T# (from view_media), then carry that across slides via its G#. Plain text-to-image people look fake/AI. Faceless/object/food/scene images can be plain text-to-image.
  - If a T# reference has text baked on it, tell the prompt to leave the text out — your overlay adds the words.
  - Prompt for REALISM: candid iPhone/amateur photo, real gym, natural lighting, grain — not glossy render. Keep the text area calm. Don't ask it to render real text (it garbles it) — text comes from the overlay.

4) preview_slideshow — compose + render the slides so YOU CAN SEE the finished post.
  - Shape: {"preview_slideshow":{"slides":[{"image_url":"...","text":"on-slide line","text_position":"top|middle|bottom","style_preset":"<preset name>"}, ...]}}
  - image_url MUST be an image you generated (a generate_image output URL) — never a TikTok/research page URL, which renders blank. If generate_image is failing/unavailable, do NOT publish blank slides: skip that post and explain in your note.
  - text_position (optional, default "bottom") moves the text box top/middle/bottom per slide.
  - style_preset (optional but USE IT) picks the on-slide TEXT STYLE from Doublespeed's canonical presets — font, color, background, stroke, all handled for you. Available: ${presetSummaryForPrompt()}. Pick the one that matches the native look of the real winners you studied (e.g. the white-pill "tiktok-bg" reads on any image). Default if omitted: tiktok-bg.
  - Returns rendered preview PNGs, SHOWN TO YOU. VERIFY slide 1 stops the scroll, text is readable, flow makes you swipe. Fix weak slides and re-preview. Do NOT skip this.
  - ONE DISTINCT IMAGE PER SLIDE: never reuse the identical image_url on more than one slide (looks lazy). Cohesive set, but each image visually distinct (UNLESS it is part of the format to have the same image in multiple slides)

5) publish_slideshow — queue the final post to ONE of your accounts (+ review link).
  - Shape: {"publish_slideshow":{"account":"<one of your @handles, without the @>","slides":[{"image_url":"...","text":"...","text_position":"top|middle|bottom","style_preset":"<preset name>"}, ...],"caption":"full caption with hashtags","sound_from_post":"<optional: a TikTok POST url whose audio to use>"}}
  - sound_from_post (OPTIONAL but recommended): pass a TikTok POST url — we extract its sound and attach it, so your slideshow rides a real/trending audio (which matters a lot for slideshow reach). Use a sound from a winning post in the same lane (you already have these URLs from your research/view_media). Best-effort: if extraction fails the post still publishes, just without music.
  - Assigns + ${AUTO_QUEUE ? 'QUEUES (schedules)' : 'drafts'} the slideshow to that account. You may publish at most ${POSTS_PER_ACCOUNT} per account per run. Only publish after previewing.

PROTOCOL
- To act:   {"actions":[ {"generate_image":{...}}, {"generate_image":{...}} ]}  (one or more; run in parallel)
- To finish:{"answer":"<2-4 sentence summary of what you posted to each account and why>","note":"<=300 words: a REFLECTION of your thinking THIS run — what you posted, your reasoning, and what you observed or learned. NOT a plan for next time: do not prescribe next steps or write conditionals ('do X next', 'if this then that'). Just capture your current thought process clearly. Don't reference T#/G# labels — your future self won't have them. These notes are the ONLY thing preserved between runs.>"}
- You have ${MAX_ROUNDS} rounds. Arc: study your injected account stats → research → view_media real winners → design + generate (look critically) → preview (verify) → refine → publish to BOTH accounts → finish with answer + note. Bias toward research + iteration; don't ship mediocre work.`;
}

// ════════════════════════════════════════════════════════════════════════════════
// OpenRouter (main agent LLM) — minimal inline client
// ════════════════════════════════════════════════════════════════════════════════
async function openRouterChat(messages: any[], model: string, opts: { cache_control?: any; max_tokens?: number; reasoning?: any }): Promise<any> {
  const body: Record<string, any> = {
    model, messages, stream: false, usage: { include: true }, plugins: [{ id: 'response-healing' }],
    ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
    ...(opts.cache_control ? { cache_control: opts.cache_control } : {}),
    ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
  const json: any = await res.json();
  if (json?.error) throw new Error(`OpenRouter error: ${json.error.message || JSON.stringify(json.error)}`);
  return json;
}

async function chatWithRetry(messages: any[], model: string, opts: { cache_control?: any; max_tokens?: number; reasoning?: any }, label: string): Promise<any> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await openRouterChat(messages, model, opts);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const backoffMs = 2000 * attempt;
      console.warn(`[${label}] model call failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err instanceof Error ? err.message : err} — retrying in ${backoffMs}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// ════════════════════════════════════════════════════════════════════════════════
// Lightreel research — PUBLIC HTTP API
// ════════════════════════════════════════════════════════════════════════════════
async function callLightreelApi(params: { question?: string; response_fields?: { name: string; type: string; description?: string }[] }): Promise<any> {
  const question = typeof params.question === 'string' ? params.question.trim() : '';
  if (!question) return { error: 'call_lightreel_api needs a non-empty "question".' };
  if (!LIGHTREEL_API_KEY) return { error: 'LIGHTREEL_API_KEY not set.' };

  let response_fields: Record<string, any> | undefined;
  if (Array.isArray(params.response_fields)) {
    const valid = params.response_fields.filter(f => f && typeof f.name === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(f.name)).slice(0, 5);
    if (valid.length) {
      response_fields = {};
      for (const f of valid) response_fields[f.name] = { type: f.type === 'array' ? 'array' : 'string', ...(typeof f.description === 'string' ? { description: f.description.slice(0, 500) } : {}) };
    }
  }
  try {
    const res = await fetch(LIGHTREEL_API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${LIGHTREEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question, ...(response_fields ? { response_fields } : {}) }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) return { error: `lightreel call failed: ${String(json?.error?.message || `HTTP ${res.status}`).slice(0, 300)}` };
    return { answer: json.answer };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'lightreel call failed' };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// view_media + sound extraction (ScrapeCreators) + image downscaling (sharp)
// ════════════════════════════════════════════════════════════════════════════════
interface ViewedMedia { url: string; images: string[]; kind: 'photo' | 'video' | 'unknown'; error?: string; }

function pickImg(list: any): string | null {
  if (!Array.isArray(list)) return null;
  return list.find((u: string) => typeof u === 'string' && /\.(jpe?g|webp|png)/i.test(u)) || list[0] || null;
}

async function scGet(pathname: string, urlParam: string, trim: boolean): Promise<any> {
  const u = new URL(`https://api.scrapecreators.com${pathname}`);
  u.searchParams.set('url', urlParam);
  u.searchParams.set('trim', String(trim));
  const res = await fetch(u, { headers: { 'x-api-key': SCRAPE_CREATORS_API_KEY } });
  if (!res.ok) throw new Error(`ScrapeCreators ${res.status}`);
  return res.json();
}

async function viewOne(url: string): Promise<ViewedMedia> {
  if (!SCRAPE_CREATORS_API_KEY) return { url, images: [], kind: 'unknown', error: 'SCRAPE_CREATORS_API_KEY not set' };
  try {
    if (url.includes('tiktok.com')) {
      const data = (await scGet('/v2/tiktok/video', url, false))?.aweme_detail;
      if (!data) return { url, images: [], kind: 'unknown', error: 'could not fetch TikTok' };
      if (data.image_post_info?.images?.length) {
        const imgs = data.image_post_info.images.map((img: any) => pickImg(img?.display_image?.url_list || img?.thumb_url_list)).filter(Boolean) as string[];
        return { url, images: imgs, kind: 'photo' };
      }
      const cover = pickImg(data.video?.cover?.url_list) || pickImg(data.video?.origin_cover?.url_list) || pickImg(data.video?.dynamic_cover?.url_list);
      return { url, images: cover ? [cover] : [], kind: 'video' };
    }
    if (url.includes('instagram.com')) {
      const raw = await scGet('/v1/instagram/post', url, true);
      const data = raw?.xdt_shortcode_media || raw?.data?.xdt_shortcode_media;
      if (!data) return { url, images: [], kind: 'unknown', error: 'could not fetch Instagram' };
      const nodes = [...(data.edge_sidecar_to_children?.edges || []).map((e: any) => e?.node).filter(Boolean), ...(data.carousel_media || [])];
      const images = (nodes.length
        ? nodes.map((n: any) => n?.display_url || n?.image_versions2?.candidates?.[0]?.url || n?.thumbnail_src || null)
        : [data.display_url || data.image_versions2?.candidates?.[0]?.url || data.thumbnail_src || null]).filter(Boolean) as string[];
      return { url, images, kind: data.video_url ? 'video' : 'photo' };
    }
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return { url, images: [url], kind: 'photo' };
    return { url, images: [], kind: 'unknown', error: 'unsupported URL — pass a TikTok/Instagram video or post URL' };
  } catch (e: any) {
    return { url, images: [], kind: 'unknown', error: e?.message?.slice(0, 160) || 'scrape failed' };
  }
}

async function viewMedia(urls: string[]): Promise<ViewedMedia[]> {
  const clean = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 8);
  if (!clean.length) return [];
  return Promise.all(clean.map(viewOne));
}

/** Fetch an image URL → downscaled JPEG data URI (≤ maxEdge, EXIF-rotated, no upscale), or null. */
async function resizeToDataUri(url: string, maxEdge = VISION_MAX_EDGE): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const out = await sharp(buf).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch { return null; }
}

/** Given a TikTok POST url, build the music share link for its sound (Doublespeed resolves it server-side). */
async function musicLinkFromPost(postUrl: string): Promise<{ music_link: string; title: string } | { error: string }> {
  if (!SCRAPE_CREATORS_API_KEY) return { error: 'SCRAPE_CREATORS_API_KEY not set' };
  if (typeof postUrl !== 'string' || !postUrl.includes('tiktok.com')) return { error: 'pass a TikTok post URL (music extraction is TikTok-only)' };
  try {
    const m = (await scGet('/v2/tiktok/video', postUrl, false))?.aweme_detail?.music;
    if (!m?.id_str) return { error: 'no sound found on that post' };
    const slug = String(m.title || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sound';
    return { music_link: `https://www.tiktok.com/music/${slug}-${m.id_str}`, title: String(m.title || '').slice(0, 80) };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 160) || 'music scrape failed' };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Doublespeed — OAuth token store (local file) + MCP-over-HTTP client
// ════════════════════════════════════════════════════════════════════════════════
const DS_MCP_URL = 'https://app.doublespeed.ai/api/mcp';
const DS_AUTHORIZATION_ENDPOINT = 'https://app.doublespeed.ai/oauth/authorize';
const DS_TOKEN_ENDPOINT = 'https://app.doublespeed.ai/api/oauth/token';
const DS_REGISTRATION_ENDPOINT = 'https://app.doublespeed.ai/api/oauth/register';
const MCP_PROTOCOL_VERSION = '2025-06-18';

interface DoublespeedIntegration { provider: 'doublespeed'; clientId: string; refreshToken: string; accessToken?: string | null; accessTokenExpiresAt?: number | null; updatedAt: string; }

function loadIntegration(): DoublespeedIntegration | null {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveIntegration(patch: Partial<DoublespeedIntegration> & { clientId?: string; refreshToken?: string }): void {
  const current = loadIntegration() || ({} as DoublespeedIntegration);
  const next: DoublespeedIntegration = { ...current, ...patch, provider: 'doublespeed', updatedAt: new Date().toISOString() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

async function refreshAccessToken(integration: DoublespeedIntegration): Promise<string> {
  const res = await fetch(DS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: integration.refreshToken, client_id: integration.clientId, resource: DS_MCP_URL }),
  });
  if (!res.ok) throw new Error(`Doublespeed token refresh failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}. Re-run this file with "auth".`);
  const json: any = await res.json();
  if (!json.access_token) throw new Error('Doublespeed token refresh returned no access_token.');
  const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 23 * 60 * 60 * 1000;
  saveIntegration({ accessToken: json.access_token, accessTokenExpiresAt: expiresAt, ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}) });
  return json.access_token;
}

async function getAccessToken(): Promise<string> {
  const integration = loadIntegration();
  if (!integration?.refreshToken || !integration.clientId) throw new Error('Doublespeed is not connected yet. Run this file with "auth" once to sign in.');
  const skewMs = 5 * 60 * 1000;
  if (integration.accessToken && integration.accessTokenExpiresAt && integration.accessTokenExpiresAt - skewMs > Date.now()) return integration.accessToken;
  return refreshAccessToken(integration);
}

function parseMcpBody(contentType: string | null, body: string): any {
  if (contentType && contentType.includes('text/event-stream')) {
    let last: any = null;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { const obj = JSON.parse(payload); if (obj && (obj.result !== undefined || obj.error !== undefined || obj.id !== undefined)) last = obj; } catch { /* keepalive */ }
    }
    if (last) return last;
    throw new Error(`MCP SSE response had no JSON-RPC payload: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

let nextRpcId = 1;

class DoublespeedMcp {
  private sessionId: string | null = null;
  private accessToken: string | null = null;

  private async rpc(method: string, params: any, opts: { notification?: boolean } = {}): Promise<any> {
    if (!this.accessToken) this.accessToken = await getAccessToken();
    const id = opts.notification ? undefined : nextRpcId++;
    const payload: any = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    if (id !== undefined) payload.id = id;
    const headers: Record<string, string> = { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_PROTOCOL_VERSION };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await fetch(DS_MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (res.status === 401 && !opts.notification) { this.accessToken = await getAccessToken(); return this.rpc(method, params, opts); }
    if (opts.notification) {
      if (!res.ok && res.status !== 202) throw new Error(`MCP notification ${method} failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${method} failed (${res.status}): ${text.slice(0, 300)}`);
    const env = parseMcpBody(res.headers.get('content-type'), text);
    if (env?.error) throw new Error(`MCP ${method} error ${env.error.code}: ${env.error.message}`);
    return env?.result;
  }
  async connect(): Promise<void> {
    await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'standalone-marketing-agent', version: '2.0.0' } });
    await this.rpc('notifications/initialized', undefined, { notification: true });
  }
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: any }>> { return (await this.rpc('tools/list', {}))?.tools ?? []; }
  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(`Doublespeed tool ${name} failed: ${String(Array.isArray(result.content) ? result.content.map((c: any) => c?.text ?? '').join('\n') : 'tool error').slice(0, 400)}`);
    if (result?.structuredContent !== undefined) return result.structuredContent;
    if (Array.isArray(result?.content)) { const text = result.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n'); try { return JSON.parse(text); } catch { return text; } }
    return result;
  }
}

async function getDoublespeedClient(): Promise<DoublespeedMcp> { const mcp = new DoublespeedMcp(); await mcp.connect(); return mcp; }

// ════════════════════════════════════════════════════════════════════════════════
// Slideshow ops — text-style presets + scene builder + generate/preview/publish + guardrail
// ════════════════════════════════════════════════════════════════════════════════
const IMG_W = 1080;
const IMG_H = 1920;

interface Slide { image_url: string; text?: string | null; text_position?: 'top' | 'middle' | 'bottom'; style_preset?: string; }

const TEXT_Y: Record<'top' | 'middle' | 'bottom', number> = { top: 200, middle: 730, bottom: 1320 };

const DEFAULT_STYLE_PRESET = 'tiktok-bg';
const FALLBACK_TEXT_STYLE = { color: '#ffffff', padding: 20, fontSize: 60, textAlign: 'center', fontFamily: 'TikTok Display', fontWeight: 500, lineHeight: 1.2, letterSpacing: 0, backgroundShape: 'rectangle' };
const ALLOWED_PRESETS: Record<string, string> = {
  'tiktok-bg': 'a white background pill behind the text (text sits on a solid white box)',
  'tiktok-stroke': 'the default TikTok font in white with a black stroke/outline, no background',
};
let STYLE_PRESETS: Array<{ name: string; description: string; style: any }> = [];

async function loadStylePresets(mcp: DoublespeedMcp): Promise<void> {
  try {
    const r: any = await mcp.callTool('list_style_presets', {});
    if (Array.isArray(r?.presets)) STYLE_PRESETS = r.presets.filter((p: any) => p?.name in ALLOWED_PRESETS).map((p: any) => ({ ...p, description: ALLOWED_PRESETS[p.name] }));
  } catch { /* leave empty → FALLBACK_TEXT_STYLE */ }
}
function presetSummaryForPrompt(): string {
  if (!STYLE_PRESETS.length) return '(presets unavailable this run)';
  return STYLE_PRESETS.map(p => `"${p.name}" — ${p.description}`).join('; ');
}
function resolvePresetStyle(name?: string): any {
  const found = STYLE_PRESETS.find(p => p.name === name) || STYLE_PRESETS.find(p => p.name === DEFAULT_STYLE_PRESET);
  return found ? { ...found.style, verticalAlign: 'middle' } : FALLBACK_TEXT_STYLE;
}

// A slide image MUST be a real image (a generate_image output). TikTok/IG POST/PAGE urls render blank.
function firstBadSlideImage(slides: Slide[]): { index: number; url: string } | null {
  for (let i = 0; i < slides.length; i++) {
    const u = slides[i]?.image_url;
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return { index: i, url: String(u ?? '(empty)') };
    if (/\/\/(www\.)?(tiktok|instagram)\.com\//i.test(u)) return { index: i, url: u };
  }
  return null;
}

let sceneSeq = 0;
function buildSceneData(slides: Slide[]): any {
  sceneSeq += 1;
  return {
    id: `scene-bench-${sceneSeq}`, name: 'Standalone slideshow',
    pages: slides.map((s, i) => {
      const n = i + 1;
      const blocks: any[] = [
        { id: `bg-${n}`, type: 'background', style: { type: 'color', color: '#000000' }, bounds: { x: 0, y: 0, width: IMG_W, height: IMG_H }, zIndex: 0, rotation: 0 },
        { id: `img-${n}`, type: 'image', src: s.image_url, style: { opacity: 1, objectFit: 'cover', borderRadius: 0 }, bounds: { x: 0, y: 0, width: IMG_W, height: IMG_H }, zIndex: 1, rotation: 0 },
      ];
      if (s.text && s.text.trim()) {
        blocks.push({ id: `txt-${n}`, type: 'text', text: s.text.trim(), style: resolvePresetStyle(s.style_preset), bounds: { x: 90, y: TEXT_Y[s.text_position && TEXT_Y[s.text_position] !== undefined ? s.text_position : 'bottom'], width: 900, height: 460 }, zIndex: 2, rotation: 0 });
      }
      return { id: `page-${n}`, name: `Page ${n}`, width: IMG_W, height: IMG_H, blocks };
    }),
  };
}

async function generateImage(mcp: DoublespeedMcp, params: { prompt: string; reference_image_url?: string; model?: string }): Promise<{ image_url: string } | { error: string }> {
  const prompt = (params.prompt || '').trim();
  if (!prompt) return { error: 'generate_image needs a non-empty "prompt".' };
  try {
    const g: any = await mcp.callTool('generate_image', { prompt, width: IMG_W, height: IMG_H, model: params.model || 'nano-banana', ...(params.reference_image_url ? { image_url: params.reference_image_url } : {}) });
    const url = g?.imageUrl || g?.image_url || g?.url || (typeof g === 'string' ? g : '');
    if (!url) return { error: `generate_image returned no URL: ${JSON.stringify(g).slice(0, 200)}` };
    return { image_url: url };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'generate_image failed' };
  }
}

async function previewSlideshow(mcp: DoublespeedMcp, slides: Slide[]): Promise<{ previews: string[] } | { error: string }> {
  if (!slides?.length) return { error: 'previewSlideshow needs at least one slide.' };
  const bad = firstBadSlideImage(slides);
  if (bad) return { error: `slide ${bad.index + 1} image_url is not a usable image (${bad.url.slice(0, 60)}). Slide images must be generate_image outputs — TikTok/Instagram post URLs render blank. Generate real images first.` };
  const scene_data = buildSceneData(slides);
  try {
    const r: any = await mcp.callTool('render_slides', { scene_data, scale: 0.5, max_slides: Math.min(slides.length, 6) });
    return { previews: Array.isArray(r?.slides) ? r.slides.map((s: any) => s?.pngUrl).filter(Boolean) : [] };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'render_slides failed' };
  }
}

async function publishSlideshow(mcp: DoublespeedMcp, params: { slides: Slide[]; caption: string; accountId: string; autoQueue: boolean; musicLink?: string }): Promise<{ review_link: string | null; group_id: string | null; status: string } | { error: string }> {
  if (!params.slides?.length) return { error: 'publishSlideshow needs at least one slide.' };
  const caption = (params.caption || '').trim();
  if (!caption) return { error: 'publishSlideshow needs a non-empty "caption".' };
  const bad = firstBadSlideImage(params.slides);
  if (bad) return { error: `NOT PUBLISHED — slide ${bad.index + 1} image_url is not a usable image (${bad.url.slice(0, 60)}). Slide images must be generate_image outputs; TikTok/Instagram post URLs render blank. If image generation is failing, do NOT publish — skip and note the outage.` };
  const scene_data = buildSceneData(params.slides);
  try {
    const draft: any = await mcp.callTool('upsert_slideshow_draft', { draft_name: 'standalone-marketing-agent', surface_draft_entry: true, create_share_link: true, scene_data, caption, account_id: params.accountId, ...(params.musicLink ? { music_link: params.musicLink } : {}) });
    const group_id = draft?.groupId || draft?.group_id || draft?.id || null;
    const review_link = draft?.reviewUrl || draft?.review_link || draft?.reviewLink || (draft?.shareLink ? `https://app.doublespeed.ai/review/${draft.shareLink}` : null);
    let status = 'draft';
    if (params.autoQueue && group_id) { await mcp.callTool('queue_post', { group_id, status: 'scheduled' }); status = 'scheduled'; }
    return { review_link, group_id, status };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'publishSlideshow failed' };
  }
}

// ── account stats for the agent: compact recent posts + real metrics ──
interface TikTokStats { views: number; likes: number; comments: number; shares: number; saves: number; reposts: number; downloads: number; }
interface TikTokProfileVideo { awemeId: string; desc: string; createTime: number; stats: TikTokStats; }
interface PostSnap {
  id: string;
  tiktokPostId: string | null;
  account: string;
  status: string;
  postedAt: string | null;
  publicUrl: string | null;
  caption: string;
  cover: string | null;
  slides: string[];
  music: string | null;
  metrics: { views: number; likes: number; comments: number; shares: number; engagementPct: number; saves: number; reposts: number; downloads: number };
}

const SC_STATS_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

async function tiktokStatsFromUrl(url: string): Promise<TikTokStats | null> {
  if (!SCRAPE_CREATORS_API_KEY || typeof url !== 'string' || !url.includes('tiktok.com')) return null;
  try {
    const s = (await scGet('/v2/tiktok/video', url, true))?.aweme_detail?.statistics;
    if (!s) return null;
    return {
      views: s.play_count ?? 0,
      likes: s.digg_count ?? 0,
      comments: s.comment_count ?? 0,
      shares: s.share_count ?? 0,
      saves: s.collect_count ?? 0,
      reposts: s.repost_count ?? 0,
      downloads: s.download_count ?? 0,
    };
  } catch {
    return null;
  }
}

async function tiktokProfileVideos(handle: string): Promise<TikTokProfileVideo[]> {
  if (!SCRAPE_CREATORS_API_KEY || typeof handle !== 'string' || !handle) return [];
  try {
    const u = new URL('https://api.scrapecreators.com/v3/tiktok/profile/videos');
    u.searchParams.set('handle', handle.replace(/^@/, ''));
    u.searchParams.set('sort_by', 'latest');
    const res = await fetch(u, { headers: { 'x-api-key': SCRAPE_CREATORS_API_KEY } });
    if (!res.ok) return [];
    const list: any[] = ((await res.json()) as any)?.aweme_list || [];
    return list.map((v: any) => {
      const s = v.statistics || {};
      return {
        awemeId: String(v.aweme_id || ''),
        desc: String(v.desc || ''),
        createTime: Number(v.create_time || 0),
        stats: {
          views: s.play_count ?? 0, likes: s.digg_count ?? 0, comments: s.comment_count ?? 0,
          shares: s.share_count ?? 0, saves: s.collect_count ?? 0, reposts: s.repost_count ?? 0, downloads: s.download_count ?? 0,
        },
      };
    });
  } catch {
    return [];
  }
}

function mapPost(p: any, fallbackUsername: string): PostSnap {
  const td = p?.template_data || {};
  const slides: string[] = Array.isArray(td.slides) ? td.slides.map((s: any) => s?.url).filter(Boolean) : [];
  const m = p?.metrics || {};
  return {
    id: String(p?.id ?? ''),
    tiktokPostId: p?.tiktok_post_id ? String(p.tiktok_post_id) : null,
    account: p?.account?.username || fallbackUsername,
    status: p?.status || 'unknown',
    postedAt: p?.post_time || p?.succeeded_at || null,
    publicUrl: p?.public_post_url || null,
    caption: String(td.caption || p?.title || '').slice(0, 400),
    cover: slides[0] || null,
    slides,
    music: td.musicShareUrl || null,
    metrics: {
      views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0,
      shares: m.shares ?? 0, engagementPct: m.engagementPct ?? 0,
      saves: 0, reposts: 0, downloads: 0,
    },
  };
}

async function listAccountPosts(mcp: DoublespeedMcp): Promise<PostSnap[]> {
  const all: PostSnap[] = [];
  for (let page = 1; page <= 20; page++) {
    const r: any = await mcp.callTool('list_posts', { account_id: DS_ACCOUNT_ID, page, page_size: 50, sort_by: 'post_time', sort_dir: 'desc' });
    const items: any[] = r?.items || [];
    for (const it of items) {
      if (it?.delete_requested === true || it?.deleted_at) continue;
      if (it?.status === 'draft') continue;
      all.push(mapPost(it, DS_ACCOUNT_USERNAME));
    }
    if (items.length === 0 || page >= (r?.totalPages || 1)) break;
  }
  return all;
}

function buildAccountStats(posts: PostSnap[]): any {
  return ACCOUNTS.map(a => ({
    account: a.username,
    posts: posts.filter(p => p.account === a.username).slice(0, 10).map(p => ({
      caption: p.caption.slice(0, 80), status: p.status, posted: p.postedAt, url: p.publicUrl,
      views: p.metrics.views, likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares,
      saves: p.metrics.saves,
    })),
  }));
}

async function enrichRecentWithScrapeCreators(snaps: PostSnap[], now: Date): Promise<void> {
  const isRecent = (s: PostSnap) => { const t = s.postedAt ? Date.parse(s.postedAt) : NaN; return !!t && now.getTime() - t <= SC_STATS_WINDOW_MS; };
  const engPct = (st: { likes: number; comments: number; shares: number; views: number }) =>
    st.views > 0 ? Number((((st.likes + st.comments + st.shares) / st.views) * 100).toFixed(2)) : 0;
  const applyStats = (s: PostSnap, st: TikTokStats) => {
    s.metrics = { views: st.views, likes: st.likes, comments: st.comments, shares: st.shares, engagementPct: engPct(st), saves: st.saves, reposts: st.reposts, downloads: st.downloads };
  };

  await Promise.all(snaps.filter(s => isRecent(s) && s.publicUrl).map(async s => {
    try { const sc = await tiktokStatsFromUrl(s.publicUrl!); if (sc) applyStats(s, sc); } catch { /* keep Doublespeed numbers */ }
  }));

  const orphans = snaps.filter(s => isRecent(s) && !s.publicUrl);
  if (!orphans.length) return;
  const norm = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  try {
    const vids = await tiktokProfileVideos(DS_ACCOUNT_USERNAME);
    if (!vids.length) return;
    for (const s of orphans) {
      const key = norm(s.caption);
      if (!key) continue;
      const v = vids.find(x => { const d = norm(x.desc); return d === key || d.startsWith(key) || key.startsWith(d); });
      if (!v) continue;
      applyStats(s, v.stats);
      s.tiktokPostId = v.awemeId;
    }
  } catch { /* keep Doublespeed numbers */ }
}

// ════════════════════════════════════════════════════════════════════════════════
// The agent loop
// ════════════════════════════════════════════════════════════════════════════════
function parseJson(text: string): any {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  for (let end = cleaned.length; end > start; end--) { try { return JSON.parse(cleaned.slice(start, end)); } catch { /* shrink */ } }
  return null;
}

interface VisImg { src: string; label?: string; }
interface RunCtx { mcp: DoublespeedMcp; published: PublishedPost[]; accountPostCounts: Record<string, number>; imageRefs: Record<string, string>; labels: { t: number; g: number }; }
interface PublishedPost { account: string; caption: string; slides: Slide[]; reviewLink: string | null; groupId: string | null; status: string; at: string; }
interface RunData { goal: string; published: PublishedPost[]; answer: string | null; note: string | null; rounds: number; }

async function runAction(action: any, ctx: RunCtx): Promise<{ tool: string; result: any; images: VisImg[] }> {
  const { mcp, published, accountPostCounts } = ctx;

  if (action.call_lightreel_api) return { tool: 'call_lightreel_api', result: await callLightreelApi(action.call_lightreel_api), images: [] };

  if (action.view_media) {
    const urls: string[] = Array.isArray(action.view_media?.urls) ? action.view_media.urls : [];
    const viewed = await viewMedia(urls);
    const picks: { label: string; url: string }[] = [];
    const perPost: any[] = [];
    for (const v of viewed) {
      const labels: string[] = [];
      for (const imgUrl of v.images.slice(0, MAX_VIEW_IMAGES_PER_POST)) {
        if (picks.length >= MAX_VIEW_IMAGES_TOTAL) break;
        const label = `T${++ctx.labels.t}`;
        ctx.imageRefs[label] = imgUrl;
        picks.push({ label, url: imgUrl });
        labels.push(label);
      }
      perPost.push({ url: v.url, kind: v.kind, slidesShown: labels.length, labels, ...(v.error ? { error: v.error } : {}) });
    }
    const resized = await Promise.all(picks.map(p => resizeToDataUri(p.url)));
    const images: VisImg[] = [];
    picks.forEach((p, i) => { if (resized[i]) images.push({ src: resized[i]!, label: p.label }); });
    return { tool: 'view_media', result: { viewed: perPost, note: `Showed ${images.length} labelled slide(s) below (each tagged T#). Reference any of them in generate_image by its label.` }, images };
  }

  if (action.generate_image) {
    const g = action.generate_image || {};
    let refUrl: string | undefined;
    let refNote: string | undefined;
    if (typeof g.reference === 'string' && g.reference.trim()) {
      if (ctx.imageRefs[g.reference]) refUrl = ctx.imageRefs[g.reference];
      else refNote = `reference "${g.reference}" not found — generated WITHOUT it. Only use a label (T#/G#) you've been shown.`;
    }
    if (!refUrl && typeof g.reference_image_url === 'string') refUrl = g.reference_image_url;
    const params: any = { prompt: g.prompt, ...(refUrl ? { reference_image_url: refUrl } : {}), ...(IMAGE_MODEL_OVERRIDE ? { model: IMAGE_MODEL_OVERRIDE } : {}) };
    const r = await generateImage(mcp, params);
    if ('image_url' in r) {
      const label = `G${++ctx.labels.g}`;
      ctx.imageRefs[label] = r.image_url;
      return { tool: 'generate_image', result: { label, image_url: r.image_url, ...(refUrl ? { based_on: g.reference || 'a url' } : {}), ...(refNote ? { note: refNote } : {}) }, images: [{ src: r.image_url, label }] };
    }
    return { tool: 'generate_image', result: { ...r, ...(refNote ? { note: refNote } : {}) }, images: [] };
  }

  if (action.preview_slideshow) {
    const slides: Slide[] = Array.isArray(action.preview_slideshow?.slides) ? action.preview_slideshow.slides : [];
    const r = await previewSlideshow(mcp, slides);
    const images: VisImg[] = 'previews' in r ? r.previews.map(p => ({ src: p })) : [];
    const result = 'previews' in r ? { ok: true, rendered: r.previews.length, note: 'Preview images are shown to you below.' } : r;
    return { tool: 'preview_slideshow', result, images };
  }

  if (action.publish_slideshow) {
    const p = action.publish_slideshow || {};
    const acctName = String(p.account || '').replace(/^@/, '').trim().toLowerCase();
    const acct = ACCOUNTS.find(a => a.username.toLowerCase() === acctName);
    if (!acct) {
      return { tool: 'publish_slideshow', result: { error: `publish_slideshow needs "account" set to one of YOUR handles: ${ACCOUNTS.map(a => '@' + a.username).join(', ')}` }, images: [] };
    }
    if ((accountPostCounts[acct.id] || 0) >= POSTS_PER_ACCOUNT) {
      return { tool: 'publish_slideshow', result: { error: `Already queued ${POSTS_PER_ACCOUNT} post for @${acct.username} this run (the per-account limit). Finish with {"answer":"...","note":"..."}.` }, images: [] };
    }
    const slides: Slide[] = Array.isArray(p.slides) ? p.slides : [];
    let musicLink: string | undefined;
    let musicNote: any;
    const soundFrom = typeof p.sound_from_post === 'string' ? p.sound_from_post : (typeof p.music_from_post === 'string' ? p.music_from_post : '');
    if (soundFrom) {
      const ml = await musicLinkFromPost(soundFrom);
      if ('music_link' in ml) { musicLink = ml.music_link; musicNote = { sound: ml.title || 'attached' }; } else musicNote = { sound_error: ml.error };
    }
    const r = await publishSlideshow(mcp, { slides, caption: p.caption || '', accountId: acct.id, autoQueue: AUTO_QUEUE, musicLink });
    if (!('error' in r)) {
      accountPostCounts[acct.id] = (accountPostCounts[acct.id] || 0) + 1;
      published.push({ account: acct.username, caption: p.caption || '', slides, reviewLink: r.review_link, groupId: r.group_id, status: r.status, at: new Date().toISOString() });
    }
    return { tool: 'publish_slideshow', result: { account: acct.username, ...r, ...(musicNote ? { music: musicNote } : {}) }, images: [] };
  }

  return { tool: 'unknown', result: { error: 'unknown action — use call_lightreel_api | view_media | generate_image | preview_slideshow | publish_slideshow' }, images: [] };
}

function loadPastNotes(): string[] {
  try {
    const all: any[] = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    return all.map((r: any) => r?.data?.note).filter((n: any) => typeof n === 'string' && n.trim()).slice(0, NOTES_TO_LOAD);
  } catch { return []; }
}

async function runHarness(goal: string): Promise<RunData> {
  const published: PublishedPost[] = [];
  const accountPostCounts: Record<string, number> = {};
  const mcp = await getDoublespeedClient();
  await mcp.callTool('set_product', { product_id: DS_PRODUCT_ID });
  await loadStylePresets(mcp);
  const ctx: RunCtx = { mcp, published, accountPostCounts, imageRefs: {}, labels: { t: 0, g: 0 } };

  const now = new Date();
  const snaps = await listAccountPosts(mcp);
  await enrichRecentWithScrapeCreators(snaps, now);

  const pastNotes = loadPastNotes();
  const notesBlock = pastNotes.length
    ? `\n\nYOUR PAST NOTES (most recent first — notes you left yourself on prior runs, ~12h apart, twice daily):\n${pastNotes.map((n, i) => `[${i + 1}] ${n}`).join('\n\n')}`
    : `\n\n(No past notes yet — this is an early run. Establish a strategy and leave yourself a good note.)`;

  const accountStats = buildAccountStats(snaps);
  const statsBlock = `\n\nYOUR CURRENT ACCOUNT STATS (recent posts + real view/like/comment/share/save counts, newest first — freshly scraped at run start):\n${JSON.stringify(accountStats)}`;

  console.log(`[marketing-agent] target @${DS_ACCOUNT_USERNAME} (handle ignored) | ${pastNotes.length} past note(s) loaded`);

  const messages: any[] = [
    { role: 'system', content: buildSystem() },
    { role: 'user', content: `${goal}${statsBlock}${notesBlock}\n\nBegin.` },
  ];

  let answer: string | null = null;
  let note: string | null = null;
  let lightreelCalls = 0;
  let round = 0;
  for (round = 1; round <= MAX_ROUNDS + 1; round++) {
    if (round > MAX_ROUNDS) {
      messages.push({ role: 'user', content: `Round budget exhausted. Make sure you have queued a post for EACH account (${ACCOUNTS.map(a => '@' + a.username).join(', ')}) if you haven't, then finish with {"answer":"...","note":"..."}.` });
    }

    // Append-only history (no trimming) → byte-stable prefix → prompt cache hits. 1h TTL survives slow rounds.
    const res = await chatWithRetry(messages, MODEL, { cache_control: { type: 'ephemeral', ttl: '1h' }, max_tokens: 16000, reasoning: { enabled: true, effort: REASONING_EFFORT } }, 'marketing-agent');
    const raw = res.choices?.[0]?.message?.content;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = parseJson(text);
    console.log(`[marketing-agent] round ${round}: ${text.slice(0, 200)}`);

    if (!parsed) { messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'Invalid JSON. Reply ONLY {"actions":[...]} or {"answer":"...","note":"..."}.' }); continue; }
    messages.push({ role: 'assistant', content: text });

    const actions: any[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    const finish = parsed.answer ?? (!actions.length ? (parsed.summary ?? parsed.final ?? parsed.done) : undefined);
    if (finish != null) { answer = typeof finish === 'string' ? finish : JSON.stringify(finish); if (typeof parsed.note === 'string') note = parsed.note.slice(0, 2500); break; }
    if (!actions.length) { messages.push({ role: 'user', content: 'No actions found. Use {"actions":[...]} or {"answer":"...","note":"..."}.' }); continue; }

    // At most ONE call_lightreel_api per round, ~MAX_LIGHTREEL_CALLS total.
    let usedThisRound = false;
    const ran = await Promise.all(actions.map((a) => {
      if (a.call_lightreel_api) {
        if (lightreelCalls >= MAX_LIGHTREEL_CALLS) return Promise.resolve({ tool: 'call_lightreel_api', result: { error: `Research budget exhausted (${MAX_LIGHTREEL_CALLS} max per run). Stop researching — design, preview, and queue your posts.` }, images: [] });
        if (usedThisRound) return Promise.resolve({ tool: 'call_lightreel_api', result: { error: 'Only ONE call_lightreel_api per round. Issue this research call by itself, then act on the result next round.' }, images: [] });
        usedThisRound = true; lightreelCalls += 1;
      }
      return runAction(a, ctx);
    }));
    const results = ran.map(r => ({ tool: r.tool, result: r.result }));
    const images = ran.flatMap(r => r.images);

    // Feed images back, each preceded by its label (label text survives even if you scroll past the image).
    const content: any[] = [{ type: 'text', text: JSON.stringify({ round, roundsLeft: Math.max(0, MAX_ROUNDS - round), postsQueued: published.map(p => p.account), results }) }];
    for (const im of images) { if (im.label) content.push({ type: 'text', text: `image ${im.label}:` }); content.push({ type: 'image_url', image_url: { url: im.src } }); }
    messages.push({ role: 'user', content });
  }

  return { goal, published, answer, note, rounds: Math.min(round, MAX_ROUNDS + 1) };
}

function saveSnapshot(data: RunData): void {
  let all: any[] = [];
  try { all = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { /* none */ }
  all.unshift({ runAt: new Date().toISOString(), data });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(all.slice(0, 30), null, 2));
}

// ════════════════════════════════════════════════════════════════════════════════
// Doublespeed one-time OAuth sign-in (run: `tsx standalone-marketing-agent.ts auth`)
// ════════════════════════════════════════════════════════════════════════════════
function b64url(buf: Buffer): string { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function runAuth(): Promise<void> {
  const PORT = Number(process.env.DS_AUTH_PORT || 8765);
  const REDIRECT_URI = `http://localhost:${PORT}/callback`;

  console.log('→ Registering OAuth client with Doublespeed…');
  const regRes = await fetch(DS_REGISTRATION_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Lightreel Marketing Agent', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  if (!regRes.ok) throw new Error(`Client registration failed (${regRes.status}): ${(await regRes.text().catch(() => '')).slice(0, 400)}`);
  const clientId = ((await regRes.json()) as any).client_id;
  if (!clientId) throw new Error('Registration returned no client_id.');
  console.log(`  client_id: ${clientId}`);

  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const authUrl = new URL(DS_AUTHORIZATION_ENDPOINT);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('resource', DS_MCP_URL);

  console.log('\n→ Opening your browser to sign in. If it does not open, paste this URL:\n');
  console.log(`  ${authUrl.toString()}\n`);
  try { require('child_process').exec(`open "${authUrl.toString()}"`); } catch { /* non-macOS: paste manually */ }

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) { res.writeHead(404).end(); return; }
      const u = new URL(req.url, REDIRECT_URI);
      const c = u.searchParams.get('code'); const st = u.searchParams.get('state'); const err = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      if (err) { res.end(`<h2>Authorization failed: ${err}</h2>`); server.close(); return reject(new Error(`Authorization error: ${err}`)); }
      if (st !== state) { res.end('<h2>State mismatch — aborting.</h2>'); server.close(); return reject(new Error('State mismatch (CSRF) — aborted.')); }
      if (!c) { res.end('<h2>No code returned.</h2>'); server.close(); return reject(new Error('No authorization code in callback.')); }
      res.end('<h2>✅ Doublespeed connected. You can close this tab and return to the terminal.</h2>');
      server.close(); resolve(c);
    });
    server.listen(PORT, () => console.log(`Listening for the OAuth callback on ${REDIRECT_URI}`));
    server.on('error', reject);
  });

  console.log('→ Got authorization code. Exchanging for tokens…');
  const tokRes = await fetch(DS_TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: codeVerifier, resource: DS_MCP_URL }),
  });
  if (!tokRes.ok) throw new Error(`Token exchange failed (${tokRes.status}): ${(await tokRes.text().catch(() => '')).slice(0, 400)}`);
  const tok = (await tokRes.json()) as any;
  if (!tok.access_token) throw new Error('Token exchange returned no access_token.');
  if (!tok.refresh_token) throw new Error('Token exchange returned NO refresh_token — unattended use needs it.');

  saveIntegration({ clientId, refreshToken: tok.refresh_token, accessToken: tok.access_token, accessTokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : Date.now() + 23 * 60 * 60 * 1000 });
  console.log(`✅ Saved Doublespeed tokens to ${TOKEN_FILE}`);

  console.log('\n→ Smoke-testing MCP connection (tools/list)…');
  const mcp = new DoublespeedMcp();
  await mcp.connect();
  const tools = await mcp.listTools();
  console.log(`✅ Connected. ${tools.length} tool(s) available. You can now run the agent.`);
}

// ════════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════════
async function main() {
  if (process.argv[2] === 'auth') { await runAuth(); process.exit(0); }

  const missing = [!OPENROUTER_API_KEY && 'OPENROUTER_API_KEY', !LIGHTREEL_API_KEY && 'LIGHTREEL_API_KEY', !SCRAPE_CREATORS_API_KEY && 'SCRAPE_CREATORS_API_KEY'].filter(Boolean);
  if (missing.length) throw new Error(`Missing env var(s): ${missing.join(', ')}. See the SETUP block at the top of this file.`);
  if (!loadIntegration()?.refreshToken) throw new Error('Doublespeed not connected. Run `tsx standalone-marketing-agent.ts auth` first.');

  const data = await runHarness(GOAL);
  saveSnapshot(data);
  console.log('\n=== PUBLISHED ===');
  for (const p of data.published) console.log(`- ${p.status}: ${p.reviewLink || '(no link)'} — "${p.caption.slice(0, 80)}"`);
  console.log('\n=== ANSWER ===\n' + (data.answer || '(none)'));
  console.log('\n=== NOTE ===\n' + (data.note || '(none)'));
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(1); });
