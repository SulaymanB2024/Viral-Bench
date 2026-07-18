const auth = document.querySelector('#operatorAuth');
const shell = document.querySelector('#operatorShell');
const loginForm = document.querySelector('#loginForm');
const loginMessage = document.querySelector('#loginMessage');
const loginSubmit = document.querySelector('#loginSubmit');
const accessTitle = document.querySelector('#operatorAccessTitle');
const pausedPanel = document.querySelector('#operatorPaused');
const briefForm = document.querySelector('#briefForm');
const briefResult = document.querySelector('#briefResult');
const briefSubmit = document.querySelector('#briefSubmit');
let currentDownloads = null;

const presets = {
  proof: {
    objective: 'Increase useful awareness without promising outcomes',
    audience: 'College students preparing internship applications',
    topic: 'Turning coursework into truthful, role-relevant proof',
  },
  interview: {
    objective: 'Help students enter internship interviews prepared and confident',
    audience: 'College students with an upcoming internship interview',
    topic: 'Turning a job description into truthful interview stories and questions',
  },
  search: {
    objective: 'Help students begin a focused internship search',
    audience: 'College students unsure where to start their internship search',
    topic: 'Choosing realistic roles, search terms, and a weekly application rhythm',
  },
};

checkStatus();

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    const preset = presets[button.dataset.preset];
    if (!preset) return;
    briefForm.elements.objective.value = preset.objective;
    briefForm.elements.audience.value = preset.audience;
    briefForm.elements.topic.value = preset.topic;
    document.querySelectorAll('[data-preset]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    briefForm.elements.topic.focus();
  });
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginSubmit.disabled = true;
  loginMessage.textContent = 'Checking session…';
  try {
    const response = await fetch('/api/operator/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginForm.elements.password.value }),
    });
    const data = await response.json();
    loginForm.elements.password.value = '';
    if (!response.ok) throw new Error(data.message || 'Authentication failed.');
    showWorkspace();
  } catch (error) {
    loginMessage.textContent = error.message || 'Authentication failed.';
  } finally {
    loginSubmit.disabled = false;
  }
});

briefForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  currentDownloads = null;
  briefSubmit.disabled = true;
  briefSubmit.textContent = 'Checking…';
  briefResult.setAttribute('aria-busy', 'true');
  briefResult.innerHTML = '<p class="agent-section-label">Brief</p><div class="agent-loading">Checking evidence</div>';
  try {
    const response = await fetch('/api/operator/brief', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: briefForm.elements.objective.value,
        audience: briefForm.elements.audience.value,
        platform: briefForm.elements.platform.value,
        topic: briefForm.elements.topic.value,
        constraints: briefForm.elements.constraints.value,
      }),
    });
    const data = await response.json();
    if (response.status === 401) {
      showLogin('Your operator session expired. Sign in again.');
      return;
    }
    if (!response.ok) throw new Error(data.message || 'Brief failed.');
    currentDownloads = data.mode === 'generated' ? data.downloads : null;
    renderBrief(data);
  } catch (error) {
    briefResult.innerHTML = `<p class="agent-section-label">Brief</p><div class="agent-error">${escapeHtml(error.message || 'Brief failed.')}</div>`;
  } finally {
    briefResult.setAttribute('aria-busy', 'false');
    briefSubmit.disabled = false;
    briefSubmit.textContent = 'Generate draft brief';
  }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  try {
    await fetch('/api/operator/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } finally {
    currentDownloads = null;
    showLogin('Logged out. The transient brief was cleared from this page.');
  }
});

briefResult.addEventListener('click', (event) => {
  const button = event.target.closest('[data-download]');
  if (!button || !currentDownloads) return;
  if (button.dataset.download === 'markdown') {
    download('internships-com-brief.md', currentDownloads.markdown, 'text/markdown');
  }
  if (button.dataset.download === 'json') {
    download('internships-com-draft-bundle.json', JSON.stringify(currentDownloads.json, null, 2), 'application/json');
  }
});

async function checkStatus() {
  try {
    const response = await fetch('/api/operator/status', { credentials: 'same-origin' });
    const data = await response.json();
    if (response.ok && data.authenticated) {
      showWorkspace();
      return;
    }
    if (response.ok && data.enabled === false) {
      showPaused();
      return;
    }
    showLogin('Enter the operator password to continue.');
  } catch {
    showLogin('Operator status is unavailable. Access remains closed.');
  }
}

function showWorkspace() {
  auth.hidden = true;
  shell.hidden = false;
  briefForm.elements.objective.focus();
}

function showLogin(message, disabled = false) {
  shell.hidden = true;
  auth.hidden = false;
  currentDownloads = null;
  accessTitle.textContent = 'Operator access';
  loginMessage.textContent = message;
  loginForm.hidden = false;
  pausedPanel.hidden = true;
  loginSubmit.disabled = disabled;
  loginForm.elements.password.disabled = disabled;
}

function showPaused() {
  shell.hidden = true;
  auth.hidden = false;
  currentDownloads = null;
  accessTitle.textContent = 'Private briefs paused';
  loginMessage.textContent = 'Public research is available.';
  loginForm.hidden = true;
  pausedPanel.hidden = false;
}

