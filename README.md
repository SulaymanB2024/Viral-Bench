# Lightreel Marketing Agent (standalone)

A single-file agent (Claude Opus 4.8) that researches what's breaking out in fitness short-form,
generates imagery, composes a text-on-slide TikTok carousel, sees its own output, iterates, and
saves a reviewable **Doublespeed** slideshow draft (+ review link).

Self-contained: only Node built-ins + global `fetch`. No database, no framework.

## Setup
Requires **Node 18+**.

```bash
npm install                 # installs tsx (TS runner)
cp .env.example .env        # then fill in your keys
```

Env vars (in `.env`, or exported in your shell):
- `OPENROUTER_API_KEY` — runs the main agent (Claude Opus 4.8)
- `LIGHTREEL_API_KEY` — public Lightreel API key (`lr_live_...`)
- `SCRAPE_CREATORS_API_KEY` — resolves TikTok/IG URLs into images for the agent to "see"

> The script reads `process.env` directly. With npm scripts, either export the vars or run via
> `node --env-file=.env` / pass them inline. (tsx respects exported env.)

## Run
```bash
npm run auth     # one-time Doublespeed browser sign-in (writes .doublespeed-tokens.json)
npm start        # runs the agent → prints a Doublespeed review link
```

## Before you run it for real
Open `marketing-agent.ts` and set the Doublespeed targets near the top to YOUR account:
- `DS_PRODUCT_ID`
- `DS_ACCOUNT_ID`
- `DS_ACCOUNT_USERNAME`

(As shipped they point at a specific test account.) Tunables like `MODEL`, `MAX_ROUNDS`,
`MAX_LIGHTREEL_CALLS`, `IMAGE_MODEL_OVERRIDE`, and `AUTO_QUEUE` are all in the CONFIG block.

## Notes
- `.doublespeed-tokens.json` holds your refresh token — it's gitignored. Don't commit it.
- The refresh token lasts ~90 days and auto-renews; re-run `npm run auth` only if it's revoked.
- `AUTO_QUEUE=false` (default) leaves a **draft** for review — nothing is posted.
