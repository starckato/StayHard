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

const DH_DAY_W = 44;
const DH_LABEL_W = 46;
const DH_GAP = 2;

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

// Editorial monochrome palette (v4) — pure brightness ladder, no hue.
// Intensity maps to commitment: bright ivory fill = completed, mid-gray =
// partial, dark charcoal = missed. Empty is a thin outline so the grid
// rhythm stays visible even on untouched days.
function cellColor(status) {
  if (status === 'pass')    return { bg: 'rgba(234,234,240,0.78)', fg: '#0a0a0c' };
  if (status === 'partial') return { bg: 'rgba(234,234,240,0.32)', fg: 'var(--text)' };
  if (status === 'fail')    return { bg: 'rgba(44,44,52,0.95)', fg: 'var(--text3)', outline: 'rgba(255,255,255,0.08)' };
  if (status === 'future')  return { bg: 'transparent', outline: 'rgba(255,255,255,0.08)', dashed: true };
  return { bg: 'transparent', outline: 'rgba(255,255,255,0.10)' };
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
  // Selected column tint lives on EVERY cell in the matching column so the
  // highlight reads as a vertical bar spanning all rows.
  const SEL_TINT = 'rgba(255,255,255,0.07)';
  const MON_SEP = 'rgba(255,255,255,0.06)';
  const lbl = `display:table-cell;vertical-align:middle;position:sticky;left:0;z-index:2;background:var(--bg);width:${DH_LABEL_W}px;min-width:${DH_LABEL_W}px;padding:3px 8px 3px 10px;`;
  const dayBase = `display:table-cell;vertical-align:middle;width:${DH_DAY_W}px;min-width:${DH_DAY_W}px;padding:${DH_GAP}px;`;
  const cellStyle = (isSel, isMon) =>
    `${dayBase}cursor:pointer;${isSel ? `background:${SEL_TINT};` : ''}${isMon ? `border-left:1px solid ${MON_SEP};` : ''}`;

  // Row 1 — today dot + day-of-week letter, month tag on first date of a month
  let rDay = '<div style="display:table-row;">';
  rDay += `<div style="${lbl}"></div>`;
  dhAllDates.forEach((d, i) => {
    const k = dkey(d);
    const isT = k === window.TODAY;
    const isSel = k === window.selectedKey;
    const dayIdx = (d.getDay() + 6) % 7;
    const isMon = dayIdx === 0 && i > 0;
    const prev = i > 0 ? dhAllDates[i - 1] : null;
    const monthChanged = !prev || prev.getMonth() !== d.getMonth();
    const showMonth = i === 0 || monthChanged;
    const monthTag = showMonth
      ? `<div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:1px;">${d.getMonth() + 1}월</div>`
      : '<div style="font-size:9px;margin-bottom:1px;opacity:0;">·</div>';
    const todayDot = isT
      ? '<div style="width:5px;height:5px;border-radius:50%;background:var(--accent);margin:0 auto 2px;"></div>'
      : '<div style="width:5px;height:5px;margin:0 auto 2px;opacity:0;"></div>';
    rDay += `<div onclick="dhSelectDate('${k}',${d.getTime()})" style="${cellStyle(isSel, isMon)}text-align:center;">${monthTag}${todayDot}<div style="font-size:10px;font-weight:700;letter-spacing:.04em;color:${isSel ? 'var(--text)' : 'var(--text3)'};">${DAY_NAMES[dayIdx]}</div></div>`;
  });
  rDay += '</div>';

  // Row 2 — date number
  let rNum = '<div style="display:table-row;">';
  rNum += `<div style="${lbl}"></div>`;
  dhAllDates.forEach((d, i) => {
    const k = dkey(d);
    const isSel = k === window.selectedKey;
    const dayIdx = (d.getDay() + 6) % 7;
    const isMon = dayIdx === 0 && i > 0;
    const fg = isSel ? 'var(--text)' : 'var(--text2)';
    rNum += `<div onclick="dhSelectDate('${k}',${d.getTime()})" style="${cellStyle(isSel, isMon)}text-align:center;padding-top:0;padding-bottom:5px;"><div style="font-size:13px;font-weight:600;color:${fg};">${d.getDate()}</div></div>`;
  });
  rNum += '</div>';

  // Category rows — borderless filled cells only, column-wide tint for selected
  const catRows = DH_ROWS.map(cat => {
    let row = '<div style="display:table-row;">';
    row += `<div style="${lbl}padding:4px 8px 4px 10px;"><span style="font-size:10px;font-weight:600;color:var(--text3);letter-spacing:.02em;">${cat.lbl}</span></div>`;
    dhAllDates.forEach((d, i) => {
      const k = dkey(d);
      const dl = window.logCache?.[k] || dhLogs[k];
      const isFuture = d > window.now && k !== window.TODAY;
      const isSel = k === window.selectedKey;
      const dayIdx = (d.getDay() + 6) % 7;
      const isMon = dayIdx === 0 && i > 0;
      const status = cellStatus(dl, cat.key, isFuture);
      const { bg, fg, outline, dashed } = cellColor(status);

      let inner = '';
      if (cat.key === 'tasks' && !isFuture) {
        const { text, count } = taskPreview(dl);
        if (text) {
          const label = escapeHtml(text);
          const textColor = status === 'pass' ? '#0a0a0c' : 'var(--text2)';
          const extraColor = status === 'pass' ? 'rgba(10,10,12,0.55)' : 'var(--text3)';
          const extra = count > 1 ? `<span style="font-size:8px;color:${extraColor};margin-left:2px;">+${count - 1}</span>` : '';
          inner = `<span style="font-size:9px;color:${textColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${DH_DAY_W - 6}px;">${label}</span>${extra}`;
        }
      }

      const borderDecl = outline
        ? `border:1px ${dashed ? 'dashed' : 'solid'} ${outline};`
        : 'border:1px solid transparent;';
      row += `<div onclick="dhSelectDate('${k}',${d.getTime()})" style="${cellStyle(isSel, isMon)}"><div style="height:20px;border-radius:4px;background:${bg};${borderDecl}display:flex;align-items:center;justify-content:center;padding:0 4px;overflow:hidden;box-sizing:border-box;">${inner}</div></div>`;
    });
    row += '</div>';
    return row;
  }).join('');

  grid.innerHTML = rDay + rNum + catRows;
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
    const cellLeft = DH_LABEL_W + idx * (DH_DAY_W + DH_GAP * 2);
    outer.scrollLeft = Math.max(0, cellLeft - (outer.clientWidth - DH_DAY_W) / 2);
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
