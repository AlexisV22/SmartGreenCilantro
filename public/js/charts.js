// Chart helpers on top of the vendored Chart.js UMD build (window.Chart).
// Time is plotted on a linear axis in epoch milliseconds, so no date adapter is needed.

const COLORS = ['#9e1b32', '#2e7d32', '#1f5fa8', '#b26a00', '#6a1b9a', '#00838f', '#5d4037', '#455a64'];
export const color = (i) => COLORS[i % COLORS.length];

const charts = new WeakMap();

function timeTick(rangeMs) {
  return (value) => {
    const d = new Date(value);
    if (rangeMs <= 2 * 86400000) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  };
}

/** Average points into at most `max` buckets so 30 days stay fast to draw (NFR-01). */
export function downsample(points, max = 400) {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += size) {
    const chunk = points.slice(i, i + size);
    const x = chunk[Math.floor(chunk.length / 2)].x;
    out.push({ x, y: chunk.reduce((s, p) => s + p.y, 0) / chunk.length });
  }
  return out;
}

function mount(canvas, config) {
  const existing = charts.get(canvas);
  if (existing) existing.destroy();
  const chart = new window.Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

/**
 * Time series with an optional optimal band (threshold min/max) — FR-10.
 * series: [{ label, points: [{x: ms, y}] }], band: { min, max } | null
 */
export function timeSeriesChart(canvas, { series, band, unit = '', from, to }) {
  const datasets = [];
  if (band && band.min !== null && band.min !== undefined) {
    const xs = [from, to];
    datasets.push({
      label: `Minimum (${band.min} ${unit})`, data: xs.map((x) => ({ x, y: band.min })),
      borderColor: 'rgba(46,125,50,.7)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
    });
    datasets.push({
      label: `Maximum (${band.max} ${unit})`, data: xs.map((x) => ({ x, y: band.max })),
      borderColor: 'rgba(46,125,50,.7)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0,
      fill: '-1', backgroundColor: 'rgba(46,125,50,.08)',
    });
  }
  series.forEach((s, i) => datasets.push({
    label: s.label, data: s.points, borderColor: color(i), backgroundColor: color(i),
    borderWidth: 2, pointRadius: s.points.length > 80 ? 0 : 2, tension: 0.2, fill: false,
    // Anomalous readings are drawn as isolated red markers (US-19).
    ...(s.scatter ? { showLine: false, pointRadius: 5, pointStyle: 'crossRot', borderColor: '#c62828', backgroundColor: '#c62828' } : {}),
  }));

  return mount(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: from, max: to, ticks: { callback: timeTick(to - from), maxTicksLimit: 8 } },
        y: { title: { display: Boolean(unit), text: unit } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 14 } },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] ? new Date(items[0].parsed.x).toLocaleString() : ''),
            label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y * 100) / 100} ${unit}`,
          },
        },
      },
    },
  });
}

export function barChart(canvas, { labels, datasets, unit = '', stacked = false }) {
  return mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({ backgroundColor: d.color || color(i), borderRadius: 4, ...d })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: { x: { stacked }, y: { stacked, beginAtZero: true, title: { display: Boolean(unit), text: unit } } },
      plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
    },
  });
}

export function lineChart(canvas, { labels, datasets, unit = '' }) {
  return mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderColor: d.color || color(i), backgroundColor: d.color || color(i), borderWidth: 2, pointRadius: 2, tension: 0.2, ...d,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { title: { display: Boolean(unit), text: unit } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 14 } } },
    },
  });
}
