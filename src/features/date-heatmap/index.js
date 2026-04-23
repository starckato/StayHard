// Stay Hard · date heatmap (기록 탭 상단)
//
// Horizontal-scrolling calendar grid. Replaces the old 주간 탭 and the old
// .day-strip day picker in the record tab. Rows: 식단 · 운동 · 루틴 · 할일.
// First three rows are color-coded only. The 할일 row shows a small preview
// of the first target plus "+N" for the rest.
//
// Tapping a date column (label or any cell) navigates the record tab to that
// day via the existing window.selectDay() flow. The heatmap itself is
// read-only — editing happens in the record tab once a day is selected.
//
// Data: lazy-loaded weeks from Supabase daily_logs, cached via window.logCache.
// Scroll left loads older weeks (up to 52 weeks back), scroll right loads
// future weeks for up to +4 weeks of planning.

import { sb } from '../../lib/supabase.js';
import { dkey } from '../../lib/date.js';

// Module-local state
let dhLogs = {};
let dhLoadedOffsets = new Set();
let dhLoadingMore = false;
let dhMinOffset = 0;
let dhMaxOffset = 0;
let dhAllDates = [];
let dhDidInitialScroll = false;

const DH_MAX_PAST_WEEKS = 52;
const DH_MAX_FUTURE_WEEKS = 4;

// Day-tile layout (v6 · no-grid) — each day is its own rounded tile, scrolled horizontally.
const DH_TILE_W = 56;
const DH_TILE_H = 78;
const DH_GAP = 5;

const DH_ROWS = [
  { key: 'meal',    lbl: '식단' },
  { key: 'workout', lbl: '운동' },
  { key: 'routine', lbl: '루틴' },
  { key: 'tasks',   lbl: '할일' },
];

function dhWeekDates(offset) {
  const d = new Date(window.now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return x;
  });
}

function cellStatus(dl, cat, isFuture) {
  if (isFuture) return 'future';
  if (!dl) return 'empty';
  if (cat === 'meal') {
    const meals = dl.meals || [];
    if (!meals.length) return 'empty';
    const bad = meals.filter(m => m.type === 'red' || m.type === 'alcohol').length;
    const good = meals.filter(m => m.type === 'green' || m.type === 'normal').length;
    if (bad > 0 && good > 0) return 'partial';
    if (bad > 0) return 'fail';
    return 'pass';
  }
  if (cat === 'workout') {
    const wos = (dl.workouts || []).filter(w => w.status === 'done');
    return wos.length ? 'pass' : 'empty';
  }
  if (cat === 'routine') {
    const mand = dl.mandatory || [];
    if (!mand.length) return 'empty';
    const done = mand.filter(m => m.done).length;
    if (done === mand.length) return 'pass';
    if (done === 0) return 'empty';
    return 'partial';
  }
  if (cat === 'tasks') {
    const tgts = dl.targets || [];
    if (!tgts.length) return 'empty';
    const done = tgts.filter(t => t.st === 'done').length;
    if (done === tgts.length) return 'pass';
    if (done === 0) return 'empty';
    return 'partial';
  }
  return 'empty';
}

// Palette v10 — metal medal ladder.
//   pass    = 황금 gold leaf gradient + warm halo (gold medal)
//   partial = 은 silver gradient + cool halo (silver medal — 금 직전)
//   fail    = brand red (식단 금지와 같은 언어)
//   empty   = solid outline only
//   future  = dashed outline only
function indicatorStyle(status) {
  if (status === 'pass')
    return (
      'background:linear-gradient(135deg,#fff1a8 0%,#ffd54a 45%,#c48c1a 100%);' +
      'border:1px solid rgba(255,233,128,0.70);' +
      'box-shadow:0 0 4px rgba(255,213,74,0.55),inset 0 1px 0 rgba(255,255,255,0.45),inset 0 -1px 0 rgba(0,0,0,0.25);'
    );
  if (status === 'partial')
    return (
      'background:linear-gradient(135deg,#f2f4f7 0%,#b5c0cc 45%,#6d7682 100%);' +
      'border:1px solid rgba(210,218,228,0.55);' +
      'box-shadow:0 0 3px rgba(181,192,204,0.40),inset 0 1px 0 rgba(255,255,255,0.32),inset 0 -1px 0 rgba(0,0,0,0.22);'
    );
  if (status === 'fail')
    return 'background:rgba(255,77,77,0.32);border:1px solid rgba(255,77,77,0.45);';
  if (status === 'future')
    return 'background:transparent;border:1px dashed rgba(255,255,255,0.08);';
  // empty
  return 'background:transparent;border:1px solid rgba(255,255,255,0.10);';
}

