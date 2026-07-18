const form = document.querySelector('#askForm');
const question = document.querySelector('#question');
const result = document.querySelector('#askResult');
const submit = document.querySelector('#askSubmit');

document.querySelectorAll('.starter').forEach((button) => {
  button.addEventListener('click', () => {
    question.value = button.querySelector('span:last-child')?.textContent.trim() || button.textContent.trim();
    question.focus();
    form.requestSubmit();
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const platforms = [...form.querySelectorAll('input[name="platform"]:checked')].map((input) => input.value);
  const signal = form.elements.signal.value;
  const dateFrom = form.elements.dateFrom.value;
  const filters = {};
  if (platforms.length) filters.platforms = platforms;
  if (signal) filters.signals = [signal];
  if (dateFrom) filters.date_from = dateFrom;

  setBusy(true);
  result.innerHTML = '<p class="agent-section-label">Answer</p><div class="agent-loading"><strong>Searching reviewed evidence</strong></div>';
  if (window.matchMedia('(max-width: 1050px)').matches) {
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  try {
    const response = await fetch('/api/research/query', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question.value,
        ...(Object.keys(filters).length ? { filters } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'The research request could not be completed.');
    renderResearch(data);
  } catch (error) {
    result.innerHTML = `<p class="agent-section-label">Answer</p><div class="agent-error">${escapeHtml(error.message || 'Search failed.')}</div>`;
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  result.setAttribute('aria-busy', String(busy));
  submit.disabled = busy;
  submit.textContent = busy ? 'Searching…' : 'Search evidence';
}

function renderResearch(data) {
  const evidenceById = new Map((data.evidence || []).map((item) => [item.evidence_id, item]));
  const mode = {
    generated: 'Generated · evidence checked',
    cached: 'Cached · evidence checked',
    retrieval_only: 'Evidence matches · synthesis paused',
  }[data.mode] || 'Reviewed response';
  const modeNote = data.mode === 'retrieval_only'
    ? '<p class="agent-mode-note">AI synthesis paused. Showing corpus matches.</p>'
    : '';
  const findings = (data.findings || []).map((finding, index) => {
    const citations = (finding.evidence_ids || []).map((id) => {
      const item = evidenceById.get(id);
      return item?.source_url
        ? `<a href="${safeUrl(item.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(id)}</a>`
        : `<span>${escapeHtml(id)}</span>`;
    }).join('');
    return `<article class="agent-finding">
      <span class="agent-finding-number">${String(index + 1).padStart(2, '0')}</span>
      <div><p>${escapeHtml(finding.claim)}</p><div class="agent-citations">${citations}</div></div>
    </article>`;
  }).join('');
  const evidence = (data.evidence || []).map(renderEvidence).join('');
  const limitations = list(data.limitations);
  result.innerHTML = `
    <p class="agent-section-label">Answer</p>
    <div class="agent-response-head">
      <span class="agent-mode">${escapeHtml(mode)}</span>
      <span class="agent-index">${escapeHtml((data.query_intent || 'cross_source').replaceAll('_', ' '))} · Index ${escapeHtml(data.index_version || 'unknown')}</span>
    </div>
    ${modeNote}
    <p class="agent-answer">${escapeHtml(data.answer || '')}</p>
    <div class="agent-findings">${findings || '<div class="agent-error">No cited findings.</div>'}</div>
    <section class="agent-section">
      <p class="agent-section-label">Evidence drawer · ${(data.evidence || []).length}</p>
      ${evidence || '<p class="agent-support">No matching evidence.</p>'}
    </section>
    <section class="agent-section">
      <p class="agent-section-label">Coverage</p>
      ${renderCoverage(data.coverage)}
    </section>
    <section class="agent-section">
      <p class="agent-section-label">Limitations</p>
      ${limitations}
    </section>
    <section class="agent-section">
      <p class="agent-section-label">Useful follow-ups</p>
      ${renderFollowups(data.followups)}
    </section>`;
}

function renderEvidence(item) {
  const percentile = Number.isFinite(item.comparison_percentile)
    ? ` · cohort ${ordinal(Math.round(item.comparison_percentile * 100))} percentile`
    : '';
  const limitations = list(item.evidence_limitations);
  const sourceLink = item.source_url
    ? `<a class="evidence-link" href="${safeUrl(item.source_url)}" target="_blank" rel="noreferrer">Open source ↗</a>`
    : '';
  return `<details class="evidence-card">
    <summary>
      <span><span class="evidence-title">${escapeHtml(item.title || 'Reviewed source')}</span><span class="evidence-meta">${escapeHtml(evidenceTypeLabel(item))} · ${escapeHtml(signalLabel(item.signal))}${percentile}</span></span>
    </summary>
    <div class="evidence-body">
      <span class="evidence-id">${escapeHtml(item.evidence_id)}</span>
      <p>${escapeHtml(item.snippet || 'No public snippet was retained.')}</p>
      ${limitations}
      ${sourceLink}
    </div>
  </details>`;
}

function list(items = []) {
  return items.length
    ? `<ul class="agent-note-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p class="agent-support">None returned.</p>';
}

function renderCoverage(coverage = {}) {
  const returned = Object.entries(coverage.returned || {}).filter(([, count]) => count > 0);
  const families = returned.length
    ? returned.map(([type, count]) => `${count} ${type.replaceAll('_', ' ')}`).join(' · ')
    : 'No matching evidence family';
  const gaps = list(coverage.measurement_gaps || []);
  return `<p class="agent-support">${escapeHtml(families)}</p>${gaps}`;
}

function renderFollowups(items = []) {
  return items.length
    ? `<div class="agent-followups">${items.map((item) => `<button type="button" data-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div>`
    : '<p class="agent-support">None returned.</p>';
}

result.addEventListener('click', (event) => {
  const followup = event.target.closest('[data-followup]');
  if (!followup) return;
  question.value = followup.dataset.followup;
  question.focus();
  question.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

function signalLabel(value = '') {
  return value.replaceAll('_', ' ');
}

function platformLabel(value = '') {
  if (value === 'youtube_shorts') return 'YouTube Shorts';
  if (value === 'tiktok') return 'TikTok';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function evidenceTypeLabel(item = {}) {
  if (item.evidence_type === 'official_source') return 'Official source';
  if (item.evidence_type === 'audience_theme') return 'Audience theme';
  if (item.evidence_type === 'owned_aggregate') return 'Owned aggregate';
  return platformLabel(item.platform);
}

function ordinal(value) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${{ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th'}`;
}

function safeUrl(value = '') {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? escapeHtml(parsed.toString()) : '#';
  } catch {
    return '#';
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
