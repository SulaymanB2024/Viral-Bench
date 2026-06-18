/**
 * standalone-marketing-agent.ts — SELF-CONTAINED handoff version of benchmark-marketing-agents.
 *
 * Everything in one file. NO project imports, NO MongoDB, NO getSecret, NO internal OpenRouter
 * client. Only Node built-ins (fs, path, http, crypto) + global fetch (Node 18+). It makes its
 * own OpenRouter + Lightreel + Doublespeed + ScrapeCreators HTTP calls directly.
 *
 * WHAT IT DOES (identical functionality to the in-repo experiment):
 *   An agentic loop (Claude Opus 4.8) that researches what's breaking out in fitness short-form,
 *   generates imagery, composes a text-on-slide TikTok carousel, SEES its own output, iterates,
 *   and saves a reviewable Doublespeed slideshow draft (+ review link).
 *
 * THE ONE DIFFERENCE vs the in-repo version: call_lightreel_api here hits the PUBLIC Lightreel
 * HTTP API (api.lightreel.ai) with an API key, instead of running the research agent in-process
 * (which would require the whole codebase). Same engine, same results — just over the network.
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────────
 * Requires Node 18+ and tsx (`npm i -g tsx`, or `npx tsx`).
 * Env vars (export them, or run with `node --env-file=.env` / `tsx --env-file=.env`):
 *   OPENROUTER_API_KEY        — for the main agent (Claude Opus 4.8)
 *   LIGHTREEL_API_KEY         — public Lightreel API key (format lr_live_...)
 *   SCRAPE_CREATORS_API_KEY   — for view_media (resolving TikTok/IG URLs → images)
 *   LIGHTREEL_API_URL         — optional, defaults to https://api.lightreel.ai/v1/chat
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────────
 *   1) One-time Doublespeed sign-in (opens your browser):
 *        npx tsx standalone-marketing-agent.ts auth
 *      → writes .doublespeed-tokens.json next to this file (the refresh token lasts ~90d and
 *        auto-renews; re-run `auth` only if it gets revoked).
 *   2) Run the agent:
 *        npx tsx standalone-marketing-agent.ts
 *      → prints a Doublespeed review link for the draft it builds.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';

// ─── env ───────────────────────────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const LIGHTREEL_API_KEY = process.env.LIGHTREEL_API_KEY || '';
const LIGHTREEL_API_URL = process.env.LIGHTREEL_API_URL || 'https://api.lightreel.ai/v1/chat';
const SCRAPE_CREATORS_API_KEY = process.env.SCRAPE_CREATORS_API_KEY || '';

// Token + snapshot files live next to THIS script, so it's portable — drop the file anywhere.
const TOKEN_FILE = path.join(__dirname, '.doublespeed-tokens.json');
const SNAPSHOT_FILE = path.join(__dirname, '.marketing-agent-runs.json');

// ════════════════════════════════════════════════════════════════════════════════
// CONFIG (edit freely) — matches the in-repo experiment exactly.
// ════════════════════════════════════════════════════════════════════════════════
const MODEL = 'anthropic/claude-opus-4.8'; // vision-capable — needed so the agent can see images
const MAX_ROUNDS = 12;
const MAX_LIGHTREEL_CALLS = 5; // hard cap on research calls for the whole run (1 per round, enforced)
// If set, forces every generate_image to use this model regardless of what the agent picks.
// null = leave it to the agent (default nano-banana). 'flux-dev' to A/B the whole run.
const IMAGE_MODEL_OVERRIDE: 'nano-banana' | 'flux-dev' | null = 'flux-dev';
const MAX_VIEW_IMAGES = 6; // cap reference images view_media feeds back per round

// Doublespeed targets (UGC Bench product + its marcus.hyrox TikTok account).
const DS_PRODUCT_ID = '6b5ee861-2421-4e14-a6f3-96510b8997ce';
const DS_ACCOUNT_USERNAME = 'marcus.hyrox';
const DS_ACCOUNT_ID = 'f122eef9-a016-4440-a25a-9389771d22ae';

// false → publish leaves a DRAFT + review link. true → also queue_post it (status 'scheduled').
const AUTO_QUEUE = false;

const DEFAULT_GOAL =
  `Your TikTok account is already WARMED UP and established broadly in the FITNESS space. ` +
  `Your ONE and ONLY goal is to get AS MANY VIEWS AS POSSIBLE on a single TikTok slideshow post. ` +
  `Nothing else matters — not brand safety, not selling anything, not follower growth — purely maximize views. ` +
  `The post can be about ANYTHING in or AROUND fitness — it just has to be roughly fitness-adjacent / directionally ` +
  `on-theme, since that's the space the account is warmed up in. It does NOT have to be workout or training content: ` +
  `gym, lifting, running, cardio, nutrition, recovery, gym culture & humor, motivation, transformations, mistakes, ` +
  `or fitness-adjacent lifestyle / wellness / discipline / mindset stuff — all fair game if it fits the vibe. ` +
  `(The account's @handle is just a name — it does NOT define your topic. Do NOT anchor on any sub-niche the handle ` +
  `might imply; treat this as a general fitness account.) You are NOT locked to any one sub-niche, so chase whatever ` +
  `fitness-ish angle has the highest view ceiling right now. It's YOUR call how to play it — look at what's getting ` +
  `views, how the account is doing, and decide whether to lean into a working topic or switch it up; just know that ` +
  `changing genres/styles too often can confuse the algorithm, so weigh that tradeoff yourself. ` +
  `Use your tools to figure out what is breaking out RIGHT NOW, understand WHY it works, then design, verify, and ` +
  `publish the highest-ceiling slideshow you can.
  Overall, though, it is up to you how to use these tools. When to copy posts, when to use hooks, when to change strategies, etc.
  `;

const SYSTEM = (goal: string) => `You are a short-form content strategist running a warmed-up, general-fitness TikTok account. You operate in rounds: each round you either call tools or give your final answer. Reply ONLY with JSON, no prose outside it.

OBJECTIVE: ${goal}

HOW TO WIN (read this carefully)
Views come from: (1) a scroll-stopping first slide (hook + visual), (2) an angle that is ACTUALLY trending right now (not your guess — verified), (3) a payoff that makes people save/share/comment.

You do not invent angles from your own priors — you mine what is already breaking out, understand the underlying pattern, then execute it better. Use call_lightreel_api relentlessly to understand culture, current topics, formats, and to pull real examples. Use view_media to actually SEE the winners. Then make something that looks native and intentional — NOT obviously AI-generated.

You are TERRIBLE at understanding culture, hooks, scripts, or trends. DO NOT rely on your training data. Your creativity is how you decide to use the Lightreel API, what you decide to post, and what decisions you end up making based on the lightreel API. You can also ask Lightreel API to rate your hooks, scripts, and ideas too if you want.

YOU HAVE FIVE TOOLS.

1) call_lightreel_api — your research brain.
On the other end is an EXTREMELY INTELLIGENT research agent sitting on a massive, continuously-scraped database of TikTok & Instagram UGC videos, their creators, hooks, captions, view/engagement data, and the products they promote. It does real semantic search + live platform lookups and answers grounded in actual videos. Treat it like a brilliant analyst — ask rich, specific, layered questions.
  - HARD LIMITS: at most ONE call_lightreel_api PER ROUND, and a budget of only ~5 research calls for the ENTIRE run. Each call is slow and expensive, so make every one count — ask one big, high-leverage question rather than many small ones, and stack multiple response_fields to get everything you need from a single call. Don't waste the budget.
  - Ask about: what's breaking out this week, WHY a format works, hook structures, caption patterns, slideshow vs video, what's overdone, cultural context, specific creators, etc.
  - By DEFAULT you get prose. For structured data, pass response_fields: a flat list of UP TO 5 fields, each { "name","type":"string"|"array","description" }. Field names are lowercase. Be creative — you can INDEX/ALIGN parallel arrays so position i lines up across fields (say so in the descriptions).
  - IMPORTANT — getting real links: the agent only returns TikTok/Instagram URLs when you explicitly ASK for them AND give them a field to land in. So say "include the real TikTok URL for each example" in the question, and add an "example_urls" array field. Without that you get prose with no usable links.
  - You are making a PHOTO SLIDESHOW / CAROUSEL, so at some point you MUST get real links to actual PHOTO/CAROUSEL posts (TikTok photo mode / IG carousels) — NOT videos. Explicitly ask for "photo carousel / slideshow posts only (not videos)" and request their URLs, so you can then view_media them and visually study the actual SLIDES — slide 1 design, text placement, how the slides progress, image style. Video covers don't show you how a slideshow is built; real carousels do. Make at least one research call aimed at surfacing real carousel post URLs.
  - GOOD example questions:
    • {"call_lightreel_api":{"question":"What fitness/gym slideshow hooks are breaking out on TikTok in the last 2-3 weeks? For each, explain the underlying psychological mechanism and give the real TikTok URL of a top example.","response_fields":[{"name":"hooks","type":"array","description":"6 verbatim breakout hook lines, strongest first"},{"name":"why_it_works","type":"array","description":"the mechanism behind hooks[i] — same order/length"},{"name":"example_urls","type":"array","description":"real TikTok URL of a top video using hooks[i] — same order; empty string if none"}]}}
    • {"call_lightreel_api":{"question":"For fitness creators right now, what slideshow STRUCTURES (slide count, what goes on slide 1 vs the rest, text style) are getting the most saves and shares? Give concrete recent examples with URLs."}}
    • {"call_lightreel_api":{"question":"What's the current cultural moment / running jokes / aesthetics in gym TikTok this month that a post could tap into to feel native?"}}
  - Call it again any round — after seeing examples or your own images, go back with a sharper question.
  - Rely HEAVILY on the API for understanding culture, which hooks are working, how to word the hooks, etc. You are very out of tune about culture, TikTok, social media, hook writing, pacing... everyhting. Just ask Lightreel.


2) view_media — SEE the real content behind a TikTok/Instagram URL.
You cannot judge a post by its link. Pass the URLs the research returns here to dereference them into actual images so you can study what's really working visually before you design yours.
  - PHOTO/CAROUSEL posts return ALL their slide images (the full swipe sequence) — this is the gold: it shows you exactly how a winning slideshow is built (slide 1 hook design, text placement, image style, slide-to-slide flow). VIDEO posts only return a single cover frame, which tells you very little. So prioritize viewing real CAROUSEL/photo posts. Before you design your slides, you should have actually LOOKED at a few real breakout carousels this way.
  - Shape: {"view_media":{"urls":["https://www.tiktok.com/@x/photo/123","https://www.instagram.com/p/abc/"]}}
  - Images are SHOWN TO YOU next round. Use specific post URLs (not profile pages). Up to ~6 images returned. You can also reuse any of these real images as a reference_image_url in generate_image to base your visuals on a proven winner.

3) generate_image — make an image (Doublespeed, 1080×1920). Supports text-to-image AND image-to-image.
  - Shape: {"generate_image":{"prompt":"...","reference_image_url":"<optional image URL to base this one on>","model":"nano-banana|flux-dev"}}
  - Returns an image_url, and THE IMAGE IS SHOWN TO YOU next round. Actually LOOK at it and be critical: does it look real and native to fitness TikTok, or does it scream "AI-generated" (waxy skin, mangled hands/text, impossible anatomy, fake gym equipment, uncanny faces)? If it looks AI, regenerate with a better prompt or refine via reference_image_url.
  - reference_image_url = IMAGE-TO-IMAGE. The model KEEPS the reference image (scene, subject, lighting, composition) and applies your prompt as an edit. This is powerful — use it deliberately:
      a) CROSS-SLIDE CONSISTENCY: generate slide 1, then pass its image_url as reference_image_url for the other slides so the SAME gym / SAME person / SAME style carries across the whole carousel. This is how you can do consistent-character formats (a recurring person, before→after, progress, a story across slides) instead of being stuck with faceless/atmospheric images. Lean on this.
      b) SEED FROM A REAL WINNER: pass a real reference image — e.g. a cover URL you got from view_media of a breakout post — as reference_image_url to base your image on its composition/vibe (both Doublespeed URLs and external TikTok/IG image URLs work).
      c) ITERATE: pass your own previous image to nudge/fix it.
  - Prompt for REALISM: specify it's a candid iPhone/amateur photo, real gym, natural/unflattering lighting, grain, motion — not glossy studio render. Keep the lower third visually calm so overlay text stays readable. Avoid asking the model to render real text in the image (it garbles it) — text comes from the slideshow overlay, not the image.
  - On faces/people: a single AI person across multiple FRESH text-to-image calls will look different each slide (inconsistent) — so if your concept needs the same person on multiple slides, generate them once and carry them via reference_image_url (a), don't re-roll them.

4) preview_slideshow — compose + render the slides so YOU CAN SEE the finished post.
  - Shape: {"preview_slideshow":{"slides":[{"image_url":"...","text":"on-slide hook line","text_position":"top|middle|bottom"}, ...]}}
  - text_position (optional, default "bottom"/lower-third) moves the text box top/middle/bottom per slide. White bold text is baked on automatically — you only choose the text and its position.
  - Each slide = a generated image_url + the overlay text baked on. Returns rendered preview PNGs, SHOWN TO YOU next round. VERIFY: is slide 1 a genuine scroll-stopper? Is the text readable over the image? Does the flow make someone swipe? Fix anything weak and re-preview. Do NOT skip this.
  - ONE DISTINCT IMAGE PER SLIDE: every slide must have its OWN image. NEVER reuse the identical image_url on more than one slide — pasting the same background behind multiple text slides looks lazy and repetitive. Keep the slides visually COHESIVE (same palette / vibe / style so it reads as one set) but each image VISUALLY DISTINCT.

5) publish_slideshow — save the final draft (+ review link).
  - Shape: {"publish_slideshow":{"slides":[{"image_url":"...","text":"...","text_position":"top|middle|bottom"}, ...],"caption":"full caption with hashtags"}}
  - Creates a Doublespeed slideshow draft assigned to your account, returns a review link. ${AUTO_QUEUE ? 'It is ALSO queued (scheduled).' : 'It stays a DRAFT for human review — it is NOT posted.'}
  - Only publish after you have previewed and genuinely believe it has the highest view ceiling you can produce.

PROTOCOL
- To act:   {"actions":[ {"generate_image":{...}}, {"generate_image":{...}} ]}  (one or more; they run in parallel)
- To finish:{"answer":"<2-4 sentence summary: the angle, why it'll get views, and the review link>"}
- You have ${MAX_ROUNDS} rounds. Rough arc: research deeply → view_media the real winners → lock an angle → generate images (look critically) → preview slides (verify they're strong + not AI-looking) → refine → publish → answer. Bias toward MORE research and MORE iteration. Don't publish something mediocre just to finish.`;

// ════════════════════════════════════════════════════════════════════════════════
// OpenRouter (main agent LLM) — minimal inline client
// ════════════════════════════════════════════════════════════════════════════════
async function openRouterChat(messages: any[], model: string, opts: { cache_control?: any; max_tokens?: number; reasoning?: any }): Promise<any> {
  const body: Record<string, any> = {
    model,
    messages,
    stream: false,
    usage: { include: true },
    plugins: [{ id: 'response-healing' }],
    ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
    ...(opts.cache_control ? { cache_control: opts.cache_control } : {}),
    ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 400)}`);
  }
  const json: any = await res.json();
  if (json?.error) throw new Error(`OpenRouter error: ${json.error.message || JSON.stringify(json.error)}`);
  return json;
}

// ════════════════════════════════════════════════════════════════════════════════
// Lightreel research — PUBLIC HTTP API (same engine as in-process, over the network)
// ════════════════════════════════════════════════════════════════════════════════
async function callLightreelApi(params: {
  question?: string;
  response_fields?: { name: string; type: string; description?: string }[];
}): Promise<any> {
  const question = typeof params.question === 'string' ? params.question.trim() : '';
  if (!question) return { error: 'call_lightreel_api needs a non-empty "question".' };
  if (!LIGHTREEL_API_KEY) return { error: 'LIGHTREEL_API_KEY not set.' };

  // The public API takes response_fields as a FLAT MAP { name: { type, description } } (≤5).
  let response_fields: Record<string, any> | undefined;
  if (Array.isArray(params.response_fields)) {
    const valid = params.response_fields
      .filter(f => f && typeof f.name === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(f.name))
      .slice(0, 5);
    if (valid.length) {
      response_fields = {};
      for (const f of valid) {
        response_fields[f.name] = {
          type: f.type === 'array' ? 'array' : 'string',
          ...(typeof f.description === 'string' ? { description: f.description.slice(0, 500) } : {}),
        };
      }
    }
  }

  try {
    const res = await fetch(LIGHTREEL_API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${LIGHTREEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question, ...(response_fields ? { response_fields } : {}) }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return { error: `lightreel call failed: ${String(msg).slice(0, 300)}` };
    }
    return { answer: json.answer };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'lightreel call failed' };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// view_media — resolve TikTok/IG URLs → viewable images (ScrapeCreators), via global fetch
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
        const imgs = data.image_post_info.images
          .map((img: any) => pickImg(img?.display_image?.url_list || img?.thumb_url_list))
          .filter(Boolean) as string[];
        return { url, images: imgs, kind: 'photo' };
      }
      const cover = pickImg(data.video?.cover?.url_list)
        || pickImg(data.video?.origin_cover?.url_list)
        || pickImg(data.video?.dynamic_cover?.url_list);
      return { url, images: cover ? [cover] : [], kind: 'video' };
    }

    if (url.includes('instagram.com')) {
      const raw = await scGet('/v1/instagram/post', url, true);
      const data = raw?.xdt_shortcode_media || raw?.data?.xdt_shortcode_media;
      if (!data) return { url, images: [], kind: 'unknown', error: 'could not fetch Instagram' };
      const nodes = [
        ...(data.edge_sidecar_to_children?.edges || []).map((e: any) => e?.node).filter(Boolean),
        ...(data.carousel_media || []),
      ];
      const images = (nodes.length
        ? nodes.map((n: any) => n?.display_url || n?.image_versions2?.candidates?.[0]?.url || n?.thumbnail_src || null)
        : [data.display_url || data.image_versions2?.candidates?.[0]?.url || data.thumbnail_src || null]
      ).filter(Boolean) as string[];
      return { url, images, kind: data.video_url ? 'video' : 'photo' };
    }

    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return { url, images: [url], kind: 'photo' };
    return { url, images: [], kind: 'unknown', error: 'unsupported URL — pass a TikTok/Instagram video or post URL' };
  } catch (e: any) {
    return { url, images: [], kind: 'unknown', error: e?.message?.slice(0, 160) || 'scrape failed' };
  }
}

async function viewMedia(urls: string[]): Promise<ViewedMedia[]> {
  const clean = (Array.isArray(urls) ? urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, 8);
  if (!clean.length) return [];
  return Promise.all(clean.map(viewOne));
}

// ════════════════════════════════════════════════════════════════════════════════
// Doublespeed — OAuth token store (local file) + MCP-over-HTTP client
// ════════════════════════════════════════════════════════════════════════════════
const DS_MCP_URL = 'https://app.doublespeed.ai/api/mcp';
const DS_AUTHORIZATION_ENDPOINT = 'https://app.doublespeed.ai/oauth/authorize';
const DS_TOKEN_ENDPOINT = 'https://app.doublespeed.ai/api/oauth/token';
const DS_REGISTRATION_ENDPOINT = 'https://app.doublespeed.ai/api/oauth/register';
const MCP_PROTOCOL_VERSION = '2025-06-18';

interface DoublespeedIntegration {
  provider: 'doublespeed';
  clientId: string;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: number | null;
  updatedAt: string;
}

function loadIntegration(): DoublespeedIntegration | null {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveIntegration(patch: Partial<DoublespeedIntegration> & { clientId?: string; refreshToken?: string }): void {
  const current = loadIntegration() || ({} as DoublespeedIntegration);
  const next: DoublespeedIntegration = { ...current, ...patch, provider: 'doublespeed', updatedAt: new Date().toISOString() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

async function refreshAccessToken(integration: DoublespeedIntegration): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: integration.refreshToken,
    client_id: integration.clientId,
    resource: DS_MCP_URL,
  });
  const res = await fetch(DS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Doublespeed token refresh failed (${res.status}): ${text.slice(0, 300)}. The refresh token may be expired/revoked — re-run this file with the "auth" argument.`);
  }
  const json: any = await res.json();
  if (!json.access_token) throw new Error('Doublespeed token refresh returned no access_token.');
  const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 23 * 60 * 60 * 1000;
  saveIntegration({
    accessToken: json.access_token,
    accessTokenExpiresAt: expiresAt,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
  });
  return json.access_token;
}

async function getAccessToken(): Promise<string> {
  const integration = loadIntegration();
  if (!integration?.refreshToken || !integration.clientId) {
    throw new Error('Doublespeed is not connected yet. Run this file with the "auth" argument once to sign in.');
  }
  const skewMs = 5 * 60 * 1000;
  if (integration.accessToken && integration.accessTokenExpiresAt && integration.accessTokenExpiresAt - skewMs > Date.now()) {
    return integration.accessToken;
  }
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
      try {
        const obj = JSON.parse(payload);
        if (obj && (obj.result !== undefined || obj.error !== undefined || obj.id !== undefined)) last = obj;
      } catch { /* skip keepalive */ }
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
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const res = await fetch(DS_MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 401 && !opts.notification) {
      this.accessToken = await getAccessToken();
      return this.rpc(method, params, opts);
    }
    if (opts.notification) {
      if (!res.ok && res.status !== 202) {
        const text = await res.text().catch(() => '');
        throw new Error(`MCP notification ${method} failed (${res.status}): ${text.slice(0, 200)}`);
      }
      return null;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${method} failed (${res.status}): ${text.slice(0, 300)}`);
    const env = parseMcpBody(res.headers.get('content-type'), text);
    if (env?.error) throw new Error(`MCP ${method} error ${env.error.code}: ${env.error.message}`);
    return env?.result;
  }

  async connect(): Promise<void> {
    await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'standalone-marketing-agent', version: '1.0.0' } });
    await this.rpc('notifications/initialized', undefined, { notification: true });
  }
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: any }>> {
    const result = await this.rpc('tools/list', {});
    return result?.tools ?? [];
  }
  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result?.isError) {
      const msg = Array.isArray(result.content) ? result.content.map((c: any) => c?.text ?? '').join('\n') : 'tool error';
      throw new Error(`Doublespeed tool ${name} failed: ${String(msg).slice(0, 400)}`);
    }
    if (result?.structuredContent !== undefined) return result.structuredContent;
    if (Array.isArray(result?.content)) {
      const text = result.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
      try { return JSON.parse(text); } catch { return text; }
    }
    return result;
  }
}

async function getDoublespeedClient(): Promise<DoublespeedMcp> {
  const mcp = new DoublespeedMcp();
  await mcp.connect();
  return mcp;
}

// ════════════════════════════════════════════════════════════════════════════════
// Doublespeed slideshow ops (scene builder + generate/preview/publish)
// ════════════════════════════════════════════════════════════════════════════════
const IMG_W = 1080;
const IMG_H = 1920;

interface Slide {
  image_url: string;
  text?: string | null;
  text_position?: 'top' | 'middle' | 'bottom';
}

const TEXT_Y: Record<'top' | 'middle' | 'bottom', number> = { top: 200, middle: 730, bottom: 1320 };

let sceneSeq = 0;
function buildSceneData(slides: Slide[]): any {
  sceneSeq += 1;
  return {
    id: `scene-bench-${sceneSeq}`,
    name: 'Benchmark slideshow',
    pages: slides.map((s, i) => {
      const n = i + 1;
      const blocks: any[] = [
        { id: `bg-${n}`, type: 'background', style: { type: 'color', color: '#000000' }, bounds: { x: 0, y: 0, width: IMG_W, height: IMG_H }, zIndex: 0, rotation: 0 },
        { id: `img-${n}`, type: 'image', src: s.image_url, style: { opacity: 1, objectFit: 'cover', borderRadius: 0 }, bounds: { x: 0, y: 0, width: IMG_W, height: IMG_H }, zIndex: 1, rotation: 0 },
      ];
      if (s.text && s.text.trim()) {
        blocks.push({
          id: `txt-${n}`,
          type: 'text',
          text: s.text.trim(),
          style: {
            color: '#ffffff', padding: 20, fontSize: 60, textAlign: 'center',
            fontFamily: 'TikTok Display - Medium', fontWeight: 700, lineHeight: 1.2,
            letterSpacing: 0, verticalAlign: 'middle', backgroundShape: 'rectangle',
          },
          bounds: { x: 90, y: TEXT_Y[s.text_position && TEXT_Y[s.text_position] !== undefined ? s.text_position : 'bottom'], width: 900, height: 460 },
          zIndex: 2, rotation: 0,
        });
      }
      return { id: `page-${n}`, name: `Page ${n}`, width: IMG_W, height: IMG_H, blocks };
    }),
  };
}

async function generateImage(mcp: DoublespeedMcp, params: { prompt: string; reference_image_url?: string; model?: string }): Promise<{ image_url: string } | { error: string }> {
  const prompt = (params.prompt || '').trim();
  if (!prompt) return { error: 'generate_image needs a non-empty "prompt".' };
  try {
    const g: any = await mcp.callTool('generate_image', {
      prompt, width: IMG_W, height: IMG_H,
      model: params.model || 'nano-banana',
      ...(params.reference_image_url ? { image_url: params.reference_image_url } : {}),
    });
    const url = g?.imageUrl || g?.image_url || g?.url || (typeof g === 'string' ? g : '');
    if (!url) return { error: `generate_image returned no URL: ${JSON.stringify(g).slice(0, 200)}` };
    return { image_url: url };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'generate_image failed' };
  }
}

async function previewSlideshow(mcp: DoublespeedMcp, slides: Slide[]): Promise<{ previews: string[] } | { error: string }> {
  if (!slides?.length) return { error: 'previewSlideshow needs at least one slide.' };
  const scene_data = buildSceneData(slides);
  try {
    const r: any = await mcp.callTool('render_slides', { scene_data, scale: 0.5, max_slides: Math.min(slides.length, 6) });
    const previews: string[] = Array.isArray(r?.slides) ? r.slides.map((s: any) => s?.pngUrl).filter(Boolean) : [];
    return { previews };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'render_slides failed' };
  }
}

async function publishSlideshow(mcp: DoublespeedMcp, params: { slides: Slide[]; caption: string; accountId: string; autoQueue: boolean }): Promise<{ review_link: string | null; group_id: string | null; status: string } | { error: string }> {
  if (!params.slides?.length) return { error: 'publishSlideshow needs at least one slide.' };
  const caption = (params.caption || '').trim();
  if (!caption) return { error: 'publishSlideshow needs a non-empty "caption".' };
  const scene_data = buildSceneData(params.slides);
  try {
    const draft: any = await mcp.callTool('upsert_slideshow_draft', {
      draft_name: 'standalone-marketing-agent',
      surface_draft_entry: true,
      create_share_link: true,
      scene_data, caption, account_id: params.accountId,
    });
    const group_id = draft?.groupId || draft?.group_id || draft?.id || null;
    const review_link = draft?.reviewUrl || draft?.review_link || draft?.reviewLink ||
      (draft?.shareLink ? `https://app.doublespeed.ai/review/${draft.shareLink}` : null);
    let status = 'draft';
    if (params.autoQueue && group_id) {
      await mcp.callTool('queue_post', { group_id, status: 'scheduled' });
      status = 'scheduled';
    }
    return { review_link, group_id, status };
  } catch (e: any) {
    return { error: e?.message?.slice(0, 300) || 'publishSlideshow failed' };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// The agent loop
// ════════════════════════════════════════════════════════════════════════════════
function parseJson(text: string): any {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  for (let end = cleaned.length; end > start; end--) {
    try { return JSON.parse(cleaned.slice(start, end)); } catch { /* shrink */ }
  }
  return null;
}

interface PublishedPost { caption: string; slides: Slide[]; reviewLink: string | null; groupId: string | null; status: string; at: Date; }
interface BenchmarkData { goal: string; published: PublishedPost[]; finalNote: string | null; rounds: number; transcript: { round: number; actions: any[]; results: any[] }[]; }

async function runAction(action: any, mcp: DoublespeedMcp, published: PublishedPost[]): Promise<{ tool: string; result: any; images: string[] }> {
  if (action.call_lightreel_api) {
    return { tool: 'call_lightreel_api', result: await callLightreelApi(action.call_lightreel_api), images: [] };
  }
  if (action.view_media) {
    const urls: string[] = Array.isArray(action.view_media?.urls) ? action.view_media.urls : [];
    const viewed = await viewMedia(urls);
    const images = viewed.flatMap(v => v.images).slice(0, MAX_VIEW_IMAGES);
    const result = viewed.map(v => ({ url: v.url, kind: v.kind, imageCount: v.images.length, ...(v.error ? { error: v.error } : {}) }));
    return { tool: 'view_media', result: { viewed: result, note: `Showing ${images.length} reference image(s) below.` }, images };
  }
  if (action.generate_image) {
    const params = IMAGE_MODEL_OVERRIDE ? { ...action.generate_image, model: IMAGE_MODEL_OVERRIDE } : action.generate_image;
    const r = await generateImage(mcp, params);
    const images = 'image_url' in r ? [r.image_url] : [];
    return { tool: 'generate_image', result: r, images };
  }
  if (action.preview_slideshow) {
    const slides: Slide[] = Array.isArray(action.preview_slideshow?.slides) ? action.preview_slideshow.slides : [];
    const r = await previewSlideshow(mcp, slides);
    const images = 'previews' in r ? r.previews : [];
    const result = 'previews' in r ? { ok: true, rendered: r.previews.length, note: 'Preview images are shown to you below.' } : r;
    return { tool: 'preview_slideshow', result, images };
  }
  if (action.publish_slideshow) {
    const p = action.publish_slideshow || {};
    const slides: Slide[] = Array.isArray(p.slides) ? p.slides : [];
    const r = await publishSlideshow(mcp, { slides, caption: p.caption || '', accountId: DS_ACCOUNT_ID, autoQueue: AUTO_QUEUE });
    if (!('error' in r)) {
      published.push({ caption: p.caption || '', slides, reviewLink: r.review_link, groupId: r.group_id, status: r.status, at: new Date() });
    }
    return { tool: 'publish_slideshow', result: r, images: [] };
  }
  return { tool: 'unknown', result: { error: 'unknown action — use call_lightreel_api | generate_image | preview_slideshow | publish_slideshow' }, images: [] };
}

async function runHarness(goal: string): Promise<BenchmarkData> {
  const published: PublishedPost[] = [];
  const transcript: BenchmarkData['transcript'] = [];

  const mcp = await getDoublespeedClient();
  await mcp.callTool('set_product', { product_id: DS_PRODUCT_ID });
  console.log(`[marketing-agent] target account: @${DS_ACCOUNT_USERNAME} (treated as general fitness; handle hidden from the agent)`);

  const messages: any[] = [
    { role: 'system', content: SYSTEM(goal) },
    { role: 'user', content: `OBJECTIVE: ${goal}\nBegin.` },
  ];

  let finalNote: string | null = null;
  let lightreelCalls = 0;
  let round = 0;
  for (round = 1; round <= MAX_ROUNDS + 1; round++) {
    if (round > MAX_ROUNDS) {
      messages.push({ role: 'user', content: 'Round budget exhausted. If you have a good slideshow, publish it now (if you have not), then reply with {"answer":"..."}.' });
    }

    const res = await openRouterChat(messages, MODEL, {
      cache_control: { type: 'ephemeral' },
      max_tokens: 16000,
      reasoning: { enabled: true, effort: 'high' },
    });
    const raw = res.choices?.[0]?.message?.content;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = parseJson(text);
    console.log(`[marketing-agent] round ${round}: ${text.slice(0, 200)}`);

    if (!parsed) {
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'Invalid JSON. Reply ONLY {"actions":[...]} or {"answer":"..."}.' });
      continue;
    }
    messages.push({ role: 'assistant', content: text });

    const actions: any[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    const finish = parsed.answer ?? (!actions.length ? (parsed.summary ?? parsed.final ?? parsed.done) : undefined);
    if (finish != null) {
      finalNote = typeof finish === 'string' ? finish : JSON.stringify(finish);
      break;
    }
    if (!actions.length) {
      messages.push({ role: 'user', content: 'No actions found. Use {"actions":[...]} or {"answer":"..."}.' });
      continue;
    }

    // Enforce research budget: at most ONE call_lightreel_api per round, ~MAX_LIGHTREEL_CALLS total.
    let usedThisRound = false;
    const ran = await Promise.all(actions.map((a) => {
      if (a.call_lightreel_api) {
        if (lightreelCalls >= MAX_LIGHTREEL_CALLS) {
          return Promise.resolve({ tool: 'call_lightreel_api', result: { error: `Research budget exhausted (${MAX_LIGHTREEL_CALLS} max per run). Stop researching — generate, preview, and publish with what you already know.` }, images: [] });
        }
        if (usedThisRound) {
          return Promise.resolve({ tool: 'call_lightreel_api', result: { error: 'Only ONE call_lightreel_api per round. Issue this research call by itself, then act on the result next round.' }, images: [] });
        }
        usedThisRound = true;
        lightreelCalls += 1;
      }
      return runAction(a, mcp, published);
    }));
    const results = ran.map(r => ({ tool: r.tool, result: r.result }));
    const images = ran.flatMap(r => r.images);

    transcript.push({ round, actions, results });

    const content: any[] = [{ type: 'text', text: JSON.stringify({ round, roundsLeft: Math.max(0, MAX_ROUNDS - round), results }) }];
    for (const url of images) content.push({ type: 'image_url', image_url: { url } });
    messages.push({ role: 'user', content });
  }

  return { goal, published, finalNote, rounds: Math.min(round, MAX_ROUNDS + 1), transcript };
}