function renderBrief(data) {
  const mode = data.mode === 'generated' ? `${data.model} · evidence checked` : 'Evidence matches · synthesis paused';
  const concepts = (data.concepts || []).map((concept, index) => `
    <article class="concept-card">
      <span class="agent-mini-label">Concept ${String(index + 1).padStart(2, '0')}</span>
      <h3>${escapeHtml(concept.title)}</h3>
      <p class="concept-hook">“${escapeHtml(concept.hook)}”</p>
      <dl>
        <dt>Hypothesis</dt><dd>${escapeHtml(concept.hypothesis)}</dd>
        <dt>Format</dt><dd>${escapeHtml(concept.format)}</dd>
        <dt>Beats</dt><dd>${(concept.script_beats || []).map(escapeHtml).join(' → ')}</dd>
        <dt>CTA</dt><dd>${escapeHtml(concept.cta)}</dd>
        <dt>Evidence</dt><dd>${(concept.evidence_ids || []).map(escapeHtml).join(', ')}</dd>
      </dl>
    </article>`).join('');
  const evidence = (data.evidence || []).map(renderEvidence).join('');
  const risks = (data.claim_risks || []).map((risk) => (
    `<li><strong>${escapeHtml(risk.claim)}</strong> — ${escapeHtml(risk.risk)} Mitigation: ${escapeHtml(risk.mitigation)}</li>`
  )).join('');
  const downloads = data.mode === 'generated'
    ? `<div class="agent-downloads">
        <button class="agent-secondary" type="button" data-download="markdown">Download Markdown</button>
        <button class="agent-secondary" type="button" data-download="json">Download draft JSON</button>
      </div>
      <p class="agent-footnote">Browser-only files. External actions stay disabled.</p>`
    : '';
  briefResult.innerHTML = `
    <p class="agent-section-label">Brief</p>
    <div class="agent-response-head">
      <span class="agent-mode">${escapeHtml(mode)}</span>
      <span class="agent-index">${escapeHtml((data.query_intent || 'cross_source').replaceAll('_', ' '))} · Index ${escapeHtml(data.index_version || 'unknown')}</span>
    </div>
    <p class="agent-answer">${escapeHtml(data.summary || '')}</p>
    ${data.audience_tension ? `<section class="agent-section"><p class="agent-section-label">Audience tension</p><p class="agent-support">${escapeHtml(data.audience_tension)}</p></section>` : ''}
    <section class="agent-section">
      <p class="agent-section-label">Concepts · ${(data.concepts || []).length}</p>
      ${concepts || '<div class="agent-error">No draft passed the evidence gate.</div>'}
    </section>
    ${data.mode === 'generated' ? `<section class="agent-section">
      <p class="agent-section-label">Controlled experiment</p>
      <div class="concept-card"><dl>
        <dt>Hypothesis</dt><dd>${escapeHtml(data.experiment.hypothesis)}</dd>
        <dt>Control</dt><dd>${escapeHtml(data.experiment.control)}</dd>
        <dt>Variants</dt><dd>${(data.experiment.variants || []).map(escapeHtml).join('; ')}</dd>
        <dt>Metrics</dt><dd>${(data.experiment.primary_metrics || []).map(escapeHtml).join(', ')}</dd>
        <dt>Checks</dt><dd>${(data.experiment.checkpoints || []).map(escapeHtml).join(', ')}</dd>
      </dl></div>
    </section>` : ''}
    <section class="agent-section">
      <p class="agent-section-label">Claim risks</p>
      ${risks ? `<ul class="agent-note-list">${risks}</ul>` : '<p class="agent-support">No synthesized claims were returned.</p>'}
    </section>
    <section class="agent-section">
      <p class="agent-section-label">Evidence · ${(data.evidence || []).length}</p>
      ${evidence || '<p class="agent-support">No matching evidence.</p>'}
    </section>
    <section class="agent-section">
      <p class="agent-section-label">Limitations</p>
      ${list(data.limitations)}
    </section>
    ${downloads}`;
}

function renderEvidence(item) {
  const link = item.source_url
    ? `<a class="evidence-link" href="${safeUrl(item.source_url)}" target="_blank" rel="noreferrer">Open source ↗</a>`
    : '';
  return `<details class="evidence-card">
    <summary><span><span class="evidence-title">${escapeHtml(item.title || 'Reviewed source')}</span><span class="evidence-meta">${escapeHtml(evidenceTypeLabel(item))} · ${escapeHtml((item.visibility || '').replaceAll('_', ' '))}</span></span></summary>
    <div class="evidence-body"><span class="evidence-id">${escapeHtml(item.evidence_id)}</span><p>${escapeHtml(item.snippet || '')}</p>${list(item.evidence_limitations)}${link}</div>
  </details>`;
}

function list(items = []) {
  return items?.length
    ? `<ul class="agent-note-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p class="agent-support">None returned.</p>';
}

function evidenceTypeLabel(item = {}) {
  if (item.evidence_type === 'official_source') return 'Official source';
  if (item.evidence_type === 'audience_theme') return 'Audience theme';
  if (item.evidence_type === 'owned_aggregate') return 'Owned aggregate';
  return platformLabel(item.platform);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function platformLabel(value = '') {
  if (value === 'youtube_shorts') return 'YouTube Shorts';
  if (value === 'tiktok') return 'TikTok';
  return value.charAt(0).toUpperCase() + value.slice(1);
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
