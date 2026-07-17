import type { DashboardSnapshot, DemoRecord } from './twelvelabs-visual-demo';

export interface TwelveLabsDashboardHtmlOptions {
  siteNavigation?: boolean;
}

export function buildTwelveLabsDashboardHtml(
  snapshot: DashboardSnapshot,
  options: TwelveLabsDashboardHtmlOptions = {},
): string {
  const serialized = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  const siteNavigation = options.siteNavigation
    ? `<button class="site-menu-button" type="button" aria-expanded="false" aria-controls="siteNavigation">Menu</button>
      <nav class="site-navigation" id="siteNavigation" aria-label="Primary">
        <a href="/" data-site-route="library">Library</a>
        <a href="/benchmarks" data-site-route="benchmarks">Benchmarks</a>
        <a href="/ask" data-site-route="ask">Ask</a>
        <a href="/work" data-site-route="work">Work</a>
      </nav>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ViralBench — Competitor Creative Research</title>
  <meta name="description" content="Competitor creative research with grounded analysis and explicit evidence limits. This is not owned marketing performance.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='16' fill='%23fcfcfc'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%23050505'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Manrope:wght@400;500;600&family=Space+Grotesk:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      /* Void Agency brand palette; semantic aliases keep dashboard code readable. */
      --void-black: #050505;
      --void-charcoal: #141414;
      --void-slate: #333333;
      --void-gray: #666666;
      --void-silver: #999999;
      --void-mist: #cccccc;
      --void-ash: #e6e6e6;
      --void-pearl: #f3f3f3;
      --void-paper: #fcfcfc;
      --void-white: #ffffff;
      --void-sage: #8b9b87;
      --void-sage-dark: #6d7d69;
      --void-accent-subtle: rgba(139, 155, 135, 0.08);
      --bg: var(--void-paper);
      --surface: var(--void-white);
      --surface-2: var(--void-pearl);
      --surface-3: var(--void-ash);
      --line: #e8e8e8;
      --line-soft: #f0f0f0;
      --text: var(--void-black);
      --muted: var(--void-gray);
      --dim: var(--void-silver);
      --lime: var(--void-sage-dark);
      --cyan: var(--void-black);
      --violet: var(--void-sage);
      --amber: var(--void-charcoal);
      --danger: var(--void-charcoal);
      --radius: 8px;
      --serif: "Cormorant Garamond", Georgia, serif;
      --ui: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: "Space Grotesk", "SFMono-Regular", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    html, body { margin: 0; min-height: 100%; color: var(--text); font-family: var(--ui); }
    body { overflow-x: hidden; background: var(--bg); }
    button, input, select, a { font: inherit; }
    button, select { color: inherit; }
    button:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible, a:focus-visible {
      outline: 2px solid var(--lime);
      outline-offset: 2px;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 208px minmax(0, 1fr);
      grid-template-rows: 74px minmax(0, 1fr);
    }
    .topbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 0 28px;
      border-bottom: 1px solid var(--line);
      background: rgba(252, 252, 252, .94);
      backdrop-filter: blur(18px);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 176px; }
    .brand-mark {
      display: block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--void-black);
    }
    .brand-mark span { display: none; }
    .brand-name { font: 500 15px/1 var(--mono); letter-spacing: .035em; }
    .top-title { flex: 1; color: var(--muted); font-size: 11px; }
    .top-title strong { color: var(--text); font-weight: 600; }
    .site-nav { display: flex; align-items: center; gap: 7px; }
    .site-nav a {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 11px;
      color: var(--text);
      background: rgba(255, 255, 255, .72);
      font: 9px/1 var(--mono);
      letter-spacing: .06em;
      text-decoration: none;
    }
    .site-nav a:hover,
    .site-nav a[aria-current="page"] { border-color: var(--void-black); background: var(--void-black); color: var(--void-white); }
    .live-state {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      color: var(--muted);
      font: 10px/1.25 var(--mono);
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .live-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--lime);
      box-shadow: 0 0 0 4px var(--void-accent-subtle);
    }
    .live-state.refreshing .live-dot { background: var(--cyan); }
    .live-state.stale .live-dot { background: var(--amber); }
    .live-state.offline .live-dot { background: var(--danger); }
    .refresh-button, .clear-button {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 6px;
      cursor: pointer;
      color: var(--text);
      font: 10px/1 var(--mono);
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .refresh-button { padding: 9px 11px; }
    .refresh-button:hover, .clear-button:hover { border-color: var(--muted); }
    .refresh-button:disabled { cursor: wait; color: var(--dim); }
    .sources {
      grid-column: 1;
      grid-row: 2;
      min-height: 0;
      height: calc(100vh - 74px);
      position: sticky;
      top: 74px;
      overflow: auto;
      border-right: 1px solid var(--line);
      padding: 18px 12px 24px;
      background: #f6f6f6;
    }
    .rail-heading {
      margin: 0 10px 7px;
      color: var(--dim);
      font: 10px/1.2 var(--mono);
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .rail-count {
      margin: 0 10px 14px;
      color: var(--muted);
      font: 10px/1.4 var(--mono);
    }
    .rail-empty {
      margin: 16px 10px 0;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.55;
    }
    .source {
      width: 100%;
      display: grid;
      grid-template-columns: 29px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      padding: 11px 9px;
      border: 0;
      border-left: 2px solid transparent;
      border-radius: 0 7px 7px 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .source:hover { background: var(--surface); }
    .source.active { background: var(--surface-2); border-left-color: var(--lime); }
    .source-rank { color: var(--dim); font: 11px/1 var(--mono); }
    .source.active .source-rank { color: var(--lime); }
    .source-name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 620;
    }
    .source-meta { margin-top: 4px; color: var(--dim); font: 10px/1.2 var(--mono); }
    .content { grid-column: 2; grid-row: 2; min-width: 0; }
    .overview { padding: 28px 28px 30px; }
    .overview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
      padding-bottom: 17px;
      border-bottom: 1px solid var(--line);
    }
    .overview-head h1 {
      margin: 0;
      font-family: var(--serif);
      font-size: clamp(26px, 3vw, 44px);
      line-height: 1;
      letter-spacing: -.045em;
      font-weight: 300;
    }
    .dashboard-scope {
      margin: 8px 0 0;
      color: var(--muted);
      font: 9px/1.45 var(--mono);
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .overview-actions { display: flex; align-items: center; justify-content: flex-end; gap: 13px; }
    .snapshot-meta { text-align: right; color: var(--dim); font: 9px/1.55 var(--mono); white-space: nowrap; }
    .text-action, .primary-action, .dialog-close {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font: 9px/1 var(--mono);
      letter-spacing: .065em;
      text-transform: uppercase;
    }
    .text-action { padding: 9px 11px; }
    .primary-action { padding: 11px 14px; border-color: var(--void-black); background: var(--void-black); color: var(--void-white); }
    .text-action:hover, .dialog-close:hover { border-color: var(--void-black); }
    .primary-action:hover { background: var(--void-sage-dark); border-color: var(--void-sage-dark); }
    .filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.35fr) repeat(4, minmax(124px, .62fr)) auto;
      gap: 10px;
      align-items: end;
      padding: 14px 0;
    }
    .filter-label {
      display: block;
      margin-bottom: 7px;
      color: var(--dim);
      font: 9px/1 var(--mono);
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    .filter-control {
      width: 100%;
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      padding: 0 11px;
      font-size: 11px;
    }
    input.filter-control::placeholder { color: var(--dim); }
    .clear-button { height: 38px; padding: 0 13px; }
    .filter-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      min-height: 35px;
      padding: 10px 0;
      border-top: 1px solid var(--line-soft);
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font: 9px/1.45 var(--mono);
    }
    .filter-status strong { color: var(--text); font-weight: 500; }
    .filter-hint { color: var(--dim); text-align: right; }
    .kpis {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      margin-top: 0;
      border-bottom: 1px solid var(--line);
    }
    .kpi { min-width: 0; padding: 18px 18px 17px; border-right: 1px solid var(--line); }
    .kpi:first-child { padding-left: 0; }
    .kpi:last-child { border-right: 0; }
    .kpi-value {
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text);
      font: 24px/1 var(--mono);
      letter-spacing: -.045em;
    }
    .kpi-value.accent { color: var(--lime); }
    .kpi-label { margin-top: 9px; color: var(--muted); font-size: 10px; }
    .kpi-note { margin-top: 5px; color: var(--dim); font: 8px/1.35 var(--mono); }
    .primary-visual-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(310px, .75fr);
      margin-top: 28px;
      border-bottom: 1px solid var(--line);
    }
    .visual-stage {
      display: grid;
      grid-template-columns: minmax(180px, 230px) minmax(0, 1fr);
      gap: 24px;
      align-items: stretch;
      min-height: 390px;
      padding: 0 27px 28px 0;
      border-right: 1px solid var(--line);
    }
    .semantic-playback { display: contents; }
    .stage-media {
      position: relative;
      width: min(100%, 226px);
      aspect-ratio: 9 / 16;
      justify-self: center;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #000;
    }
    .stage-media video { display: block; width: 100%; height: 100%; object-fit: cover; background: #000; }
    .live-semantic,
    .semantic-walkthrough { display: none; }
    .live-semantic {
      min-width: 0;
      color: var(--text);
    }
    .live-semantic-head,
    .semantic-walkthrough-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--dim);
      font: 8px/1 var(--mono);
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    .live-semantic-head time {
      color: var(--text);
      font-size: 9px;
      letter-spacing: .03em;
    }
    .live-semantic-progress {
      height: 2px;
      margin-top: 11px;
      overflow: hidden;
      background: var(--line);
    }
    .live-semantic-progress span {
      display: block;
      width: 0;
      height: 100%;
      background: var(--void-sage-dark);
      transition: width 120ms linear;
    }
    .semantic-inference {
      padding: 17px 0 16px;
      border-bottom: 1px solid var(--line);
    }
    .semantic-inference span,
    .semantic-channel > span {
      display: block;
      color: var(--dim);
      font: 8px/1 var(--mono);
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    .semantic-inference strong {
      display: block;
      margin-top: 8px;
      font-family: var(--serif);
      font-size: 22px;
      font-weight: 300;
      letter-spacing: -.025em;
      line-height: 1.02;
    }
    .semantic-channel {
      padding: 12px 0 11px;
      border-bottom: 1px solid var(--line-soft);
    }
    .semantic-channel strong {
      display: block;
      margin-top: 7px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.42;
    }
    .semantic-channel small {
      display: block;
      margin-top: 5px;
      color: var(--dim);
      font: 9px/1.45 var(--mono);
    }
    .stage-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      justify-content: center;
      padding: 15px 0;
    }
    .stage-eyebrow {
      margin: 0 0 13px;
      color: var(--lime);
      font: 9px/1 var(--mono);
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .stage-copy h2 {
      max-width: 850px;
      margin: 0;
      font-family: var(--serif);
      font-size: clamp(30px, 4.2vw, 58px);
      font-weight: 300;
      letter-spacing: -.045em;
      line-height: .98;
      text-wrap: balance;
    }
    .stage-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin-top: 18px;
      color: var(--muted);
      font-size: 11px;
    }
    .stage-meta strong { color: var(--text); font-weight: 600; }
    .stage-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      max-width: 720px;
      margin-top: 25px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .stage-metric { min-width: 0; padding: 15px 15px 14px 0; }
    .stage-metric + .stage-metric { padding-left: 15px; border-left: 1px solid var(--line); }
    .stage-metric strong { display: block; font: 18px/1 var(--mono); font-weight: 400; }
    .stage-metric span { display: block; margin-top: 7px; color: var(--dim); font: 8px/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .stage-actions { display: flex; align-items: center; gap: 14px; margin-top: 23px; }
    .stage-evidence {
      color: var(--dim);
      font: 9px/1.45 var(--mono);
    }
    .semantic-walkthrough {
      margin-top: 22px;
      padding-top: 17px;
      border-top: 1px solid var(--line);
    }
    .semantic-walkthrough-head small {
      color: var(--dim);
      font-size: 8px;
      letter-spacing: .03em;
      text-transform: none;
    }
    .semantic-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 11px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .semantic-step {
      min-width: 0;
      padding: 11px 10px;
      border: 0;
      border-right: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      text-align: left;
    }
    .semantic-step:last-child { border-right: 0; }
    .semantic-step:hover,
    .semantic-step.active {
      background: var(--surface-2);
      color: var(--text);
    }
    .semantic-step span {
      display: block;
      color: var(--void-sage-dark);
      font: 8px/1 var(--mono);
      letter-spacing: .07em;
      text-transform: uppercase;
    }
    .semantic-step strong {
      display: block;
      margin-top: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 600;
    }
    .primary-rank-panel { min-width: 0; padding: 3px 0 28px 27px; }
    .primary-rank-panel .panel-head { display: block; }
    .primary-rank-panel .panel-key { margin-top: 7px; text-align: left; }
    .primary-rank-panel .ranking-chart { gap: 7px; }
    .primary-rank-panel .rank-row { grid-template-columns: minmax(92px, 125px) minmax(70px, 1fr) 67px; gap: 8px; }
    .primary-rank-panel .rank-row:nth-child(n+8) { display: none; }
    .coverage-strip {
      display: grid;
      grid-template-columns: minmax(190px, .65fr) minmax(0, 1fr) minmax(0, 1fr);
      gap: 28px;
      align-items: start;
      padding: 24px 0 26px;
      border-bottom: 1px solid var(--line);
    }
    .coverage-strip .panel-head { margin: 0; }
    .coverage-strip .breakdown + .breakdown { margin: 0; padding: 0; border-top: 0; }
    .dashboard-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(290px, .75fr);
      gap: 30px;
      padding-top: 28px;
    }
    .panel { min-width: 0; }
    .panel + .panel { border-left: 1px solid var(--line); padding-left: 28px; }
    .panel-head { display: flex; align-items: start; justify-content: space-between; gap: 18px; margin-bottom: 19px; }
    .panel h2, .table-section h2, .workspace h2, .inspector h2 {
      margin: 0;
      font-family: var(--serif);
      font-size: 24px;
      letter-spacing: -.015em;
      font-weight: 300;
    }
    .panel-copy, .table-copy, .empty-note {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.45;
    }
    .panel-key { color: var(--dim); font: 9px/1.35 var(--mono); text-align: right; }
    .synthesis-section {
      margin-top: 30px;
      padding: 27px 0 29px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .synthesis-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 24px;
    }
    .synthesis-head h2, .synthesis-panel h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
      letter-spacing: -.015em;
      font-weight: 630;
    }
    .synthesis-head p {
      max-width: 720px;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.55;
    }
    .synthesis-sample {
      color: var(--dim);
      font: 9px/1.5 var(--mono);
      text-align: right;
      white-space: nowrap;
    }
    .finding-grid {
      margin-top: 20px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .finding-card {
      display: grid;
      grid-template-columns: 140px minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
      min-width: 0;
      padding: 16px 0;
      border-bottom: 1px solid var(--line-soft);
      background: transparent;
    }
    .finding-card:last-child { border-bottom: 0; }
    .finding-meta {
      color: var(--dim);
      font: 9px/1 var(--mono);
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .finding-confidence { display: block; margin-top: 6px; color: var(--lime); }
    .finding-coverage { display: block; margin-top: 6px; color: var(--muted); }
    .finding-card h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.35;
      letter-spacing: -.018em;
      font-weight: 620;
    }
    .finding-card .text-action { white-space: nowrap; }
    .synthesis-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 28px;
      margin-top: 25px;
    }
    .synthesis-panel { min-width: 0; }
    .synthesis-panel-copy {
      margin: 7px 0 14px;
      color: var(--dim);
      font-size: 10px;
      line-height: 1.5;
    }
    .synthesis-row {
      display: grid;
      grid-template-columns: minmax(110px, 1fr) 70px 80px;
      gap: 10px;
      align-items: center;
      min-height: 39px;
      border-top: 1px solid var(--line-soft);
      font-size: 10px;
    }
    .synthesis-row:last-child { border-bottom: 1px solid var(--line-soft); }
    .synthesis-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .synthesis-row-value, .synthesis-row-state {
      color: var(--muted);
      font: 9px/1.3 var(--mono);
      text-align: right;
    }
    .synthesis-row-state.positive { color: var(--lime); }
    .synthesis-row-state.negative { color: var(--amber); }
    .synthesis-row-sensitivity {
      grid-column: 1 / -1;
      padding: 0 0 9px;
      color: var(--dim);
      font: 8px/1.45 var(--mono);
    }
    .sensitivity-label { margin-right: 5px; color: var(--lime); text-transform: uppercase; letter-spacing: .06em; }
    .sensitivity-platform { display: block; margin-top: 3px; }
    .sensitivity-sensitive { color: var(--amber); }
    .ranking-chart { display: grid; gap: 8px; }
    .rank-row {
      display: grid;
      grid-template-columns: minmax(120px, 160px) minmax(130px, 1fr) 86px;
      gap: 12px;
      align-items: center;
      min-height: 28px;
    }
    .rank-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--void-slate);
      font-size: 10px;
    }
    .rank-name span { display: block; margin-top: 3px; color: var(--dim); font: 8px/1 var(--mono); }
    .rank-track { position: relative; height: 7px; background: var(--surface-3); overflow: hidden; }
    .rank-fill { height: 100%; min-width: 4px; background: var(--lime); }
    .rank-fill.instagram { background: var(--violet); }
    .rank-fill.youtube_shorts { background: var(--cyan); }
    .rank-value { text-align: right; color: var(--text); font: 9px/1.25 var(--mono); }
    .rank-value span { display: block; margin-top: 3px; color: var(--dim); }
    .breakdown + .breakdown { margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--line-soft); }
    .breakdown-title { margin-bottom: 12px; color: var(--muted); font-size: 11px; font-weight: 620; }
    .breakdown-row {
      display: grid;
      grid-template-columns: 104px minmax(80px, 1fr) 72px;
      gap: 10px;
      align-items: center;
      margin-top: 10px;
    }
    .breakdown-name { color: var(--void-slate); font-size: 10px; }
    .breakdown-track { height: 5px; background: var(--surface-3); }
    .breakdown-fill { height: 100%; background: var(--cyan); }
    .breakdown-fill.attribution { background: var(--amber); }
    .breakdown-value { text-align: right; color: var(--dim); font: 8px/1.25 var(--mono); }
    .table-section { margin-top: 31px; padding-top: 25px; border-top: 1px solid var(--line); }
    .table-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 15px; }
    .result-count { color: var(--dim); font: 9px/1.4 var(--mono); text-align: right; }
    .table-wrap { overflow-x: auto; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    table { width: 100%; min-width: 940px; border-collapse: collapse; table-layout: fixed; }
    th {
      padding: 11px 9px;
      color: var(--dim);
      font: 8px/1 var(--mono);
      letter-spacing: .08em;
      text-align: left;
      text-transform: uppercase;
      border-bottom: 1px solid var(--line);
    }
    th button {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      cursor: pointer;
    }
    th button:hover { color: var(--text); }
    th button.active { color: var(--text); }
    th button.active::after {
      margin-left: 5px;
      color: var(--lime);
      content: attr(data-indicator);
    }
    td {
      padding: 12px 9px;
      color: var(--void-slate);
      font-size: 10px;
      line-height: 1.35;
      border-bottom: 1px solid var(--line-soft);
      vertical-align: middle;
    }
    tbody tr { cursor: pointer; transition: background 120ms ease; }
    tbody tr:hover, tbody tr.active { background: var(--surface-2); }
    tbody tr.active td:first-child { box-shadow: inset 2px 0 0 var(--lime); color: var(--lime); }
    tbody tr.empty-table { cursor: default; }
    tbody tr.empty-table:hover { background: transparent; }
    tbody tr.empty-table td {
      padding: 26px 9px;
      color: var(--muted);
      font-size: 11px;
      text-align: center;
    }
    .table-video { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 620; }
    .table-sub { display: block; margin-top: 4px; color: var(--dim); font: 8px/1.2 var(--mono); font-weight: 400; }
    .paid-flag { color: var(--amber); }
    .known-company { color: var(--lime); }
    .number { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .evidence-note {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-top: 13px;
      color: var(--dim);
      font: 8px/1.45 var(--mono);
    }
    .detail-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      border-top: 1px solid var(--line);
      scroll-margin-top: 74px;
    }
    [hidden] { display: none !important; }
    .workspace { min-width: 0; padding: 26px 28px 34px; overflow: hidden; }
    .detail-heading {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: baseline;
      margin-bottom: 20px;
    }
    .detail-heading p { margin: 0; color: var(--dim); font: 9px/1.4 var(--mono); }
    .hero {
      display: grid;
      grid-template-columns: minmax(220px, 296px) minmax(300px, 1fr);
      gap: 27px;
      align-items: start;
    }
    .video-frame {
      position: relative;
      overflow: hidden;
      aspect-ratio: 9 / 16;
      max-height: 56vh;
      justify-self: center;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #000;
      box-shadow: 0 24px 70px rgba(0, 0, 0, .32);
    }
    video { display: block; width: 100%; height: 100%; object-fit: cover; background: #000; }
    .rank-flag {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 6px 8px;
      border-radius: 5px;
      background: rgba(5, 5, 5, .86);
      backdrop-filter: blur(8px);
      color: var(--void-white);
      font: 10px/1 var(--mono);
      pointer-events: none;
    }
    .narrative { padding-top: 3px; }
    .narrative h3 {
      margin: 0;
      max-width: 730px;
      font-size: clamp(28px, 3.25vw, 50px);
      line-height: 1.03;
      letter-spacing: -.045em;
      font-weight: 660;
      text-wrap: balance;
    }
    .identity-line { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 17px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .identity-company { color: var(--text); }
    .identity-language { color: var(--lime); font: 11px/1 var(--mono); text-transform: uppercase; }
    .identity-paid { color: var(--muted); font: 11px/1 var(--mono); text-transform: uppercase; }
    .identity-paid.paid { color: var(--amber); }
    .identity-paid.clear { color: var(--lime); }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--line); }
    .metric-value { font: 19px/1 var(--mono); }
    .metric-value.good { color: var(--lime); }
    .metric-value.missing { color: var(--dim); }
    .metric-label { margin-top: 7px; color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .09em; text-transform: uppercase; }
    .metric-note { grid-column: 1 / -1; margin-top: 2px; color: var(--dim); font: 9px/1.45 var(--mono); }
    .now-inspecting { margin-top: 27px; padding-top: 17px; border-top: 1px solid var(--line-soft); }
    .inspect-label { color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .inspect-time { margin-left: 8px; color: var(--lime); }
    .inspect-copy { margin-top: 9px; color: var(--text); font-size: 13px; line-height: 1.52; }
    .timeline { margin-top: 28px; padding-top: 21px; border-top: 1px solid var(--line); }
    .timeline-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    .timeline-head p { margin: 0; color: var(--dim); font: 10px/1.3 var(--mono); }
    .axis { position: relative; height: 18px; margin-left: 76px; border-bottom: 1px solid var(--line-soft); }
    .tick { position: absolute; bottom: 3px; color: var(--dim); font: 8px/1 var(--mono); transform: translateX(-50%); }
    .lane { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 8px; margin-top: 12px; align-items: center; }
    .lane-label { color: var(--muted); font: 9px/1 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
    .lane-track { position: relative; height: 34px; overflow: hidden; border: 1px solid var(--line-soft); background: var(--void-white); }
    .segment {
      position: absolute;
      top: 3px;
      bottom: 3px;
      min-width: 3px;
      border: 0;
      border-right: 1px solid rgba(255, 255, 255, .42);
      cursor: pointer;
      opacity: .78;
      transition: opacity 120ms ease, transform 120ms ease, filter 120ms ease;
    }
    .segment:hover, .segment.active { opacity: 1; filter: brightness(1.14); transform: translateY(-1px); }
    .segment.visual { background: var(--cyan); }
    .segment.audio { background: var(--violet); }
    .segment.editing { background: var(--amber); }
    .playhead { position: absolute; inset: 0 auto 0 0; width: 1px; z-index: 5; background: var(--void-black); box-shadow: none; pointer-events: none; }
    .inspector { min-width: 0; padding: 26px 22px 34px; border-left: 1px solid var(--line); background: #f6f6f6; }
    .structure { margin-top: 18px; }
    .structure-row { padding: 14px 0; border-top: 1px solid var(--line-soft); }
    .structure-label { color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .structure-copy { margin-top: 7px; color: var(--void-slate); font-size: 12px; line-height: 1.5; }
    .cta { color: var(--lime); }
    .claims { margin-top: 20px; }
    .claim { padding: 11px 0 11px 13px; border-left: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.45; }
    .claim + .claim { margin-top: 8px; }
    .claim-status { display: block; margin-top: 5px; color: var(--dim); font: 8px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .source-link { display: inline-flex; margin-top: 22px; padding-bottom: 3px; border-bottom: 1px solid var(--lime); color: var(--text); text-decoration: none; font-size: 11px; }
    .context-value { margin-top: 7px; color: var(--void-slate); font-size: 12px; line-height: 1.5; }
    .context-value.paid { color: var(--amber); }
    .context-value.clear { color: var(--lime); }
    .context-basis { display: block; margin-top: 4px; color: var(--dim); font: 9px/1.4 var(--mono); }
    .inspector-section { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
    .empty-results { padding: 28px 0; color: var(--muted); font-size: 12px; }
    body.modal-open { overflow: hidden; }
    dialog {
      width: min(760px, calc(100vw - 40px));
      max-height: min(86vh, 920px);
      margin: auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--void-paper);
      color: var(--text);
      box-shadow: 0 24px 90px rgba(0, 0, 0, .18);
    }
    dialog::backdrop { background: rgba(5, 5, 5, .46); backdrop-filter: blur(3px); }
    .analysis-dialog { width: min(1180px, calc(100vw - 40px)); }
    .analysis-dialog.mode-compact { width: min(760px, calc(100vw - 40px)); }
    .dialog-frame { display: flex; max-height: inherit; flex-direction: column; }
    .dialog-head {
      position: sticky;
      top: 0;
      z-index: 8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 15px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(252, 252, 252, .96);
    }
    .dialog-kicker { color: var(--lime); font: 9px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .dialog-head h2 {
      margin: 4px 0 0;
      font-family: var(--serif);
      font-size: 25px;
      font-weight: 300;
      letter-spacing: -.025em;
      line-height: 1;
    }
    .dialog-close { flex: 0 0 auto; padding: 9px 11px; }
    .dialog-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .dialog-content { padding: 25px 26px 30px; }
    .dialog-lead { margin: 0; color: var(--text); font-size: 15px; font-weight: 600; line-height: 1.55; }
    .dialog-section { margin-top: 23px; padding-top: 18px; border-top: 1px solid var(--line); }
    .dialog-section h3 { margin: 0; font-size: 11px; letter-spacing: .02em; }
    .dialog-section p, .dialog-section li { color: var(--muted); font-size: 11px; line-height: 1.65; }
    .dialog-section ul { margin: 10px 0 0; padding-left: 18px; }
    .dialog-method-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 24px;
    }
    .method-stat {
      padding: 14px 0;
      border-top: 1px solid var(--line-soft);
    }
    .method-stat span { display: block; color: var(--dim); font: 8px/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .method-stat strong { display: block; margin-top: 7px; font-size: 12px; font-weight: 600; }
    .method-range {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(0, 1.4fr);
      gap: 16px;
      padding: 11px 0;
      border-top: 1px solid var(--line-soft);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.5;
    }
    .method-range strong { color: var(--text); font-weight: 600; }
    .analysis-dialog .detail-shell { border-top: 0; }
    .analysis-dialog .workspace { padding-top: 22px; }
    .analysis-dialog .hero { grid-template-columns: minmax(190px, 235px) minmax(280px, 1fr); }
    .analysis-dialog .video-frame { max-height: 48vh; }
    .analysis-dialog .narrative h3 { font-family: var(--serif); font-weight: 300; }
    .analysis-dialog .detail-heading { display: none; }
    @media (max-width: 1180px) {
      .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .kpi:nth-child(3) { border-right: 0; }
      .kpi:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
      .kpi:nth-child(4) { padding-left: 0; }
      .filters { grid-template-columns: minmax(200px, 1fr) repeat(2, minmax(128px, .65fr)); }
      .clear-button { grid-column: 3; }
      .primary-visual-grid { grid-template-columns: minmax(0, 1.25fr) minmax(270px, .75fr); }
      .visual-stage { grid-template-columns: 180px minmax(0, 1fr); }
      .stage-copy h2 { font-size: clamp(29px, 3.6vw, 45px); }
      .stage-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stage-metric:nth-child(3) { border-left: 0; border-top: 1px solid var(--line); padding-left: 0; }
      .stage-metric:nth-child(4) { border-top: 1px solid var(--line); }
      .detail-shell { grid-template-columns: minmax(0, 1fr); }
      .inspector { border-left: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 28px; }
      .structure { margin-top: 0; }
    }
    @media (max-width: 900px) {
      .app { grid-template-columns: 184px minmax(0, 1fr); }
      .brand { min-width: 162px; }
      .top-title { display: none; }
      .site-nav { margin-left: auto; }
      .site-nav a:nth-child(4) { display: none; }
      .overview { padding: 24px 22px 28px; }
      .primary-visual-grid { grid-template-columns: 1fr; }
      .visual-stage { border-right: 0; }
      .primary-rank-panel { padding: 25px 0 28px; border-top: 1px solid var(--line); }
      .coverage-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .coverage-strip .panel-head { grid-column: 1 / -1; }
      .coverage-strip .breakdown { min-width: 0; }
      .dashboard-grid { grid-template-columns: 1fr; }
      .panel + .panel { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--line); }
      .synthesis-grid { grid-template-columns: 1fr; }
      .hero { grid-template-columns: 180px minmax(260px, 1fr); }
    }
    @media (max-width: 700px) {
      .app { display: block; }
      .topbar { height: 60px; padding: 0 14px; gap: 12px; }
      .brand { min-width: auto; }
      .brand-name { display: inline; font-size: 13px; }
      .site-nav { display: none; }
      .live-state { margin-left: auto; }
      .live-copy { display: none; }
      .refresh-button { padding: 8px 9px; }
      .sources {
        position: static;
        width: 100%;
        height: 94px;
        padding: 9px 10px;
        overflow: hidden;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      .rail-heading, .rail-count { display: none; }
      #sourceList { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
      #sourceList::-webkit-scrollbar { display: none; }
      .source { min-width: 168px; }
      .overview { padding: 22px 16px 26px; }
      .overview-head { display: block; }
      .overview-head h1 { font-size: 30px; }
      .overview-actions { margin-top: 13px; justify-content: space-between; }
      .snapshot-meta { text-align: left; white-space: normal; }
      .filters { grid-template-columns: 1fr 1fr; }
      .filters > :first-child { grid-column: 1 / -1; }
      .clear-button { grid-column: 1 / -1; }
      .filter-status { display: block; }
      .filter-status > * { display: block; }
      .filter-hint { margin-top: 4px; text-align: left; }
      .kpis { display: flex; overflow-x: auto; scrollbar-width: none; }
      .kpi { min-width: 142px; border-bottom: 0 !important; }
      .kpi:first-child, .kpi:nth-child(4) { padding-left: 18px; }
      .primary-visual-grid { margin-top: 22px; }
      .visual-stage { grid-template-columns: 116px minmax(0, 1fr); min-height: 250px; gap: 16px; padding-bottom: 22px; }
      .stage-media { width: 116px; }
      .stage-copy { padding: 0; }
      .stage-copy h2 { font-size: 26px; }
      .stage-eyebrow { margin-bottom: 9px; }
      .stage-meta { margin-top: 12px; gap: 5px 10px; font-size: 9px; }
      .stage-metrics { margin-top: 14px; }
      .stage-metric { padding: 10px 9px 9px 0; }
      .stage-metric + .stage-metric { padding-left: 9px; }
      .stage-metric strong { font-size: 13px; }
      .stage-actions { align-items: flex-start; flex-direction: column; gap: 8px; margin-top: 14px; }
      .primary-action { padding: 10px 12px; }
      .coverage-strip { grid-template-columns: 1fr; gap: 22px; }
      .coverage-strip .panel-head { grid-column: auto; }
      .dashboard-grid { padding-top: 24px; }
      .synthesis-head { display: block; }
      .synthesis-sample { margin-top: 12px; text-align: left; }
      .finding-card { grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 16px 0; }
      .finding-meta { grid-column: 1 / -1; }
      .finding-card:last-child { border-bottom: 0; }
      .synthesis-row { grid-template-columns: minmax(90px, 1fr) 62px 72px; }
      .rank-row { grid-template-columns: 98px minmax(80px, 1fr) 72px; gap: 8px; }
      .table-head, .evidence-note { display: block; }
      .result-count, .evidence-note span + span { margin-top: 7px; text-align: left; }
      .workspace { padding: 22px 16px 28px; }
      .detail-heading { display: block; }
      .detail-heading p { margin-top: 7px; }
      .hero { grid-template-columns: 116px minmax(0, 1fr); gap: 16px; }
      .video-frame { max-height: 38vh; border-radius: 8px; }
      .narrative h3 { font-size: 24px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; padding-top: 14px; }
      .metric-value { font-size: 14px; }
      .now-inspecting { margin-top: 16px; }
      .axis { margin-left: 58px; }
      .lane { grid-template-columns: 50px minmax(0, 1fr); }
      .inspector { display: block; padding: 22px 16px 30px; }
      dialog,
      .analysis-dialog,
      .analysis-dialog.mode-analysis,
      .analysis-dialog.mode-compact {
        width: 100vw;
        max-width: none;
        max-height: 100dvh;
        margin: auto 0 0;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: 8px 8px 0 0;
      }
      .dialog-frame { height: min(92dvh, 920px); }
      .dialog-content { padding: 22px 18px 28px; }
      .dialog-method-grid { grid-template-columns: 1fr; }
      .analysis-dialog .detail-shell { display: block; }
      .analysis-dialog .workspace, .analysis-dialog .inspector { padding: 20px 16px 26px; }
      .analysis-dialog .hero { grid-template-columns: 110px minmax(0, 1fr); gap: 14px; }
      .analysis-dialog .narrative h3 { font-size: 23px; }
    }
    @media (min-width: 901px) {
      .app {
        grid-template-columns: minmax(0, 1fr);
      }
      .sources {
        display: none;
      }
      .content {
        grid-column: 1;
      }
      .overview {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(330px, 380px);
        column-gap: 28px;
        align-items: start;
      }
      .overview-head,
      .filters,
      .filter-status,
      .kpis,
      .coverage-strip,
      .synthesis-section,
      .table-section {
        grid-column: 1;
      }
      .overview-head { grid-row: 1; }
      .filters { grid-row: 2; }
      .filter-status { grid-row: 3; }
      .kpis { grid-row: 4; }
      .coverage-strip { grid-row: 6; }
      .synthesis-section { grid-row: 7; }
      .table-section { grid-row: 8; }
      .primary-visual-grid {
        display: contents;
      }
      .visual-stage {
        grid-column: 2;
        grid-row: 1 / 9;
        position: sticky;
        top: 101px;
        align-self: start;
        display: flex;
        flex-direction: column;
        gap: 20px;
        min-height: 0;
        max-height: calc(100vh - 128px);
        overflow-y: auto;
        padding: 0 0 28px 28px;
        border-right: 0;
        border-left: 1px solid var(--line);
        scrollbar-width: thin;
        scrollbar-color: var(--line) transparent;
      }
      .semantic-playback {
        display: block;
      }
      .live-semantic,
      .semantic-walkthrough {
        display: block;
      }
      .live-semantic {
        margin-top: 19px;
      }
      .stage-media {
        width: min(100%, 238px);
        justify-self: auto;
        align-self: start;
      }
      .stage-copy {
        display: block;
        padding: 0;
      }
      .stage-eyebrow {
        margin-bottom: 11px;
      }
      .stage-copy h2 {
        max-width: 330px;
        font-size: clamp(30px, 2.45vw, 38px);
        line-height: 1;
      }
      .stage-meta {
        gap: 7px 12px;
        margin-top: 15px;
        font-size: 10px;
      }
      .stage-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 19px;
      }
      .stage-metric {
        padding: 12px 11px 11px 0;
      }
      .stage-metric + .stage-metric {
        padding-left: 11px;
      }
      .stage-metric:nth-child(3) {
        padding-left: 0;
        border-top: 1px solid var(--line);
        border-left: 0;
      }
      .stage-metric:nth-child(4) {
        border-top: 1px solid var(--line);
      }
      .stage-actions {
        align-items: flex-start;
        flex-direction: column;
        gap: 9px;
        margin-top: 18px;
      }
      .primary-rank-panel {
        grid-column: 1;
        grid-row: 5;
        padding: 28px 0 30px;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
      }
      .primary-rank-panel .panel-head {
        display: flex;
      }
      .primary-rank-panel .panel-key {
        margin-top: 0;
        text-align: right;
      }
      .primary-rank-panel .rank-row {
        grid-template-columns: minmax(126px, 170px) minmax(100px, 1fr) 78px;
      }
    }
    @media (min-width: 1181px) {
      .overview {
        grid-template-columns: minmax(0, 1fr) minmax(520px, 560px);
      }
      .semantic-playback {
        display: grid;
        grid-template-columns: 245px minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      .stage-media {
        width: 245px;
      }
      .live-semantic {
        margin-top: 0;
        padding-left: 22px;
        border-left: 1px solid var(--line);
      }
      .stage-copy h2 {
        max-width: 520px;
      }
      .stage-metrics {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .stage-metric:nth-child(3) {
        padding-left: 11px;
        border-top: 0;
        border-left: 1px solid var(--line);
      }
      .stage-metric:nth-child(4) {
        border-top: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
  <link rel="stylesheet" href="/styles.css">
  <script src="/site-navigation.js" defer></script>
</head>
<body class="dashboard-page">
  <a class="site-skip" href="#main">Skip to main content</a>
  <main class="app" id="main">
    <header class="topbar site-header">
      <a class="site-brand" href="/" aria-label="ViralBench library"><span class="site-brand-dot" aria-hidden="true"></span><span>ViralBench</span></a>
      ${siteNavigation}
    </header>

    <nav class="sources" aria-label="Filtered English winners">
      <p class="rail-heading">Analyzed</p>
      <p class="rail-count" id="railCount"></p>
      <div id="sourceList"></div>
    </nav>

    <div class="content">
      <section class="overview" aria-labelledby="dashboardTitle">
        <div class="overview-head">
          <div>
            <h1 id="dashboardTitle">Competitor research.</h1>
            <p class="dashboard-scope">Competitor creative research — not owned marketing performance.</p>
          </div>
          <div class="overview-actions">
            <div class="live-state" id="liveState" aria-live="polite">
              <span class="live-dot"></span>
              <span class="live-copy" id="liveCopy">Live snapshot</span>
            </div>
            <div class="snapshot-meta">
              <div id="runCount"></div>
              <div id="snapshotDate"></div>
              <div id="checkedAt"></div>
            </div>
            <button class="text-action" id="methodButton" type="button">Method</button>
            <button class="refresh-button" id="refreshButton" type="button">Refresh</button>
          </div>
        </div>

        <div class="filters" aria-label="Dashboard filters">
          <label>
            <span class="filter-label">Search winners</span>
            <input class="filter-control" id="searchInput" type="search" placeholder="Handle, company, hook, or platform" autocomplete="off">
          </label>
          <label>
            <span class="filter-label">Platform</span>
            <select class="filter-control" id="platformFilter">
              <option value="all">All platforms</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube_shorts">YouTube Shorts</option>
            </select>
          </label>
          <label>
            <span class="filter-label">Company</span>
            <select class="filter-control" id="companyFilter">
              <option value="all">All attribution</option>
              <option value="known">Company identified</option>
              <option value="unknown">Creator / unknown</option>
            </select>
          </label>
          <label>
            <span class="filter-label">Paid evidence</span>
            <select class="filter-control" id="paidFilter">
              <option value="all">All paid states</option>
              <option value="paid_flag_observed">Paid flag observed</option>
              <option value="not_marked_paid">Explicitly not marked</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span class="filter-label">Sort ledger</span>
            <select class="filter-control" id="sortSelect">
              <optgroup label="Winner order">
                <option value="rank:asc">Winner rank</option>
                <option value="rank:desc">Winner rank · reverse</option>
              </optgroup>
              <optgroup label="Observed reach">
                <option value="views:desc">Views · high to low</option>
                <option value="views:asc">Views · low to high</option>
                <option value="likes:desc">Likes · high to low</option>
                <option value="likes:asc">Likes · low to high</option>
                <option value="comments:desc">Comments · high to low</option>
                <option value="comments:asc">Comments · low to high</option>
              </optgroup>
              <optgroup label="Visible response">
                <option value="response:desc">Response / 1K · high to low</option>
                <option value="response:asc">Response / 1K · low to high</option>
              </optgroup>
            </select>
          </label>
          <button class="clear-button" id="clearFilters" type="button">Reset</button>
        </div>
        <div class="filter-status" aria-live="polite">
          <strong id="filterSummary"></strong>
          <span class="filter-hint">Handle, company, hook, group, or platform.</span>
        </div>

        <div class="kpis" id="kpis" aria-label="Filtered cohort metrics"></div>

        <div class="primary-visual-grid">
          <section class="visual-stage" id="visualStage" aria-labelledby="stageHeadline">
            <div class="semantic-playback">
              <div class="stage-media">
                <video id="stageVideo" controls playsinline preload="metadata"></video>
                <div class="rank-flag" id="stageRankFlag"></div>
              </div>
              <section class="live-semantic" aria-label="Synchronized semantic analysis">
                <div class="live-semantic-head">
                  <span>Live semantic read</span>
                  <time id="liveSemanticTime">0.0s</time>
                </div>
                <div class="live-semantic-progress" id="liveSemanticProgress" role="progressbar" aria-label="Video analysis progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                  <span></span>
                </div>
                <div class="semantic-inference">
                  <span>Model interpretation</span>
                  <strong id="semanticInference">Waiting for the selected video.</strong>
                </div>
                <div class="semantic-channel">
                  <span>Seeing</span>
                  <strong id="semanticVisual">Play to inspect visual.</strong>
                  <small id="semanticOnScreenText"></small>
                </div>
                <div class="semantic-channel">
                  <span>Hearing</span>
                  <strong id="semanticAudio">Play to inspect audio.</strong>
                  <small id="semanticDelivery"></small>
                </div>
                <div class="semantic-channel">
                  <span>Editing</span>
                  <strong id="semanticEditing">Play to inspect editing.</strong>
                  <small id="semanticTransition"></small>
                </div>
              </section>
            </div>
            <div class="stage-copy">
              <p class="stage-eyebrow">Selected video</p>
              <h2 id="stageHeadline"></h2>
              <div class="stage-meta" id="stageMeta"></div>
              <div class="stage-metrics" id="stageMetrics"></div>
              <div class="stage-actions">
                <button class="primary-action" id="viewAnalysisButton" type="button">View evidence</button>
                <span class="stage-evidence">Timeline, claims, and limits.</span>
              </div>
              <div class="semantic-walkthrough">
                <div class="semantic-walkthrough-head">
                  <span>Walk the analysis</span>
                  <small>Seek to a semantic beat</small>
                </div>
                <div class="semantic-steps" id="semanticWalkthrough"></div>
              </div>
            </div>
          </section>
          <section class="panel primary-rank-panel" aria-labelledby="rankChartTitle">
            <div class="panel-head">
              <div>
                <h2 id="rankChartTitle">Winner strength</h2>
              </div>
              <div class="panel-key">90P baseline → 100P<br>color = platform</div>
            </div>
            <div class="ranking-chart" id="rankingChart"></div>
          </section>
        </div>

        <section class="coverage-strip" aria-labelledby="coverageTitle">
          <div class="panel-head">
            <div>
              <h2 id="coverageTitle">Coverage</h2>
            </div>
          </div>
          <div class="breakdown">
            <div class="breakdown-title">Platform mix</div>
            <div id="platformBreakdown"></div>
          </div>
          <div class="breakdown">
            <div class="breakdown-title">Evidence status</div>
            <div id="attributionBreakdown"></div>
          </div>
        </section>

        <section class="synthesis-section" id="researchSynthesis" aria-labelledby="researchSynthesisTitle">
          <div class="synthesis-head">
            <div>
              <h2 id="researchSynthesisTitle">Research signals</h2>
            </div>
            <div class="synthesis-sample" id="synthesisSample"></div>
          </div>
          <div class="finding-grid" id="researchFindings"></div>
          <div class="synthesis-grid">
            <section class="synthesis-panel" aria-labelledby="themeDepthTitle">
              <h3 id="themeDepthTitle">Audience depth</h3>
              <div id="themeDepth"></div>
            </section>
            <section class="synthesis-panel" aria-labelledby="contrastTitle">
              <h3 id="contrastTitle">Performance contrasts</h3>
              <div id="researchContrasts"></div>
            </section>
          </div>
        </section>

        <section class="table-section" aria-labelledby="videoTableTitle">
          <div class="table-head">
            <div>
              <h2 id="videoTableTitle">Video performance ledger</h2>
              <p class="table-copy">Select a row.</p>
            </div>
            <div class="result-count" id="resultCount"></div>
          </div>
          <div class="table-wrap">
            <table>
              <colgroup>
                <col style="width:52px"><col style="width:190px"><col style="width:98px"><col style="width:124px">
                <col style="width:122px"><col style="width:88px"><col style="width:82px"><col style="width:76px">
                <col style="width:92px"><col style="width:104px">
              </colgroup>
              <thead>
                <tr>
                  <th><button type="button" data-sort="rank">Rank</button></th>
                  <th>Video</th>
                  <th>Platform</th>
                  <th>Company</th>
                  <th>Paid evidence</th>
                  <th><button type="button" data-sort="views">Views</button></th>
                  <th><button type="button" data-sort="likes">Likes</button></th>
                  <th><button type="button" data-sort="comments">Comments</button></th>
                  <th><button type="button" data-sort="response">Response / 1K</button></th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody id="videoTableBody"></tbody>
            </table>
          </div>
          <div class="evidence-note">
            <span>Response = likes + comments per 1,000 views. Missing metrics are not imputed.</span>
            <span>Refresh: 30s. Last good data stays visible.</span>
          </div>
        </section>
      </section>

    </div>
  </main>

  <dialog class="analysis-dialog mode-analysis" id="detailDialog" aria-labelledby="detailDialogTitle">
    <div class="dialog-frame">
      <header class="dialog-head">
        <div>
          <div class="dialog-kicker" id="detailDialogKicker">Selected winner evidence</div>
          <h2 id="detailDialogTitle">Video evidence</h2>
        </div>
        <button class="dialog-close" type="button" data-close-dialog aria-label="Close dialog">Close</button>
      </header>
      <div class="dialog-scroll">
        <section class="detail-shell" id="analysisPanel" aria-label="Video evidence">
          <section class="workspace">
            <div class="detail-heading">
              <h2>Video evidence</h2>
            </div>
            <div class="hero">
              <div class="video-frame">
                <video id="video" controls playsinline preload="metadata"></video>
                <div class="rank-flag" id="rankFlag"></div>
              </div>
              <div class="narrative">
                <h3 id="headline"></h3>
                <div class="identity-line">
                  <span class="identity-company" id="identityCompany"></span>
                  <span id="identityAccount"></span>
                  <span class="identity-language">English</span>
                  <span class="identity-paid" id="identityPaid"></span>
                </div>
                <div class="metrics" id="metrics"></div>
                <div class="now-inspecting">
                  <div class="inspect-label">Now inspecting <span class="inspect-time" id="inspectTime"></span></div>
                  <div class="inspect-copy" id="inspectCopy">Select a segment.</div>
                </div>
              </div>
            </div>
            <section class="timeline" aria-label="Timestamped evidence">
              <div class="timeline-head">
                <h2>Timeline</h2>
                <p>Select a block to seek.</p>
              </div>
              <div class="axis" id="axis"></div>
              <div id="lanes"></div>
            </section>
          </section>
          <aside class="inspector">
            <div>
              <h2>Context</h2>
            </div>
            <div>
              <div class="structure" id="context"></div>
              <section class="inspector-section">
                <h2>Structure</h2>
                <div class="structure" id="structure"></div>
                <div class="claims" id="claims"></div>
                <div class="dialog-section">
                  <h3>Limits</h3>
                  <ul id="evidenceLimitations"></ul>
                </div>
                <a class="source-link" id="sourceLink" target="_blank" rel="noreferrer">Open public source</a>
              </section>
            </div>
          </aside>
        </section>
        <div class="dialog-content" id="insightPanel" hidden></div>
        <div class="dialog-content" id="methodPanel" hidden>
          <p class="dialog-lead">Within-platform, age-normalized public signals. Descriptive only.</p>
          <div class="dialog-method-grid" id="methodStats"></div>
          <section class="dialog-section">
            <h3>Robustness</h3>
            <div id="methodContrastRanges"></div>
          </section>
          <section class="dialog-section">
            <h3>Contrasts</h3>
            <p>75th-percentile group versus the rest. Leave-one-out tests direction, not causality or precision.</p>
          </section>
          <section class="dialog-section">
            <h3>Limits</h3>
            <p>Local snapshots. Response uses likes + comments per 1,000 views; missing metrics are not imputed. Patterns require owned tests.</p>
          </section>
        </div>
      </div>
    </div>
  </dialog>

  <script>window.__TWELVELABS_EMBEDDED_SNAPSHOT__ = ${serialized};</script>
  <script src="./twelvelabs-dashboard-data.js"></script>
  <script>
    (function () {
      'use strict';
      var snapshot = window.__TWELVELABS_DASHBOARD_SNAPSHOT__ || window.__TWELVELABS_EMBEDDED_SNAPSHOT__;
      var records = snapshot.records.slice();
      var state = {
        activeId: '',
        platform: 'all',
        company: 'all',
        paid: 'all',
        query: '',
        sort: 'rank',
        direction: 'asc'
      };
      var allowedSorts = ['rank', 'views', 'likes', 'comments', 'response'];
      var sortLabels = {
        'rank:asc': 'Winner rank',
        'rank:desc': 'Winner rank · reverse',
        'views:desc': 'Views · high to low',
        'views:asc': 'Views · low to high',
        'likes:desc': 'Likes · high to low',
        'likes:asc': 'Likes · low to high',
        'comments:desc': 'Comments · high to low',
        'comments:asc': 'Comments · low to high',
        'response:desc': 'Response / 1K · high to low',
        'response:asc': 'Response / 1K · low to high'
      };
      var laneSpecs = [
        { id: 'visual_shots', label: 'Visual', className: 'visual' },
        { id: 'audio_beats', label: 'Audio', className: 'audio' },
        { id: 'editing_beats', label: 'Editing', className: 'editing' }
      ];
      var sourceList = document.querySelector('#sourceList');
      var video = document.querySelector('#video');
      var stageVideo = document.querySelector('#stageVideo');
      var lanes = document.querySelector('#lanes');
      var detailDialog = document.querySelector('#detailDialog');
      var analysisPanel = document.querySelector('#analysisPanel');
      var insightPanel = document.querySelector('#insightPanel');
      var methodPanel = document.querySelector('#methodPanel');
      var playheads = [];
      var activeSegment = null;
      var lastDialogTrigger = null;
      var lastSuccessfulCheck = Date.now();

      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char];
        });
      }
      function compactNumber(value) {
        if (value === null || value === undefined) return '—';
        return new Intl.NumberFormat('en-US', {
          notation: value >= 10000 ? 'compact' : 'standard',
          maximumFractionDigits: value >= 1000000 ? 1 : 0
        }).format(value);
      }
      function fullNumber(value) {
        return value === null || value === undefined
          ? 'Not returned by source'
          : new Intl.NumberFormat('en-US').format(value);
      }
      function formatDate(value) {
        return value
          ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
          : 'Unknown';
      }
      function formatTime(value) {
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value));
      }
      function durationLabel(seconds) {
        return seconds < 60
          ? seconds.toFixed(seconds % 1 ? 1 : 0) + 's'
          : Math.floor(seconds / 60) + ':' + String(Math.round(seconds % 60)).padStart(2, '0');
      }
      function firstMetadata(metadata) {
        return Object.values(metadata || {}).filter(Boolean).join(' · ');
      }
      function companyLabel(record) {
        return record.company.name || 'No company identified';
      }
      function videoLabel(record) {
        return record.company.name || '@' + record.account_handle;
      }
      function platformLabel(platform) {
        return platform === 'tiktok' ? 'TikTok'
          : platform === 'youtube_shorts' ? 'YouTube Shorts'
          : platform.charAt(0).toUpperCase() + platform.slice(1);
      }
      function humanLabel(value) {
        var copy = String(value || '').replaceAll('_', ' ');
        return copy ? copy.charAt(0).toUpperCase() + copy.slice(1) : 'Unknown';
      }
      function percent(value) {
        return (Number(value || 0) * 100).toFixed(1) + '%';
      }
      function signedPoints(value) {
        var points = Number(value || 0) * 100;
        return (points > 0 ? '+' : '') + points.toFixed(1) + ' pp';
      }
      function headline(value) {
        var copy = String(value || '').trim();
        if (copy.length <= 150) return copy;
        var firstSentence = copy.match(/^.{25,150}?[.!?](?:\\s|$)/);
        if (firstSentence && firstSentence[0]) return firstSentence[0].trim();
        return copy.slice(0, 147).replace(/\\s+\\S*$/, '') + '…';
      }
      function visibleResponse(record) {
        return (record.metrics.likes || 0) + (record.metrics.comments || 0);
      }
      function responsePerThousand(record) {
        return record.metrics.views ? visibleResponse(record) / record.metrics.views * 1000 : 0;
      }
      function metricMarkup(record, compact) {
        var items = [
          [record.metrics.views, 'views'],
          [record.metrics.likes, 'likes'],
          [record.metrics.comments, 'comments'],
          [responsePerThousand(record), 'response / 1K']
        ];
        return items.map(function (item) {
          var rendered = item[1] === 'response / 1K'
            ? Number(item[0]).toFixed(1)
            : compactNumber(item[0]);
          if (compact) {
            return '<div class="stage-metric"><strong>' + escapeHtml(rendered)
              + '</strong><span>' + escapeHtml(item[1]) + '</span></div>';
          }
          return '<div title="' + escapeHtml(item[1] === 'response / 1K' ? rendered : fullNumber(item[0])) + '">'
            + '<div class="metric-value ' + (item[0] === null ? 'missing' : item[1] === 'views' ? 'good' : '') + '">'
            + escapeHtml(rendered) + '</div><div class="metric-label">' + escapeHtml(item[1]) + '</div></div>';
        }).join('');
      }
      function listMarkup(items) {
        return (items || []).map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
      }
      function openDialog(dialog, trigger) {
        if (!dialog || dialog.open) return;
        lastDialogTrigger = trigger || document.activeElement;
        document.body.classList.add('modal-open');
        dialog.showModal();
        var close = dialog.querySelector('[data-close-dialog]');
        if (close) close.focus();
      }
      function closeDialog(dialog) {
        if (dialog && dialog.open) dialog.close();
      }
      function showDialogPanel(mode, kicker, title, trigger) {
        analysisPanel.hidden = mode !== 'analysis';
        insightPanel.hidden = mode !== 'insight';
        methodPanel.hidden = mode !== 'method';
        detailDialog.classList.toggle('mode-analysis', mode === 'analysis');
        detailDialog.classList.toggle('mode-compact', mode !== 'analysis');
        document.querySelector('#detailDialogKicker').textContent = kicker;
        document.querySelector('#detailDialogTitle').textContent = title;
        openDialog(detailDialog, trigger);
      }
      function openFindingDialog(finding, trigger) {
        insightPanel.innerHTML =
          '<p class="dialog-lead">' + escapeHtml(finding.conclusion) + '</p>'
          + '<section class="dialog-section"><h3>Reasoning</h3><p>' + escapeHtml(finding.reasoning) + '</p></section>'
          + '<section class="dialog-section"><h3>Decision</h3><p>' + escapeHtml(finding.decision_implication) + '</p></section>'
          + '<section class="dialog-section"><h3>Alternative explanations</h3><ul>'
          + listMarkup(finding.alternative_explanations) + '</ul></section>'
          + '<section class="dialog-section"><h3>Could overturn this read</h3><ul>'
          + listMarkup(finding.would_change_our_mind) + '</ul></section>'
          + '<section class="dialog-section"><h3>Visible evidence</h3><ul>'
          + listMarkup(finding.evidence) + '</ul></section>';
        showDialogPanel(
          'insight',
          humanLabel(finding.id) + ' · ' + finding.confidence + ' confidence',
          'Why this matters',
          trigger,
        );
      }
      function median(values) {
        if (!values.length) return 0;
        var ordered = values.slice().sort(function (a, b) { return a - b; });
        var middle = Math.floor(ordered.length / 2);
        return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
      }
      function sum(rows, key) {
        return rows.reduce(function (total, record) { return total + (record.metrics[key] || 0); }, 0);
      }
      function readUrlState() {
        var params = new URLSearchParams(window.location.search);
        state.activeId = params.get('video') || (records[0] && records[0].candidate_id) || '';
        state.platform = params.get('platform') || 'all';
        state.company = params.get('company') || 'all';
        state.paid = params.get('paid') || 'all';
        state.query = params.get('q') || '';
        state.sort = allowedSorts.includes(params.get('sort')) ? params.get('sort') : 'rank';
        state.direction = params.get('dir') === 'desc' ? 'desc' : 'asc';
      }
      function writeUrlState() {
        var params = new URLSearchParams();
        if (state.activeId) params.set('video', state.activeId);
        if (state.platform !== 'all') params.set('platform', state.platform);
        if (state.company !== 'all') params.set('company', state.company);
        if (state.paid !== 'all') params.set('paid', state.paid);
        if (state.query) params.set('q', state.query);
        if (state.sort !== 'rank') params.set('sort', state.sort);
        if (state.direction !== 'asc') params.set('dir', state.direction);
        var query = params.toString();
        history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
      }
      function filteredRecords() {
        var query = state.query.trim().toLowerCase();
        return records.filter(function (record) {
          if (state.platform !== 'all' && record.platform !== state.platform) return false;
          if (state.company === 'known' && !record.company.name) return false;
          if (state.company === 'unknown' && record.company.name) return false;
          if (state.paid !== 'all' && record.paid.state !== state.paid) return false;
          if (!query) return true;
          var haystack = [
            record.account_handle,
            record.company.name,
            record.platform,
            record.strategy.data.opening.observed_words,
            record.strategy.data.content_arc.audience_problem,
            record.source_group
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(query);
        });
      }
      function sortRecords(rows) {
        var multiplier = state.direction === 'asc' ? 1 : -1;
        return rows.slice().sort(function (left, right) {
          var leftValue;
          var rightValue;
          if (state.sort === 'response') {
            leftValue = responsePerThousand(left);
            rightValue = responsePerThousand(right);
          } else if (state.sort === 'rank') {
            leftValue = left.cohort.rank;
            rightValue = right.cohort.rank;
          } else {
            leftValue = left.metrics[state.sort] || 0;
            rightValue = right.metrics[state.sort] || 0;
          }
          return (leftValue - rightValue) * multiplier;
        });
      }
      function sortControlValue() {
        var preferred = state.sort + ':' + state.direction;
        return document.querySelector('#sortSelect option[value="' + preferred + '"]')
          ? preferred
          : state.sort + ':desc';
      }
      function renderFilterSummary(rows) {
        var summary = rows.length + ' of ' + records.length + ' winners shown · '
          + (sortLabels[state.sort + ':' + state.direction] || 'Custom order');
        var filters = [];
        if (state.query.trim()) filters.push('search “' + state.query.trim() + '”');
        if (state.platform !== 'all') filters.push(platformLabel(state.platform));
        if (state.company !== 'all') filters.push(state.company === 'known' ? 'company linked' : 'creator / unknown');
        if (state.paid !== 'all') filters.push(humanLabel(state.paid));
        document.querySelector('#filterSummary').textContent = summary + (filters.length ? ' · ' + filters.join(' · ') : '');
      }
      function ensureActive(rows) {
        if (rows.some(function (record) { return record.candidate_id === state.activeId; })) return;
        state.activeId = rows[0] ? rows[0].candidate_id : '';
      }
      function renderKpis(rows) {
        var responses = rows.reduce(function (total, record) { return total + visibleResponse(record); }, 0);
        var known = rows.filter(function (record) { return Boolean(record.company.name); }).length;
        var paid = rows.filter(function (record) { return record.paid.state === 'paid_flag_observed'; }).length;
        var passed = rows.filter(function (record) { return record.quality.passed; }).length;
        var kpis = [
          [String(rows.length), 'English winners', rows.length + ' of ' + records.length + ' shown', 'accent'],
          [compactNumber(sum(rows, 'views')), 'Total views', 'observed source snapshots', ''],
          [compactNumber(responses), 'Visible responses', 'likes + comments only', ''],
          [median(rows.map(responsePerThousand)).toFixed(1), 'Median response / 1K', 'visible reactions per 1K views', ''],
          [String(known), 'Company-linked', (rows.length - known) + ' creator / unknown', ''],
          [String(paid), 'Paid flags', passed + '/' + rows.length + ' deep quality pass', paid ? '' : '']
        ];
        document.querySelector('#kpis').innerHTML = kpis.map(function (item) {
          return '<div class="kpi"><div class="kpi-value ' + item[3] + '">' + escapeHtml(item[0])
            + '</div><div class="kpi-label">' + escapeHtml(item[1])
            + '</div><div class="kpi-note">' + escapeHtml(item[2]) + '</div></div>';
        }).join('');
      }
      function renderRankingChart(rows) {
        var ranked = rows.slice().sort(function (left, right) {
          return right.cohort.success_percentile - left.cohort.success_percentile;
        });
        document.querySelector('#rankingChart').innerHTML = ranked.length ? ranked.map(function (record) {
          var percentile = Math.round(record.cohort.success_percentile * 1000) / 10;
          var width = Math.max(4, Math.min(100, (record.cohort.success_percentile - .9) * 1000));
          return '<div class="rank-row">'
            + '<div class="rank-name">' + escapeHtml(videoLabel(record))
            + '<span>' + escapeHtml(platformLabel(record.platform)) + '</span></div>'
            + '<div class="rank-track" role="progressbar" aria-label="' + escapeHtml(videoLabel(record) + ' success percentile')
            + '" aria-valuemin="90" aria-valuemax="100" aria-valuenow="' + percentile + '">'
            + '<div class="rank-fill ' + escapeHtml(record.platform) + '" style="width:' + width + '%"></div></div>'
            + '<div class="rank-value">' + percentile.toFixed(1) + 'P<span>' + compactNumber(record.metrics.views) + ' views</span></div>'
            + '</div>';
        }).join('') : '<div class="empty-results">No matches.</div>';
      }
      function breakdownRows(items, fillClass) {
        var max = Math.max.apply(null, items.map(function (item) { return item.count; }).concat([1]));
        return items.map(function (item) {
          return '<div class="breakdown-row"><div class="breakdown-name">' + escapeHtml(item.name)
            + '</div><div class="breakdown-track"><div class="breakdown-fill ' + (fillClass || '')
            + '" style="width:' + (item.count / max * 100) + '%"></div></div>'
            + '<div class="breakdown-value">' + item.count + ' · ' + compactNumber(item.views || 0) + '</div></div>';
        }).join('');
      }
      function renderBreakdowns(rows) {
        var platforms = ['tiktok', 'instagram', 'youtube_shorts'].map(function (platform) {
          var matches = rows.filter(function (record) { return record.platform === platform; });
          return { name: platformLabel(platform), count: matches.length, views: sum(matches, 'views') };
        }).filter(function (item) { return item.count; });
        document.querySelector('#platformBreakdown').innerHTML = breakdownRows(platforms, '');
        var known = rows.filter(function (record) { return Boolean(record.company.name); });
        var paid = rows.filter(function (record) { return record.paid.state === 'paid_flag_observed'; });
        var unknownPaid = rows.filter(function (record) { return record.paid.state === 'unknown'; });
        var attribution = [
          { name: 'Company linked', count: known.length, views: sum(known, 'views') },
          { name: 'Creator / unknown', count: rows.length - known.length, views: sum(rows.filter(function (record) { return !record.company.name; }), 'views') },
          { name: 'Paid flag', count: paid.length, views: sum(paid, 'views') },
          { name: 'Paid unknown', count: unknownPaid.length, views: sum(unknownPaid, 'views') }
        ];
        document.querySelector('#attributionBreakdown').innerHTML = breakdownRows(attribution, 'attribution');
      }
      function renderResearchSynthesis() {
        var section = document.querySelector('#researchSynthesis');
        var synthesis = snapshot.research_synthesis;
        if (!synthesis) {
          section.hidden = true;
          return;
        }
        section.hidden = false;
        document.querySelector('#synthesisSample').innerHTML =
          synthesis.sample.audience_signals + ' audience signals · '
          + synthesis.sample.unique_audience_source_pages + ' source pages<br>'
          + synthesis.sample.scored_content_videos + ' scored videos · '
          + synthesis.sample.high_performance_videos + ' high-performance';
        document.querySelector('#methodStats').innerHTML = [
          ['Audience signals', synthesis.sample.audience_signals],
          ['Unique source pages', synthesis.sample.unique_audience_source_pages],
          ['Scored videos', synthesis.sample.scored_content_videos],
          ['High-performance cohort', synthesis.sample.high_performance_videos],
          ['Comparison cohort', synthesis.sample.comparison_videos],
          ['Performance threshold', Math.round(synthesis.method.high_performance_threshold * 100) + 'th percentile']
        ].map(function (item) {
          return '<div class="method-stat"><span>' + escapeHtml(item[0])
            + '</span><strong>' + escapeHtml(item[1]) + '</strong></div>';
        }).join('');
        document.querySelector('#methodContrastRanges').innerHTML =
          synthesis.performance_contrasts.slice(0, 6).map(function (contrast) {
            var videoRange = contrast.sensitivity
              ? humanLabel(contrast.sensitivity.assessment) + ' · '
                + signedPoints(contrast.sensitivity.minimum_percentage_point_delta) + ' to '
                + signedPoints(contrast.sensitivity.maximum_percentage_point_delta)
              : 'Not available';
            var platformRange = contrast.platform_sensitivity
              ? humanLabel(contrast.platform_sensitivity.assessment) + ' · '
                + signedPoints(contrast.platform_sensitivity.minimum_percentage_point_delta) + ' to '
                + signedPoints(contrast.platform_sensitivity.maximum_percentage_point_delta)
              : 'Not available';
            return '<div class="method-range"><strong>'
              + escapeHtml(humanLabel(contrast.category)) + '</strong><span>Video: '
              + escapeHtml(videoRange) + '<br>Platform: ' + escapeHtml(platformRange) + '</span></div>';
          }).join('');
        document.querySelector('#researchFindings').innerHTML = synthesis.findings.map(function (finding, index) {
          return '<article class="finding-card">'
            + '<div class="finding-meta"><span>Signal ' + String(index + 1).padStart(2, '0')
            + '</span><span class="finding-confidence">' + escapeHtml(finding.confidence) + ' confidence</span>'
            + '<span class="finding-coverage">' + finding.evidence_ids.length + ' evidence refs</span></div>'
            + '<h3>' + escapeHtml(finding.conclusion) + '</h3>'
            + '<button class="text-action" type="button" data-finding-id="' + escapeHtml(finding.id)
            + '">View analysis</button></article>';
        }).join('');
        document.querySelectorAll('[data-finding-id]').forEach(function (button) {
          button.addEventListener('click', function () {
            var finding = synthesis.findings.find(function (candidate) { return candidate.id === button.dataset.findingId; });
            if (finding) openFindingDialog(finding, button);
          });
        });
        document.querySelector('#themeDepth').innerHTML = synthesis.audience_theme_depth.slice(0, 6).map(function (theme) {
          return '<div class="synthesis-row">'
            + '<div class="synthesis-row-name" title="' + escapeHtml(humanLabel(theme.theme)) + '">'
            + escapeHtml(humanLabel(theme.theme)) + '</div>'
            + '<div class="synthesis-row-value">' + theme.signal_count + ' signals<br>'
            + theme.unique_source_pages + ' pages</div>'
            + '<div class="synthesis-row-state">' + escapeHtml(theme.source_pattern) + '<br>'
            + percent(theme.signal_share) + '</div></div>';
        }).join('');
        document.querySelector('#researchContrasts').innerHTML = synthesis.performance_contrasts.slice(0, 6).map(function (contrast) {
          var direction = contrast.percentage_point_delta > 0 ? 'positive' : 'negative';
          var sensitivity = contrast.sensitivity;
          var platformSensitivity = contrast.platform_sensitivity;
          var sensitivityCopy = sensitivity
            ? '<div class="synthesis-row-sensitivity"><span class="sensitivity-label">Video hold</span>'
              + percent(sensitivity.direction_consistency)
              + (platformSensitivity
                ? '<span class="sensitivity-platform '
                  + (platformSensitivity.assessment === 'cross_platform_direction_holds' ? '' : 'sensitivity-sensitive')
                  + '"><span class="sensitivity-label">Platform hold</span>'
                  + percent(platformSensitivity.direction_consistency) + '</span>'
                : '') + '</div>'
            : '';
          return '<div class="synthesis-row">'
            + '<div class="synthesis-row-name" title="' + escapeHtml(humanLabel(contrast.dimension) + ': ' + humanLabel(contrast.category)) + '">'
            + escapeHtml(humanLabel(contrast.category)) + '</div>'
            + '<div class="synthesis-row-value">' + contrast.high_performance_count + '/' + contrast.high_performance_total
            + ' vs ' + contrast.comparison_count + '/' + contrast.comparison_total + '</div>'
            + '<div class="synthesis-row-state ' + direction + '">' + signedPoints(contrast.percentage_point_delta)
            + '<br>' + escapeHtml(contrast.stability) + '</div>' + sensitivityCopy + '</div>';
        }).join('');
      }
      function renderSortState() {
        document.querySelectorAll('[data-sort]').forEach(function (button) {
          var active = button.dataset.sort === state.sort;
          var header = button.closest('th');
          button.classList.toggle('active', active);
          button.dataset.indicator = active ? (state.direction === 'asc' ? '↑' : '↓') : '';
          if (header) header.setAttribute('aria-sort', active
            ? (state.direction === 'asc' ? 'ascending' : 'descending')
            : 'none');
        });
      }
      function renderTable(rows) {
        var ordered = sortRecords(rows);
        document.querySelector('#resultCount').textContent = ordered.length + ' rows · '
          + (sortLabels[state.sort + ':' + state.direction] || state.sort + ' ' + state.direction);
        document.querySelector('#videoTableBody').innerHTML = ordered.length ? ordered.map(function (record) {
          var paidClass = record.paid.state === 'paid_flag_observed' ? 'paid-flag' : '';
          var companyClass = record.company.name ? 'known-company' : '';
          return '<tr tabindex="0" data-id="' + escapeHtml(record.candidate_id) + '" class="'
            + (record.candidate_id === state.activeId ? 'active' : '') + '">'
            + '<td class="number">' + String(record.cohort.rank).padStart(2, '0') + '</td>'
            + '<td><div class="table-video">' + escapeHtml('@' + record.account_handle)
            + '<span class="table-sub">' + escapeHtml(headline(record.strategy.data.opening.observed_words)) + '</span></div></td>'
            + '<td>' + escapeHtml(platformLabel(record.platform)) + '</td>'
            + '<td class="' + companyClass + '">' + escapeHtml(record.company.name || 'Not identified') + '</td>'
            + '<td class="' + paidClass + '">' + escapeHtml(record.paid.label) + '</td>'
            + '<td class="number">' + escapeHtml(fullNumber(record.metrics.views)) + '</td>'
            + '<td class="number">' + escapeHtml(fullNumber(record.metrics.likes)) + '</td>'
            + '<td class="number">' + escapeHtml(fullNumber(record.metrics.comments)) + '</td>'
            + '<td class="number">' + responsePerThousand(record).toFixed(1) + '</td>'
            + '<td>' + escapeHtml(formatDate(record.metric_snapshot_at)) + '</td>'
            + '</tr>';
        }).join('') : '<tr class="empty-table"><td colspan="10">No matches.</td></tr>';
        document.querySelectorAll('#videoTableBody tr[data-id]').forEach(function (row) {
          row.addEventListener('click', function () { selectRecord(row.dataset.id, true); });
          row.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectRecord(row.dataset.id, true);
            }
          });
        });
        renderSortState();
      }
      function renderSources(rows) {
        var ordered = sortRecords(rows);
        document.querySelector('#railCount').textContent = ordered.length + ' shown / ' + records.length + ' English';
        sourceList.innerHTML = ordered.length ? ordered.map(function (record) {
          return '<button class="source ' + (record.candidate_id === state.activeId ? 'active' : '')
            + '" data-id="' + escapeHtml(record.candidate_id) + '">'
            + '<span class="source-rank">' + String(record.cohort.rank).padStart(2, '0') + '</span>'
            + '<span><span class="source-name">' + escapeHtml(videoLabel(record)) + '</span>'
            + '<span class="source-meta">' + escapeHtml(platformLabel(record.platform))
            + ' · ' + compactNumber(record.metrics.views) + ' views</span></span></button>';
        }).join('') : '<div class="rail-empty">No matches.</div>';
        sourceList.querySelectorAll('.source').forEach(function (button) {
          button.addEventListener('click', function () { selectRecord(button.dataset.id, false); });
        });
        if (window.matchMedia('(max-width: 700px)').matches) {
          var active = sourceList.querySelector('.source.active');
          if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
      function renderAxis(duration) {
        var ticks = duration > 90 ? 6 : 5;
        document.querySelector('#axis').innerHTML = Array.from({ length: ticks }, function (_, index) {
          var pct = index / (ticks - 1) * 100;
          return '<span class="tick" style="left:' + pct + '%">' + durationLabel(duration * index / (ticks - 1)) + '</span>';
        }).join('');
      }
      function renderLanes(record) {
        playheads.length = 0;
        lanes.innerHTML = laneSpecs.map(function (lane) {
          var segments = record.segmentation.segments[lane.id] || [];
          var blocks = segments.map(function (segment, index) {
            var left = segment.start_time / record.duration_sec * 100;
            var width = (segment.end_time - segment.start_time) / record.duration_sec * 100;
            return '<button class="segment ' + lane.className + '" data-lane="' + lane.id
              + '" data-index="' + index + '" aria-label="' + escapeHtml(firstMetadata(segment.metadata))
              + '" title="' + escapeHtml(firstMetadata(segment.metadata)) + '" style="left:' + left + '%;width:' + width + '%"></button>';
          }).join('');
          return '<div class="lane"><div class="lane-label">' + lane.label
            + '</div><div class="lane-track">' + blocks + '<span class="playhead"></span></div></div>';
        }).join('');
        lanes.querySelectorAll('.playhead').forEach(function (node) { playheads.push(node); });
        lanes.querySelectorAll('.segment').forEach(function (button) {
          button.addEventListener('click', function () {
            inspectSegment(button.dataset.lane, Number(button.dataset.index), button);
          });
        });
      }
      function renderStructure(record) {
        var strategy = record.strategy.data;
        var structure = strategy.transferable_structure;
        document.querySelector('#structure').innerHTML = [
          ['Hook pattern', structure.hook_pattern],
          ['Beat pattern', structure.beat_pattern],
          ['Payoff pattern', structure.payoff_pattern],
          ['Audience problem', strategy.content_arc.audience_problem],
          ['CTA', strategy.cta.requested_action]
        ].map(function (item) {
          return '<div class="structure-row"><div class="structure-label">' + escapeHtml(item[0])
            + '</div><div class="structure-copy ' + (item[0] === 'CTA' ? 'cta' : '') + '">' + escapeHtml(item[1]) + '</div></div>';
        }).join('');
        document.querySelector('#claims').innerHTML = strategy.claims.length
          ? '<div class="structure-label">Observed claims</div>' + strategy.claims.map(function (claim) {
            return '<div class="claim">' + escapeHtml(claim.observed_claim)
              + '<span class="claim-status">' + escapeHtml(claim.evidence_status) + '</span></div>';
          }).join('')
          : '';
        document.querySelector('#sourceLink').href = record.canonical_url;
      }
      function renderContext(record) {
        var paidClass = record.paid.state === 'paid_flag_observed' ? 'paid'
          : record.paid.state === 'not_marked_paid' ? 'clear' : '';
        var rows = [
          ['Language', 'English', 'TwelveLabs evidence: ' + record.language.basis.replaceAll('_', ' ') + '.', 'clear'],
          ['Company', companyLabel(record), record.company.basis, ''],
          ['Account', '@' + record.account_handle, record.source_group.replaceAll('_', ' '), ''],
          ['Paid status', record.paid.label, record.paid.basis, paidClass],
          ['Posted', formatDate(record.posted_at), 'Platform publication date.', ''],
          ['Metrics captured', formatDate(record.metric_snapshot_at), 'Observed snapshot; counters may change.', '']
        ];
        document.querySelector('#context').innerHTML = rows.map(function (item) {
          return '<div class="structure-row"><div class="structure-label">' + escapeHtml(item[0])
            + '</div><div class="context-value ' + item[3] + '">' + escapeHtml(item[1])
            + '<span class="context-basis">' + escapeHtml(item[2]) + '</span></div></div>';
        }).join('');
      }
      function segmentAtTime(record, laneId, time) {
        var segments = record.segmentation.segments[laneId] || [];
        if (!segments.length) return null;
        return segments.find(function (segment) {
          return time >= segment.start_time && time < segment.end_time;
        }) || segments[segments.length - 1];
      }
      function renderLiveSemantic(record, time) {
        var current = Math.max(0, Math.min(Number(time) || 0, record.duration_sec || 0));
        var progress = record.duration_sec ? current / record.duration_sec : 0;
        var visual = segmentAtTime(record, 'visual_shots', current);
        var audio = segmentAtTime(record, 'audio_beats', current);
        var editing = segmentAtTime(record, 'editing_beats', current);
        var interpretation = progress < .22
          ? 'Hook: ' + record.strategy.data.opening.mechanism
          : progress < .76
            ? 'Progression: ' + record.strategy.data.content_arc.progression
            : 'Payoff: ' + record.strategy.data.content_arc.payoff;
        document.querySelector('#liveSemanticTime').textContent =
          durationLabel(current) + ' / ' + durationLabel(record.duration_sec);
        var progressNode = document.querySelector('#liveSemanticProgress');
        var progressValue = Math.max(0, Math.min(100, progress * 100));
        progressNode.setAttribute('aria-valuenow', String(Math.round(progressValue)));
        progressNode.querySelector('span').style.width = progressValue + '%';
        document.querySelector('#semanticInference').textContent = interpretation;
        document.querySelector('#semanticVisual').textContent = visual
          ? visual.metadata.visual_description || visual.metadata.camera_and_motion || 'Visual scene retained.'
          : 'No visual segment was returned for this moment.';
        document.querySelector('#semanticOnScreenText').textContent = visual
          ? (visual.metadata.on_screen_text_exact && visual.metadata.on_screen_text_exact !== 'none'
              ? 'On screen: ' + visual.metadata.on_screen_text_exact
              : visual.metadata.camera_and_motion || '')
          : '';
        document.querySelector('#semanticAudio').textContent = audio
          ? (audio.metadata.speech_exact && audio.metadata.speech_exact !== 'none'
              ? '“' + audio.metadata.speech_exact + '”'
              : audio.metadata.music_and_sound || 'No speech detected.')
          : 'No audio segment was returned for this moment.';
        document.querySelector('#semanticDelivery').textContent = audio
          ? [audio.metadata.delivery, audio.metadata.music_and_sound].filter(function (value) {
              return value && value !== 'none';
            }).join(' · ')
          : '';
        document.querySelector('#semanticEditing').textContent = editing
          ? humanLabel(editing.metadata.attention_device || 'observed edit')
          : 'No editing segment was returned for this moment.';
        document.querySelector('#semanticTransition').textContent = editing
          ? [editing.metadata.transition_in, editing.metadata.layout_and_motion].filter(Boolean).join(' · ')
          : '';
        document.querySelectorAll('[data-semantic-step]').forEach(function (button) {
          var next = button.nextElementSibling;
          var start = Number(button.dataset.time || 0);
          var end = next ? Number(next.dataset.time || record.duration_sec) : record.duration_sec + 1;
          button.classList.toggle('active', current >= start && current < end);
        });
      }
      function renderSemanticWalkthrough(record, currentTime) {
        var visualSegments = record.segmentation.segments.visual_shots || [];
        var middleSegment = visualSegments[Math.floor(visualSegments.length / 2)];
        var lastSegment = visualSegments[visualSegments.length - 1];
        var steps = [
          {
            label: '01 Hook',
            time: record.strategy.data.opening.start_sec || 0,
            copy: record.strategy.data.opening.mechanism
          },
          {
            label: '02 Development',
            time: middleSegment ? middleSegment.start_time : record.duration_sec * .42,
            copy: record.strategy.data.content_arc.progression
          },
          {
            label: '03 Payoff',
            time: lastSegment ? lastSegment.start_time : record.duration_sec * .78,
            copy: record.strategy.data.content_arc.payoff
          }
        ];
        document.querySelector('#semanticWalkthrough').innerHTML = steps.map(function (step, index) {
          return '<button class="semantic-step" type="button" data-semantic-step="' + index
            + '" data-time="' + step.time + '" title="' + escapeHtml(step.copy) + '"><span>'
            + escapeHtml(step.label) + ' · ' + escapeHtml(durationLabel(step.time))
            + '</span><strong>' + escapeHtml(step.copy) + '</strong></button>';
        }).join('');
        document.querySelectorAll('[data-semantic-step]').forEach(function (button) {
          button.addEventListener('click', function () {
            var time = Number(button.dataset.time || 0);
            stageVideo.pause();
            stageVideo.currentTime = Math.min(time, stageVideo.duration || record.duration_sec);
            renderLiveSemantic(record, time);
          });
        });
        renderLiveSemantic(record, currentTime || 0);
      }
      function renderDetail() {
        var record = records.find(function (candidate) { return candidate.candidate_id === state.activeId; });
        var detail = analysisPanel;
        var visualStage = document.querySelector('#visualStage');
        var viewAnalysisButton = document.querySelector('#viewAnalysisButton');
        if (!record) {
          detail.hidden = true;
          visualStage.hidden = true;
          viewAnalysisButton.disabled = true;
          video.pause();
          video.removeAttribute('src');
          video.load();
          stageVideo.pause();
          stageVideo.removeAttribute('src');
          stageVideo.load();
          if (detailDialog.open && !analysisPanel.hidden) closeDialog(detailDialog);
          return;
        }
        detail.hidden = false;
        visualStage.hidden = false;
        viewAnalysisButton.disabled = false;
        activeSegment = null;
        var stageSourceChanged = stageVideo.getAttribute('src') !== record.media_src;
        if (stageSourceChanged) stageVideo.src = record.media_src;
        document.querySelector('#rankFlag').textContent = 'RANK ' + String(record.cohort.rank).padStart(2, '0');
        document.querySelector('#stageRankFlag').textContent = 'RANK ' + String(record.cohort.rank).padStart(2, '0');
        var fullHeadline = record.strategy.data.opening.observed_words;
        document.querySelector('#headline').textContent = headline(fullHeadline);
        document.querySelector('#headline').title = fullHeadline;
        document.querySelector('#stageHeadline').textContent = headline(fullHeadline);
        document.querySelector('#stageHeadline').title = fullHeadline;
        document.querySelector('#stageMeta').innerHTML =
          '<strong>' + escapeHtml(videoLabel(record)) + '</strong>'
          + '<span>' + escapeHtml(platformLabel(record.platform)) + '</span>'
          + '<span>' + escapeHtml(companyLabel(record)) + '</span>'
          + '<span>' + escapeHtml(record.paid.label) + '</span>';
        document.querySelector('#stageMetrics').innerHTML = metricMarkup(record, true);
        renderSemanticWalkthrough(record, stageSourceChanged ? 0 : stageVideo.currentTime);
        document.querySelector('#identityCompany').textContent = companyLabel(record);
        document.querySelector('#identityAccount').textContent = '@' + record.account_handle;
        var identityPaid = document.querySelector('#identityPaid');
        identityPaid.textContent = record.paid.label;
        identityPaid.className = 'identity-paid ' + (
          record.paid.state === 'paid_flag_observed' ? 'paid'
            : record.paid.state === 'not_marked_paid' ? 'clear' : ''
        );
        document.querySelector('#metrics').innerHTML = [
          [record.metrics.views, 'views'],
          [record.metrics.likes, 'likes'],
          [record.metrics.comments, 'comments'],
          [record.metrics.shares, 'shares'],
          [record.metrics.saves, 'saves']
        ].map(function (item) {
          return '<div title="' + escapeHtml(fullNumber(item[0])) + '"><div class="metric-value '
            + (item[0] === null ? 'missing' : item[1] === 'views' ? 'good' : '') + '">'
            + compactNumber(item[0]) + '</div><div class="metric-label">' + escapeHtml(item[1]) + '</div></div>';
        }).join('') + '<div class="metric-note">Within-platform, age-normalized rank.</div>';
        document.querySelector('#inspectTime').textContent = '';
        document.querySelector('#inspectCopy').textContent = 'Select a segment.';
        viewAnalysisButton.dataset.dialogTitle = videoLabel(record) + ' evidence';
        document.querySelector('#evidenceLimitations').innerHTML = listMarkup(record.strategy.data.evidence_limitations);
        renderAxis(record.duration_sec);
        renderLanes(record);
        renderContext(record);
        renderStructure(record);
      }
      function inspectSegment(laneId, index, button) {
        var record = records.find(function (candidate) { return candidate.candidate_id === state.activeId; });
        if (!record) return;
        var segment = record.segmentation.segments[laneId][index];
        video.currentTime = segment.start_time;
        video.play().catch(function () {});
        if (activeSegment) activeSegment.classList.remove('active');
        activeSegment = button;
        activeSegment.classList.add('active');
        var lane = laneSpecs.find(function (candidate) { return candidate.id === laneId; });
        document.querySelector('#inspectTime').textContent = (lane ? lane.label : laneId)
          + ' · ' + durationLabel(segment.start_time) + '—' + durationLabel(segment.end_time);
        document.querySelector('#inspectCopy').textContent = firstMetadata(segment.metadata);
      }
      function renderSnapshotMeta() {
        document.querySelector('#runCount').textContent = records.length + ' English / ' + snapshot.analyzed_count + ' analyzed';
        document.querySelector('#snapshotDate').textContent = 'Metrics snapshot ' + formatDate(snapshot.metric_snapshot_at);
        document.querySelector('#checkedAt').textContent = 'Local artifacts checked ' + formatTime(lastSuccessfulCheck);
      }
      function renderAll() {
        var filtered = filteredRecords();
        ensureActive(sortRecords(filtered));
        renderSnapshotMeta();
        renderFilterSummary(filtered);
        renderKpis(filtered);
        renderRankingChart(filtered);
        renderBreakdowns(filtered);
        renderResearchSynthesis();
        renderTable(filtered);
        renderSources(filtered);
        renderDetail();
        writeUrlState();
      }
      function selectRecord(id, scrollToDetail) {
        state.activeId = id;
        renderTable(filteredRecords());
        renderSources(filteredRecords());
        renderDetail();
        writeUrlState();
        if (scrollToDetail) document.querySelector('#visualStage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      function syncControls() {
        document.querySelector('#searchInput').value = state.query;
        document.querySelector('#platformFilter').value = state.platform;
        document.querySelector('#companyFilter').value = state.company;
        document.querySelector('#paidFilter').value = state.paid;
        document.querySelector('#sortSelect').value = sortControlValue();
      }
      function setLiveState(kind, copy) {
        var liveState = document.querySelector('#liveState');
        liveState.className = 'live-state ' + kind;
        document.querySelector('#liveCopy').textContent = copy;
        document.querySelector('#refreshButton').disabled = kind === 'refreshing';
      }
      function applySnapshot(next) {
        if (!next || next.schema_version !== 'twelvelabs_dashboard_snapshot_v1' || !Array.isArray(next.records)) {
          throw new Error('Dashboard snapshot is invalid.');
        }
        snapshot = next;
        records = next.records.slice();
        lastSuccessfulCheck = Date.now();
        if (!records.some(function (record) { return record.candidate_id === state.activeId; })) {
          state.activeId = records[0] ? records[0].candidate_id : '';
        }
        renderAll();
        setLiveState('', 'Live snapshot');
      }
      function refreshSnapshot() {
        if (document.querySelector('#refreshButton').disabled) return;
        if (window.location.protocol === 'file:') {
          setLiveState('refreshing', 'Reloading local snapshot');
          window.location.reload();
          return;
        }
        setLiveState('refreshing', 'Checking local artifacts');
        var script = document.createElement('script');
        var base = './twelvelabs-dashboard-data.js';
        script.src = base + '?poll=' + Date.now();
        script.onload = function () {
          try {
            applySnapshot(window.__TWELVELABS_DASHBOARD_SNAPSHOT__);
          } catch (error) {
            setLiveState('stale', 'Stale · last good snapshot');
          } finally {
            script.remove();
          }
        };
        script.onerror = function () {
          setLiveState('offline', 'Offline · last good snapshot');
          script.remove();
        };
        document.head.appendChild(script);
      }
      function bindFilters() {
        document.querySelector('#searchInput').addEventListener('input', function (event) {
          state.query = event.target.value;
          renderAll();
        });
        document.querySelector('#searchInput').addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && state.query) {
            state.query = '';
            event.target.value = '';
            renderAll();
          }
        });
        document.querySelector('#platformFilter').addEventListener('change', function (event) {
          state.platform = event.target.value;
          renderAll();
        });
        document.querySelector('#companyFilter').addEventListener('change', function (event) {
          state.company = event.target.value;
          renderAll();
        });
        document.querySelector('#paidFilter').addEventListener('change', function (event) {
          state.paid = event.target.value;
          renderAll();
        });
        document.querySelector('#sortSelect').addEventListener('change', function (event) {
          var parts = event.target.value.split(':');
          state.sort = parts[0];
          state.direction = parts[1];
          renderAll();
        });
        document.querySelector('#clearFilters').addEventListener('click', function () {
          state.platform = 'all';
          state.company = 'all';
          state.paid = 'all';
          state.query = '';
          state.sort = 'rank';
          state.direction = 'asc';
          syncControls();
          renderAll();
        });
        document.querySelectorAll('[data-sort]').forEach(function (button) {
          button.addEventListener('click', function () {
            var nextSort = button.dataset.sort;
            if (state.sort === nextSort) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
            else {
              state.sort = nextSort;
              state.direction = nextSort === 'rank' ? 'asc' : 'desc';
            }
            syncControls();
            renderAll();
          });
        });
        document.querySelector('#refreshButton').addEventListener('click', refreshSnapshot);
      }
      function bindDialog(dialog) {
        dialog.querySelectorAll('[data-close-dialog]').forEach(function (button) {
          button.addEventListener('click', function () { closeDialog(dialog); });
        });
        dialog.addEventListener('click', function (event) {
          if (event.target === dialog) closeDialog(dialog);
        });
        dialog.addEventListener('close', function () {
          if (!analysisPanel.hidden) {
            video.pause();
            if (stageVideo.readyState && video.readyState) {
              stageVideo.currentTime = Math.min(video.currentTime, stageVideo.duration || video.currentTime);
            }
            video.removeAttribute('src');
            video.load();
          }
          if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
          if (lastDialogTrigger && typeof lastDialogTrigger.focus === 'function') lastDialogTrigger.focus();
          lastDialogTrigger = null;
        });
      }
      function bindDialogs() {
        bindDialog(detailDialog);
        document.querySelector('#viewAnalysisButton').addEventListener('click', function (event) {
          stageVideo.pause();
          showDialogPanel(
            'analysis',
            'Selected winner evidence',
            event.currentTarget.dataset.dialogTitle || 'Video evidence',
            event.currentTarget,
          );
          video.src = stageVideo.getAttribute('src') || '';
          video.load();
          var syncTime = function () {
            if (stageVideo.readyState && Number.isFinite(stageVideo.currentTime)) {
              video.currentTime = Math.min(stageVideo.currentTime, video.duration || stageVideo.currentTime);
            }
          };
          if (video.readyState) syncTime();
          else video.addEventListener('loadedmetadata', syncTime, { once: true });
        });
        document.querySelector('#methodButton').addEventListener('click', function (event) {
          showDialogPanel('method', 'Evidence boundary', 'Research method', event.currentTarget);
        });
      }

      video.addEventListener('timeupdate', function () {
        var record = records.find(function (candidate) { return candidate.candidate_id === state.activeId; });
        if (!record) return;
        var pct = Math.max(0, Math.min(100, video.currentTime / record.duration_sec * 100));
        playheads.forEach(function (node) { node.style.left = pct + '%'; });
      });
      stageVideo.addEventListener('timeupdate', function () {
        var record = records.find(function (candidate) { return candidate.candidate_id === state.activeId; });
        if (record) renderLiveSemantic(record, stageVideo.currentTime);
      });
      stageVideo.addEventListener('loadedmetadata', function () {
        var record = records.find(function (candidate) { return candidate.candidate_id === state.activeId; });
        if (record) renderLiveSemantic(record, stageVideo.currentTime);
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && Date.now() - lastSuccessfulCheck > 30000) refreshSnapshot();
      });

      readUrlState();
      syncControls();
      bindFilters();
      bindDialogs();
      renderAll();
      window.setInterval(function () {
        if (document.visibilityState === 'visible') refreshSnapshot();
      }, 30000);
    }());
  </script>
</body>
</html>`;
}

export function summarizeDashboardSnapshot(snapshot: DashboardSnapshot): {
  english_records: number;
  analyzed_records: number;
  total_views: number;
  visible_responses: number;
  company_linked: number;
  paid_flags: number;
  quality_passed: number;
} {
  const records: DemoRecord[] = snapshot.records;
  return {
    english_records: records.length,
    analyzed_records: snapshot.analyzed_count,
    total_views: records.reduce((total, record) => total + (record.metrics.views ?? 0), 0),
    visible_responses: records.reduce(
      (total, record) => total + (record.metrics.likes ?? 0) + (record.metrics.comments ?? 0),
      0,
    ),
    company_linked: records.filter((record) => Boolean(record.company.name)).length,
    paid_flags: records.filter((record) => record.paid.state === 'paid_flag_observed').length,
    quality_passed: records.filter((record) => record.quality.passed).length,
  };
}