function saveSnapshot(data: BenchmarkData): void {
  let all: any[] = [];
  try { all = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { /* none */ }
  all.unshift({ runAt: new Date().toISOString(), data });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(all.slice(0, 30), null, 2));
}

// ════════════════════════════════════════════════════════════════════════════════
// Doublespeed one-time OAuth sign-in (run: `tsx standalone-marketing-agent.ts auth`)
// ════════════════════════════════════════════════════════════════════════════════
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function runAuth(): Promise<void> {
  const PORT = Number(process.env.DS_AUTH_PORT || 8765);
  const REDIRECT_URI = `http://localhost:${PORT}/callback`;

  console.log('→ Registering OAuth client with Doublespeed…');
  const regRes = await fetch(DS_REGISTRATION_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Lightreel Marketing Agent',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
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
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: codeVerifier, resource: DS_MCP_URL }),
  });
  if (!tokRes.ok) throw new Error(`Token exchange failed (${tokRes.status}): ${(await tokRes.text().catch(() => '')).slice(0, 400)}`);
  const tok = (await tokRes.json()) as any;
  if (!tok.access_token) throw new Error('Token exchange returned no access_token.');
  if (!tok.refresh_token) throw new Error('Token exchange returned NO refresh_token — unattended use needs it.');

  saveIntegration({
    clientId,
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    accessTokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : Date.now() + 23 * 60 * 60 * 1000,
  });
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
  const mode = process.argv[2];
  if (mode === 'auth') { await runAuth(); process.exit(0); }

  // Required env for a run.
  const missing = [
    !OPENROUTER_API_KEY && 'OPENROUTER_API_KEY',
    !LIGHTREEL_API_KEY && 'LIGHTREEL_API_KEY',
    !SCRAPE_CREATORS_API_KEY && 'SCRAPE_CREATORS_API_KEY',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing env var(s): ${missing.join(', ')}. See the SETUP block at the top of this file.`);
  if (!loadIntegration()?.refreshToken) throw new Error('Doublespeed not connected. Run `tsx standalone-marketing-agent.ts auth` first.');

  const data = await runHarness(DEFAULT_GOAL);
  saveSnapshot(data);
  console.log('\n=== PUBLISHED ===');
  for (const p of data.published) console.log(`- ${p.status}: ${p.reviewLink || '(no link)'} — "${p.caption.slice(0, 80)}"`);
  console.log('\n=== FINAL NOTE ===\n' + (data.finalNote || '(none)'));
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(1); });
