const stateElement = document.querySelector('#pipelineRefreshState');
const metricsElement = document.querySelector('#pipelineRefreshMetrics');
const noteElement = document.querySelector('#pipelineRefreshNote');

const numberFormat = new Intl.NumberFormat('en-US');
const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});
const moneyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function metric(label, value) {
  const wrapper = document.createElement('div');
  const title = document.createElement('span');
  const amount = document.createElement('strong');
  title.textContent = label;
  amount.textContent = value;
  wrapper.append(title, amount);
  return wrapper;
}

function render(status) {
  const completedAt = status.last_completed_at ? new Date(status.last_completed_at) : null;
  const validCompletedAt = completedAt && !Number.isNaN(completedAt.valueOf());
  const displayStatus = {
    configured: 'Scheduled',
    completed: 'Complete',
    partial: 'Partial evidence',
  }[status.status] || 'Status unavailable';
  stateElement.textContent = validCompletedAt
    ? `${displayStatus} · ${completedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : displayStatus;

  const coverage = status.providers?.twelvelabs?.analysis_coverage;
  const cost = status.budget?.actual_or_conservative_usd;
  const posts = status.results?.broad_discovery_rows ?? status.results?.posts_ingested;
  const selected = status.orchestration?.selected_videos ?? status.source?.requested_urls;
  metricsElement.replaceChildren(
    metric('Schedule', 'Mon + Thu'),
    metric('Per-run ceiling', moneyFormat.format(status.budget?.max_total_usd ?? 5)),
    metric('Surface rows', Number.isFinite(posts) ? numberFormat.format(posts) : 'Pending'),
    metric('TL selected', Number.isFinite(selected) ? numberFormat.format(selected) : 'Pending'),
    metric('TL coverage', Number.isFinite(coverage) ? percentFormat.format(coverage) : 'Pending'),
    metric('Last cost', Number.isFinite(cost) ? moneyFormat.format(cost) : 'Pending'),
  );

  if (status.status === 'partial') {
    noteElement.textContent = 'Codex selected a bounded cohort from the broad public surface; some analysis remained incomplete and is explicitly labeled.';
  } else if (status.status === 'completed') {
    noteElement.textContent = 'Broad discovery, Codex selection, public-URL reconciliation, analysis coverage, and provider budget gates passed.';
  }
}

fetch('/data/pipeline-refresh.json', { cache: 'no-store' })
  .then((response) => {
    if (!response.ok) throw new Error('status unavailable');
    return response.json();
  })
  .then(render)
  .catch(() => {
    stateElement.textContent = 'Status unavailable';
    metricsElement.replaceChildren(
      metric('Schedule', 'Mon + Thu'),
      metric('Per-run ceiling', '$9.00'),
    );
  });