function taskPreview(dl) {
  const tgts = (dl && dl.targets) || [];
  if (!tgts.length) return { text: '', count: 0 };
  const first = tgts.find(t => t && typeof t.text === 'string' && t.text.trim().length > 0);
  if (!first) return { text: '', count: tgts.length };
  const raw = first.text.trim();
  const done = first.st === 'done';
  const short = raw.length > 3 ? raw.slice(0, 3) + '…' : raw;
  return { text: short, count: tgts.length, done };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildHeatmapGrid() {
  const grid = document.getElementById('dh-grid');
  if (!grid) return;
  if (!dhAllDates.length) {
    renderDateHeatmap();
    return;
  }
  const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

  const tiles = dhAllDates.map((d, i) => {
    const k = dkey(d);
    const isT = k === window.TODAY;
    const isSel = k === window.selectedKey;
    const isFuture = d > window.now && !isT;
    const dayIdx = (d.getDay() + 6) % 7;
    const prev = i > 0 ? dhAllDates[i - 1] : null;
    const monthChanged = !prev || prev.getMonth() !== d.getMonth();
    const showMonth = i === 0 || monthChanged;

    const dl = window.logCache?.[k] || dhLogs[k];
    // Four tiny status squares at the bottom of each tile — same order as
    // the old grid rows (식단/운동/루틴/할일). Width is tuned so all four
    // fit within the tile with a 2px gap.
    const indicatorSize = Math.floor((DH_TILE_W - 10 - 2 * 3) / 4); // 4 squares + 3 gaps inside 10px padding
    const indicators = DH_ROWS.map(cat => {
      const status = cellStatus(dl, cat.key, isFuture);
      return `<span style="display:inline-block;width:${indicatorSize}px;height:${indicatorSize}px;border-radius:2px;box-sizing:border-box;${indicatorStyle(status)}"></span>`;
    }).join('');

    // Tile container — selected lifts via ivory outline + subtle surface
    // wash (stays in the neutral family so it doesn't collide with the
    // fail indicator's red). Brand red remains solely on the 'today' dot.
    const tileBg = isSel
      ? 'rgba(255,255,255,0.05)'
      : isFuture ? 'transparent' : 'var(--surface)';
    const tileBorder = isSel
      ? 'border:1px solid rgba(234,234,240,0.38);'
      : isFuture ? 'border:1px dashed rgba(255,255,255,0.08);'
      : 'border:1px solid rgba(255,255,255,0.06);';
    const tileOpacity = isFuture ? 0.55 : 1;
    const tileShadow = isSel ? 'box-shadow:0 0 0 1px rgba(234,234,240,0.10);' : '';

    const monthLabel = showMonth
      ? `<div style="position:absolute;top:-18px;left:0;font-size:9px;font-weight:700;color:var(--text3);letter-spacing:.05em;white-space:nowrap;">${d.getMonth() + 1}월</div>`
      : '';

    const todayDot = isT
      ? '<div style="width:4px;height:4px;border-radius:50%;background:var(--accent);"></div>'
      : '<div style="width:4px;height:4px;"></div>';

    const dayColor = isSel ? 'var(--text)' : 'var(--text3)';
    const numColor = isSel ? '#fff' : isFuture ? 'var(--text3)' : 'var(--text)';

    return `
      <div onclick="dhSelectDate('${k}',${d.getTime()})"
           style="position:relative;flex-shrink:0;width:${DH_TILE_W}px;height:${DH_TILE_H}px;background:${tileBg};${tileBorder}${tileShadow}border-radius:10px;display:flex;flex-direction:column;align-items:center;padding:7px 5px 8px;cursor:pointer;opacity:${tileOpacity};box-sizing:border-box;touch-action:manipulation;">
        ${monthLabel}
        ${todayDot}
        <div style="font-size:9px;font-weight:700;letter-spacing:.06em;color:${dayColor};margin-top:3px;">${DAY_NAMES[dayIdx]}</div>
        <div style="font-size:18px;font-weight:700;color:${numColor};font-family:'DM Mono',monospace;line-height:1;margin-top:2px;margin-bottom:auto;">${d.getDate()}</div>
        <div style="display:flex;gap:3px;align-items:center;justify-content:center;">${indicators}</div>
      </div>
    `;
  }).join('');

  grid.innerHTML = `<div style="display:flex;gap:${DH_GAP}px;padding:22px 14px 8px;">${tiles}</div>`;
}

async function fetchHeatmapRange(dates) {
  if (!dates || !dates.length || !window.CU) return;
  const from = dkey(dates[0]);
  const to = dkey(dates[dates.length - 1]);
  const { data } = await sb.from('daily_logs')
    .select('log_date,weight,water_cups,meals,workouts,mandatory,targets')
    .eq('user_id', window.CU.id)
    .gte('log_date', from)
    .lte('log_date', to);
  if (!data) return;
  data.forEach(d => {
    const nk = window.normKey(d.log_date);
    if (window._dirtyKeys && window._dirtyKeys.has(nk)) {
      if (window.logCache[nk]) dhLogs[nk] = JSON.parse(JSON.stringify(window.logCache[nk]));
      return;
    }
    const parsed = {
      weight: d.weight !== null ? parseFloat(d.weight) : null,
      water_cups: d.water_cups || 0,
      meals: d.meals || [],
      workouts: d.workouts || [],
      mandatory: d.mandatory || [],
      targets: d.targets || [],
    };
    window.logCache[nk] = Object.assign({}, window.logCache[nk] || {}, parsed);
    dhLogs[nk] = JSON.parse(JSON.stringify(parsed));
  });
}

export async function renderDateHeatmap() {
  if (!document.getElementById('dh-grid')) return;
  dhLogs = {};
  dhLoadedOffsets = new Set();
  dhLoadingMore = false;
  dhAllDates = [];
  dhDidInitialScroll = false;

  // Initial window: 3 weeks back → today → 1 week forward
  const initialDates = [];
  for (let off = -2; off <= 1; off++) {
    const dates = dhWeekDates(off);
    initialDates.push(...dates);
    dhLoadedOffsets.add(off);
  }
  dhAllDates = initialDates;
  dhMinOffset = -2;
  dhMaxOffset = 1;

  // 1) Render immediately from logCache
  let hasCached = false;
  initialDates.forEach(d => {
    const k = dkey(d);
    if (window.logCache?.[k]) {
      dhLogs[k] = JSON.parse(JSON.stringify(window.logCache[k]));
      hasCached = true;
    }
  });
  buildHeatmapGrid();
  centerOnSelected();

  // 2) Stale-while-revalidate fetch
  try {
    await fetchHeatmapRange(initialDates);
    buildHeatmapGrid();
    if (!hasCached) centerOnSelected();
    // Other cards (weight delta, routine summary, etc.) read from logCache
    // too. After we hydrate it with 4 weeks of history, refresh any card
    // that was painted with stale data on initial load.
    try { window.renderWeight?.(); } catch {}
  } catch (e) { /* silent */ }
}

function centerOnSelected() {
  const outer = document.getElementById('dh-scroll');
  if (!outer) return;
  requestAnimationFrame(() => {
    const targetKey = window.selectedKey || window.TODAY;
    const idx = dhAllDates.findIndex(d => dkey(d) === targetKey);
    if (idx < 0) return;
    // 14px left padding of the row + idx tiles offset
    const tileLeft = 14 + idx * (DH_TILE_W + DH_GAP);
    outer.scrollLeft = Math.max(0, tileLeft - (outer.clientWidth - DH_TILE_W) / 2);
    dhDidInitialScroll = true;
  });
}

let dhScrollTimer = null;
export function dhOnScroll(el) {
  if (dhLoadingMore) return;
  clearTimeout(dhScrollTimer);
  dhScrollTimer = setTimeout(() => {
    const nearLeft = el.scrollLeft < 160;
    const nearRight = el.scrollLeft + el.clientWidth > el.scrollWidth - 160;
    if (nearLeft) dhLoadMore('left', el);
    else if (nearRight) dhLoadMore('right', el);
  }, 120);
}

async function dhLoadMore(side, el) {
  if (dhLoadingMore) return;
  if (side === 'left' && dhMinOffset <= -DH_MAX_PAST_WEEKS) return;
  if (side === 'right' && dhMaxOffset >= DH_MAX_FUTURE_WEEKS) return;
  dhLoadingMore = true;

  const prevWidth = el.scrollWidth;
  const prevLeft = el.scrollLeft;
  const nextOff = side === 'left' ? dhMinOffset - 1 : dhMaxOffset + 1;
  const dates = dhWeekDates(nextOff);

  let allCached = true;
  dates.forEach(d => {
    const k = dkey(d);
    if (window.logCache?.[k]) dhLogs[k] = JSON.parse(JSON.stringify(window.logCache[k]));
    else allCached = false;
  });
  if (side === 'left') { dhAllDates.unshift(...dates); dhMinOffset = nextOff; }
  else { dhAllDates.push(...dates); dhMaxOffset = nextOff; }
  dhLoadedOffsets.add(nextOff);
  buildHeatmapGrid();
  if (side === 'left') {
    requestAnimationFrame(() => { el.scrollLeft = prevLeft + (el.scrollWidth - prevWidth); });
  }

  if (!allCached) {
    try {
      const w0 = el.scrollWidth;
      const l0 = el.scrollLeft;
      await fetchHeatmapRange(dates);
      buildHeatmapGrid();
      if (side === 'left') {
        requestAnimationFrame(() => { el.scrollLeft = l0 + (el.scrollWidth - w0); });
      }
      // New historical data may change the weight delta / first-record label.
      try { window.renderWeight?.(); } catch {}
    } catch (e) { /* silent */ }
  }
  requestAnimationFrame(() => { dhLoadingMore = false; });
}

export function dhSelectDate(k, ts) {
  const d = new Date(ts);
  if (typeof window.selectDay === 'function') {
    window.selectDay(d, k);
  }
  // Re-render to update selected highlight; selectDay will trigger day-strip
  // re-render which we hijack. Call buildHeatmapGrid afterwards.
  requestAnimationFrame(buildHeatmapGrid);
}

// Lightweight haptic on date select when running on native shells.
export function dhTapFeedback() {
  try {
    if (window.sh?.haptics?.tap) window.sh.haptics.tap('light');
  } catch { /* noop */ }
}
