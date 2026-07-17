(() => {
  const data = window.__VIRALBENCH_ADS__;
  if (!data) {
    document.body.innerHTML = '<p class="ads-fatal">No ad data. Run <code>npm run internship-site:ads</code>.</p>';
    return;
  }

  const state = {
    company: 'all',
    format: 'all',
    query: '',
    sort: 'value',
    selectedId: data.ads.find((ad) => ad.analysis_status === 'twelvelabs_complete')?.ad_id ?? data.ads[0]?.ad_id,
  };

  const elements = {
    summary: document.querySelector('#summary'),
    advertiserGrid: document.querySelector('#advertiserGrid'),
    companyFilter: document.querySelector('#companyFilter'),
    formatFilter: document.querySelector('#formatFilter'),
    sortFilter: document.querySelector('#sortFilter'),
    search: document.querySelector('#adSearch'),
    resultCount: document.querySelector('#resultCount'),
    list: document.querySelector('#adList'),
    inspector: document.querySelector('#adInspector'),
  };

  const money = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  const shortDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function truncate(value, length = 110) {
    const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > length ? `${clean.slice(0, length - 1).trim()}…` : clean;
  }

  function formatMoney(value) {
    return Number.isFinite(value) ? money.format(value) : 'Not observed';
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Date unavailable' : shortDate.format(date);
  }

  function timecode(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function formatLabel(value) {
    if (value === 'dco') return 'DCO';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderSummary() {
    const metrics = [
      [data.summary.active_ads, 'Active ads'],
      [data.summary.twelvelabs_analyzed_videos, 'Video analyses'],
      [data.summary.advertisers, 'Advertisers'],
      [`${data.summary.formats.image + data.summary.formats.dco}`, 'Metadata only'],
      ['$0', 'Spend disclosed'],
    ];
    elements.summary.innerHTML = metrics.map(([value, label], index) => `
      <article class="ads-summary-metric">
        <span class="ads-metric-index">0${index + 1}</span>
        <strong>${escapeHtml(value)}</strong>
        <h2>${escapeHtml(label)}</h2>
      </article>
    `).join('');
  }

  function renderAdvertisers() {
    elements.advertiserGrid.innerHTML = data.advertisers.map((advertiser, index) => {
      const working = advertiser.media_spend_scenarios.working;
      const active = state.company === advertiser.company;
      const strategy = advertiser.strategy[0] || advertiser.website_message_match || 'Observed active-ad portfolio.';
      return `
        <button class="ads-advertiser-card${active ? ' active' : ''}" data-company="${escapeHtml(advertiser.company)}" type="button" aria-pressed="${active}">
          <span class="ads-card-index">0${index + 1}</span>
          <span class="ads-card-name">${escapeHtml(advertiser.company)}</span>
          <span class="ads-card-count">${advertiser.active_ads} active · ${advertiser.formats.video} video</span>
          <span class="ads-card-score">${advertiser.average_perceived_value}<small>/ 100 mean value</small></span>
          <span class="ads-card-spend">
            <small>Media scenario</small>
            ${formatMoney(working.cumulative_usd)}
            <em>${advertiser.observed_active_days} days × ${formatMoney(working.daily_budget_usd)}/day</em>
          </span>
          <span class="ads-card-strategy">${escapeHtml(strategy)}</span>
        </button>
      `;
    }).join('');
    elements.advertiserGrid.querySelectorAll('[data-company]').forEach((button) => {
      button.addEventListener('click', () => {
        const company = button.dataset.company;
        state.company = state.company === company ? 'all' : company;
        elements.companyFilter.value = state.company;
        renderAdvertisers();
        renderLedger();
        document.querySelector('#ledger').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function filteredAds() {
    const query = state.query.toLowerCase();
    const filtered = data.ads.filter((ad) => {
      const analysisText = [
        ad.analysis?.hook?.text,
        ad.analysis?.cta?.text,
        ...(ad.analysis?.styles ?? []),
      ].join(' ');
      const haystack = [
        ad.company,
        ad.ad_id,
        ad.body,
        ad.title,
        ad.cta,
        analysisText,
      ].join(' ').toLowerCase();
      return (state.company === 'all' || ad.company === state.company)
        && (state.format === 'all' || ad.format === state.format)
        && (!query || haystack.includes(query));
    });
    return filtered.sort((a, b) => {
      if (state.sort === 'newest') return new Date(b.start_date) - new Date(a.start_date);
      if (state.sort === 'company') return a.company.localeCompare(b.company) || b.perceived_value.total - a.perceived_value.total;
      return b.perceived_value.total - a.perceived_value.total;
    });
  }

  function renderLedger() {
    const ads = filteredAds();
    if (!ads.some((ad) => ad.ad_id === state.selectedId)) {
      state.selectedId = ads[0]?.ad_id ?? null;
    }
    elements.resultCount.textContent = `${ads.length} ads · ${ads.filter((ad) => ad.analysis).length} video`;
    elements.list.innerHTML = ads.length ? ads.map((ad) => {
      const active = ad.ad_id === state.selectedId;
      const offer = ad.analysis?.hook?.text || ad.body || ad.title || 'Dynamic creative template';
      return `
        <button class="ads-ledger-row${active ? ' active' : ''}" data-ad-id="${escapeHtml(ad.ad_id)}" type="button" aria-pressed="${active}">
          <span class="ads-ledger-identity">
            <span class="ads-format-mark ${ad.format}">${escapeHtml(formatLabel(ad.format))}</span>
            <span>
              <strong>${escapeHtml(ad.company)}</strong>
              <small>${escapeHtml(ad.ad_id)} · ${escapeHtml(formatDate(ad.start_date))}</small>
            </span>
          </span>
          <span class="ads-ledger-offer">
            ${escapeHtml(truncate(offer))}
            <small>${ad.analysis ? 'TwelveLabs' : 'Metadata only'}</small>
          </span>
          <span class="ads-ledger-score">
            <strong>${ad.perceived_value.total}</strong>
            <small>${escapeHtml(ad.perceived_value.label.replace(' perceived value', ''))}</small>
          </span>
        </button>
      `;
    }).join('') : '<p class="ads-empty">No ads match this filter.</p>';
    elements.list.querySelectorAll('[data-ad-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedId = button.dataset.adId;
        renderLedger();
      });
    });
    renderInspector();
  }

  function renderMedia(ad) {
    if (ad.media.video_url) {
      return `
        <div class="ads-media-frame video">
          <video src="${escapeHtml(ad.media.video_url)}" controls playsinline preload="metadata"></video>
          <span>${escapeHtml(ad.company)} · ${escapeHtml(ad.ad_id)}</span>
        </div>
      `;
    }
    if (ad.media.image_url) {
      return `
        <div class="ads-media-frame image">
          <img src="${escapeHtml(ad.media.image_url)}" alt="${escapeHtml(`${ad.company} active Meta ad creative`)}">
          <span>Public Meta image · source URL may expire</span>
        </div>
      `;
    }
    return `
      <div class="ads-media-frame unavailable">
        <span class="ads-media-type">${escapeHtml(formatLabel(ad.format))}</span>
        <strong>${ad.media.card_count || 0} dynamic cards</strong>
        <p>No stable render.</p>
      </div>
    `;
  }

  function renderValueBars(score) {
    const labels = {
      offer_clarity: 'Offer clarity',
      proof_density: 'Proof density',
      value_exchange: 'Value exchange',
      cta_continuity: 'CTA continuity',
      creative_craft: 'Creative craft',
    };
    return Object.entries(score.components).map(([key, value]) => `
      <div class="ads-value-row">
        <span>${labels[key]}</span>
        <i><b style="width:${value * 5}%"></b></i>
        <strong>${value}</strong>
      </div>
    `).join('');
  }

  function renderInspector() {
    const ad = data.ads.find((item) => item.ad_id === state.selectedId);
    if (!ad) {
      elements.inspector.innerHTML = '<p class="ads-loading">Select an ad.</p>';
      return;
    }
    const analysis = ad.analysis;
    const proof = analysis?.visible_proof ?? [];
    const limitations = analysis?.evidence_limitations ?? [];
    const styles = analysis?.styles ?? [];
    const spend = ad.media_spend_equal_share_scenario_usd;
    const hookTime = analysis?.hook?.start_sec;
    const ctaTime = analysis?.cta?.start_sec;
    const websiteProof = ad.website_context.offer_and_proof ?? [];
    elements.inspector.innerHTML = `
      <div class="ads-inspector-top">
        <div>
          <span class="ads-inspector-eyebrow">${escapeHtml(formatLabel(ad.format))} · active since ${escapeHtml(formatDate(ad.start_date))}</span>
          <h2>${escapeHtml(ad.company)}</h2>
          <p>${escapeHtml(ad.body || ad.title || 'Dynamic creative template')}</p>
        </div>
        <div class="ads-score-orbit">
          <strong>${ad.perceived_value.total}</strong>
          <span>/ 100</span>
          <small>${escapeHtml(ad.perceived_value.label)}</small>
        </div>
      </div>

      <div class="ads-inspector-grid">
        <div class="ads-inspector-primary">
          ${renderMedia(ad)}
          <div class="ads-wrapper-copy">
            <span>Meta wrapper</span>
            <h3>${escapeHtml(ad.title || 'Untitled creative')}</h3>
            <p>${escapeHtml(ad.body || 'Meta returned a dynamic catalog placeholder instead of fixed ad copy.')}</p>
            <div>
              <b>${escapeHtml(ad.cta || 'No CTA label')}</b>
              <b>${escapeHtml(ad.publisher_platforms.join(' · '))}</b>
            </div>
          </div>

          <section class="ads-tl-section">
            <div class="ads-subhead">
              <div>
                <span>Video</span>
                <h3>${analysis ? 'TwelveLabs' : 'Metadata only'}</h3>
              </div>
              <small>${analysis ? `${analysis.model} · ${analysis.duration_sec ?? '—'} sec` : 'No playable video asset'}</small>
            </div>
            ${analysis ? `
              <div class="ads-hook-cta">
                <article>
                  <span>Hook ${Number.isFinite(hookTime) ? `· ${timecode(hookTime)}` : ''}</span>
                  <p>${escapeHtml(analysis.hook?.text || 'None.')}</p>
                </article>
                <article>
                  <span>CTA ${Number.isFinite(ctaTime) ? `· ${timecode(ctaTime)}` : ''}</span>
                  <p>${escapeHtml(analysis.cta?.text || 'None.')}</p>
                </article>
              </div>
              <div class="ads-style-row">
                ${styles.map((style) => `<span>${escapeHtml(style)}</span>`).join('')}
              </div>
              <div class="ads-proof-block">
                <span>Visible proof · ${proof.length}</span>
                ${proof.length ? `<ol>${proof.slice(0, 5).map((item) => `
                  <li><time>${timecode(item.start_sec)}</time><p>${escapeHtml(item.description)}</p></li>
                `).join('')}</ol>` : '<p>None.</p>'}
              </div>
            ` : `
              <div class="ads-metadata-boundary">
                <strong>No video asset</strong>
                <p>Metadata only.</p>
              </div>
            `}
          </section>
        </div>

        <div class="ads-inspector-secondary">
          <section class="ads-cost-panel">
            <span class="ads-panel-label">Cost</span>
            <h3>Media + production</h3>
            <div class="ads-cost-feature">
              <small>Creative production envelope</small>
              <strong>${formatMoney(ad.production_cost.low_usd)}–${formatMoney(ad.production_cost.high_usd)}</strong>
              <span>${escapeHtml(ad.production_cost.kind)}</span>
              <p>${escapeHtml(ad.production_cost.basis)}</p>
            </div>
            <div class="ads-spend-scenarios">
              ${[
                ['Lean', spend.lean, '$25/day · equal split'],
                ['Working', spend.working, '$100/day · equal split'],
                ['Scaled', spend.scaled, '$500/day · equal split'],
              ].map(([label, value, basis]) => `
                <div>
                  <span>${label}</span>
                  <strong>${formatMoney(value)}</strong>
                  <small>${basis}</small>
                </div>
              `).join('')}
            </div>
            <p class="ads-cost-warning">No public spend data.</p>
          </section>

          <section class="ads-value-panel">
            <span class="ads-panel-label">Value score</span>
            <h3>${escapeHtml(ad.perceived_value.label)}</h3>
            <div class="ads-value-bars">${renderValueBars(ad.perceived_value)}</div>
          </section>

          <section class="ads-landing-panel">
            <span class="ads-panel-label">Landing page</span>
            <h3>${escapeHtml(ad.website_context.title || 'Website metadata')}</h3>
            ${websiteProof.length ? `
              <ul>${websiteProof.slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            ` : ''}
            <div class="ads-tracking">
              ${(ad.website_context.tracking_signals ?? []).map((signal) => `<span>${escapeHtml(signal)}</span>`).join('')}
            </div>
          </section>

          ${limitations.length ? `
            <section class="ads-limitations">
              <span class="ads-panel-label">Analysis limitations</span>
              <ul>${limitations.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </section>
          ` : ''}

          <div class="ads-source-actions">
            <a href="${escapeHtml(ad.meta_library_url)}" target="_blank" rel="noopener noreferrer">Open Meta source</a>
            ${ad.destination_url ? `<a href="${escapeHtml(ad.destination_url)}" target="_blank" rel="noopener noreferrer">Open destination</a>` : ''}
          </div>
        </div>
      </div>
    `;
    elements.inspector.scrollTop = 0;
  }

  function initializeControls() {
    data.advertisers.forEach((advertiser) => {
      const option = document.createElement('option');
      option.value = advertiser.company;
      option.textContent = `${advertiser.company} · ${advertiser.active_ads}`;
      elements.companyFilter.append(option);
    });
    elements.search.addEventListener('input', () => {
      state.query = elements.search.value.trim();
      renderLedger();
    });
    elements.companyFilter.addEventListener('change', () => {
      state.company = elements.companyFilter.value;
      renderAdvertisers();
      renderLedger();
    });
    elements.formatFilter.addEventListener('change', () => {
      state.format = elements.formatFilter.value;
      renderLedger();
    });
    elements.sortFilter.addEventListener('change', () => {
      state.sort = elements.sortFilter.value;
      renderLedger();
    });
  }

  renderSummary();
  initializeControls();
  renderAdvertisers();
  renderLedger();
})();
