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

// Cube color → heatmap status mapping.
// Will Cube Phase 1 데이터 (log.cubes)가 있으면 우선 사용.
// 없는 과거 로그는 기존 legacy 판정으로 fallback (과거 데이터 호환).
const CUBE_TO_STATUS = {
  gold:    'pass',
  silver:  'partial',
  crimson: 'fail',
  gray:    'empty',
};

function statusFromCube(color) {
  if (color == null) return 'empty';
  return CUBE_TO_STATUS[color] || 'empty';
}

function cellStatus(dl, cat, isFuture) {
  if (isFuture) return 'future';
  if (!dl) return 'empty';
  // Phase 1 이후 — log.cubes 가 있으면 그걸로 판정. 실시간 판정 결과와 정확히 일치.
  if (dl.cubes) {
    const key = cat === 'meal' ? 'diet' : cat === 'workout' ? 'exercise' : cat;
    return statusFromCube(dl.cubes[key]);
  }
  // Legacy fallback — cubes 없던 과거 로그. 기존 판정 규칙 그대로.
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

// 운동 슬롯에 exercise_bonus gold 가 있으면 2개 겹친 double-cube 로 렌더.
// 없으면 단일 사각형. dateKey 받아서 tooltip 트리거 바인딩.
function workoutIndicator(dl, isFuture, size, dateKey) {
  const status = cellStatus(dl, 'workout', isFuture);
  const hasBonus = !isFuture && dl && dl.cubes && dl.cubes.exercise === 'gold' && dl.cubes.exercise_bonus === 'gold';
  const tapHandler = isFuture
    ? ''
    : `onclick="event.stopPropagation();window.dhShowCubeTooltip&&window.dhShowCubeTooltip(event,'${dateKey}','workout')"`;
  if (!hasBonus) {
    return `<span ${tapHandler} style="display:inline-block;width:${size}px;height:${size}px;border-radius:2px;box-sizing:border-box;cursor:pointer;touch-action:manipulation;${indicatorStyle(status)}"></span>`;
  }
  // Double-cube: back square (offset) + front square — 3px overlap.
  const overlap = 3;
  const totalW = size + overlap;
  return (
    `<span ${tapHandler} style="display:inline-block;position:relative;width:${totalW}px;height:${size}px;flex-shrink:0;cursor:pointer;touch-action:manipulation;">` +
      `<span style="position:absolute;left:${overlap}px;top:0;width:${size}px;height:${size}px;border-radius:2px;box-sizing:border-box;${indicatorStyle(status)}opacity:0.6;"></span>` +
      `<span style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;border-radius:2px;box-sizing:border-box;${indicatorStyle(status)}"></span>` +
    `</span>`
  );
}

// bonus 배열이 비어있지 않으면 tile 우상단에 작은 황금 ★ 표시.
// 탭 시 dhOpenBonusPopover(dateKey) 로 breakdown 팝오버 오픈.
function bonusStarBadge(dl, isFuture, dateKey) {
  if (isFuture || !dl || !dl.cubes || !Array.isArray(dl.cubes.bonus) || dl.cubes.bonus.length === 0) return '';
  return (
    `<button onclick="event.stopPropagation();window.dhOpenBonusPopover&&window.dhOpenBonusPopover('${dateKey}')" ` +
    `aria-label="보너스 내역" ` +
    `style="position:absolute;top:2px;right:2px;width:14px;height:14px;padding:0;background:transparent;border:none;cursor:pointer;touch-action:manipulation;line-height:0;">` +
      `<svg width="10" height="10" viewBox="0 0 24 24" fill="url(#dh-gold-grad)" ` +
      `style="filter:drop-shadow(0 0 2px rgba(255,213,74,0.6));">` +
        `<polygon points="12,2 15,9 22,9 17,14 19,22 12,18 5,22 7,14 2,9 9,9"/>` +
      `</svg>` +
    `</button>`
  );
}

// 헤드리스 SVG gradient 정의 — tile 전체에서 한 번만 선언. buildHeatmapGrid 진입시 삽입.
const DH_SVG_DEFS = `<svg width="0" height="0" style="position:absolute;" aria-hidden="true"><defs><linearGradient id="dh-gold-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff1a8"/><stop offset="45%" stop-color="#ffd54a"/><stop offset="100%" stop-color="#c48c1a"/></linearGradient></defs></svg>`;

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
    // 운동 자리는 exercise_bonus 가 있으면 double-cube 로 살짝 넓어짐 (overlap 3px).
    const indicatorSize = Math.floor((DH_TILE_W - 10 - 2 * 3) / 4);
    const indicators = DH_ROWS.map(cat => {
      if (cat.key === 'workout') return workoutIndicator(dl, isFuture, indicatorSize, k);
      const status = cellStatus(dl, cat.key, isFuture);
      const tapHandler = isFuture
        ? ''
        : `onclick="event.stopPropagation();window.dhShowCubeTooltip&&window.dhShowCubeTooltip(event,'${k}','${cat.key}')"`;
      return `<span ${tapHandler} style="display:inline-block;width:${indicatorSize}px;height:${indicatorSize}px;border-radius:2px;box-sizing:border-box;cursor:pointer;touch-action:manipulation;${indicatorStyle(status)}"></span>`;
    }).join('');
    const bonusStar = bonusStarBadge(dl, isFuture, k);

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
        ${bonusStar}
        ${todayDot}
        <div style="font-size:9px;font-weight:700;letter-spacing:.06em;color:${dayColor};margin-top:3px;">${DAY_NAMES[dayIdx]}</div>
        <div style="font-size:18px;font-weight:700;color:${numColor};font-family:'DM Mono',monospace;line-height:1;margin-top:2px;margin-bottom:auto;">${d.getDate()}</div>
        <div style="display:flex;gap:3px;align-items:center;justify-content:center;">${indicators}</div>
      </div>
    `;
  }).join('');

  grid.innerHTML = `${DH_SVG_DEFS}<div style="display:flex;gap:${DH_GAP}px;padding:22px 14px 8px;">${tiles}</div>`;
}

async function fetchHeatmapRange(dates) {
  if (!dates || !dates.length || !window.CU) return;
  const from = dkey(dates[0]);
  const to = dkey(dates[dates.length - 1]);
  const { data } = await sb.from('daily_logs')
    .select('log_date,weight,water_cups,meals,workouts,mandatory,targets,cubes')
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
      cubes: d.cubes || null,
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

// ══════════════════════════════════════════════════════════════════════════
// Phase 2b — 큐브 tap 툴팁 + bonus ★ 팝오버
// ══════════════════════════════════════════════════════════════════════════

// 색 + 카테고리별 Korean 메시지. manifesto / editorial 톤 유지.
const CUBE_TOOLTIP_COPY = {
  meal: {
    gold:    '모든 끼니 청정',
    silver:  '일부 청정, 흔들림 없이',
    crimson: '오늘 한 번 흔들렸다',
    gray:    '식사 기록 없음',
  },
  workout: {
    gold:    '운동 완료',
    gray:    '운동 기록 없음',
  },
  routine: {
    gold:    '모든 루틴 완수',
    silver:  '일부 완수, 실패 없음',
    crimson: '루틴 실패 있음',
    gray:    '루틴 기록 없음',
  },
  tasks: {
    gold:    '모든 할일 완수',
    silver:  '부분 완수, 실패 없음',
    crimson: '할일 실패 있음',
    gray:    '할일 미등록',
  },
};

function _cubeColorForCat(dl, cat) {
  if (!dl || !dl.cubes) return null;
  const key = cat === 'meal' ? 'diet' : cat === 'workout' ? 'exercise' : cat;
  return dl.cubes[key];
}

function _legacyColorForCat(dl, cat) {
  const status = cellStatus(dl, cat, false);
  // cellStatus → cube color (역매핑)
  if (status === 'pass') return 'gold';
  if (status === 'partial') return 'silver';
  if (status === 'fail') return 'crimson';
  return 'gray';
}

// 큐브 탭 시 짧은 floating chip. 1.8s 후 자동 사라짐. 다음 tap 으로 덮어쓰기.
let _cubeTooltipEl = null;
let _cubeTooltipTimer = null;
export function dhShowCubeTooltip(event, dateKey, cat) {
  try {
    const dl = window.logCache?.[dateKey] || dhLogs[dateKey];
    const color = _cubeColorForCat(dl, cat) || _legacyColorForCat(dl, cat);
    const text = (CUBE_TOOLTIP_COPY[cat] && CUBE_TOOLTIP_COPY[cat][color]) || '기록 없음';
    // ⚠️ 측정 순서 중요 — selectDay() 는 buildHeatmapGrid 를 trigger 해서 event.target
    // 을 DOM 에서 분리시킨다. 먼저 좌표를 캐시한 뒤 selectDay 를 호출.
    let x = 0, y = 0;
    const t = event && event.target && event.target.getBoundingClientRect && event.target.getBoundingClientRect();
    if (t) { x = t.left + t.width / 2; y = t.top; }
    else if (event && (event.clientX != null)) { x = event.clientX; y = event.clientY; }
    // 해당 날짜로 포커스 이동 — 탭한 날이 선택되지 않은 상태면 먼저 선택.
    // 이미 selected 면 스킵 (불필요한 re-render 방지).
    if (dateKey !== window.selectedKey && typeof window.dhSelectDate === 'function') {
      const d = new Date(dateKey + 'T00:00:00');
      if (!isNaN(d)) window.dhSelectDate(dateKey, d.getTime());
    }
    if (_cubeTooltipEl && _cubeTooltipEl.parentNode) _cubeTooltipEl.parentNode.removeChild(_cubeTooltipEl);
    clearTimeout(_cubeTooltipTimer);
    const chip = document.createElement('div');
    chip.textContent = text;
    chip.style.cssText = [
      'position:fixed',
      'z-index:9999',
      'padding:6px 10px',
      'border-radius:8px',
      'background:rgba(20,20,24,0.94)',
      'border:1px solid rgba(255,255,255,0.14)',
      'color:#eaeaf0',
      'font-size:11px',
      'font-weight:600',
      'letter-spacing:-0.005em',
      'line-height:1.2',
      'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
      'pointer-events:none',
      'opacity:0',
      'transform:translateY(4px)',
      'transition:opacity 140ms ease-out,transform 140ms ease-out',
      'white-space:nowrap',
      'max-width:160px',
    ].join(';');
    document.body.appendChild(chip);
    requestAnimationFrame(() => {
      const w = chip.offsetWidth;
      const h = chip.offsetHeight;
      const leftClamp = Math.max(6, Math.min(window.innerWidth - w - 6, x - w / 2));
      const topClamp = Math.max(6, y - h - 8);
      chip.style.left = leftClamp + 'px';
      chip.style.top = topClamp + 'px';
      chip.style.opacity = '1';
      chip.style.transform = 'translateY(0)';
    });
    _cubeTooltipEl = chip;
    _cubeTooltipTimer = setTimeout(() => {
      if (chip.parentNode) {
        chip.style.opacity = '0';
        chip.style.transform = 'translateY(4px)';
        setTimeout(() => { if (chip.parentNode) chip.parentNode.removeChild(chip); }, 160);
      }
    }, 1800);
  } catch (e) { /* silent */ }
}

// ── Bonus ★ 탭 → 팝오버 breakdown ──────────────────────────
// body 에 overlay + 중앙 sheet. 탭 바깥 or 닫기로 해제.
function _bonusItemLabel(b) {
  if (!b || !b.type) return '보너스';
  if (b.type === 'pr') {
    const name = b.exerciseName || '운동';
    const kindLbl = b.kind === 'one_rm' ? '1RM'
      : b.kind === 'volume' ? '볼륨'
      : b.kind === 'rep_max' ? (b.reps ? b.reps + 'rep' : 'rep') : 'PR';
    const kg = (b.kg != null) ? (typeof b.kg === 'number' ? b.kg : parseFloat(b.kg)) : null;
    const kgStr = (kg != null && !isNaN(kg)) ? (Number.isInteger(kg) ? kg + 'kg' : kg.toFixed(1) + 'kg') : '';
    return `PR 갱신 — ${name} ${kindLbl} ${kgStr}`.trim();
  }
  if (b.type && b.type.startsWith('streak_')) {
    const days = b.type.split('_')[1] || '';
    return `${days}일 스트릭`;
  }
  if (b.type === 'race' || b.name) {
    return (b.name ? (b.name + ' ') : '') + '완주';
  }
  return b.type;
}

export function dhOpenBonusPopover(dateKey) {
  try {
    dhCloseBonusPopover();
    const dl = window.logCache?.[dateKey] || dhLogs[dateKey];
    const bonus = (dl && dl.cubes && Array.isArray(dl.cubes.bonus)) ? dl.cubes.bonus : [];
    if (!bonus.length) return;
    const overlay = document.createElement('div');
    overlay.id = 'dh-bonus-overlay';
    overlay.setAttribute('onclick', 'if(event.target===this)window.dhCloseBonusPopover&&window.dhCloseBonusPopover()');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:10000',
      'background:rgba(0,0,0,0.6)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'display:flex',
      'align-items:flex-end',
      'justify-content:center',
      'padding:0',
      'animation:dhFadeIn 160ms ease-out',
    ].join(';');
    // 날짜 라벨
    const d = new Date(dateKey + 'T00:00:00');
    const mo = d.getMonth() + 1;
    const dd = d.getDate();
    const wk = ['일','월','화','수','목','금','토'][d.getDay()];
    const rows = bonus.map(b => {
      const count = typeof b.count === 'number' ? b.count : 1;
      return (
        `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">` +
          `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:linear-gradient(135deg,rgba(255,241,168,0.14),rgba(255,213,74,0.10));border:1px solid rgba(255,213,74,0.35);font-size:11px;font-weight:700;color:#ffd54a;letter-spacing:-0.005em;white-space:nowrap;">` +
            `<svg width="9" height="9" viewBox="0 0 24 24" fill="url(#dh-gold-grad)"><polygon points="12,2 15,9 22,9 17,14 19,22 12,18 5,22 7,14 2,9 9,9"/></svg>` +
            `×${count}` +
          `</span>` +
          `<div style="flex:1;min-width:0;font-size:12px;color:var(--text);letter-spacing:-0.005em;line-height:1.3;">${escapeHtml(_bonusItemLabel(b))}</div>` +
        `</div>`
      );
    }).join('');
    const totalCount = bonus.reduce((s, b) => s + (typeof b.count === 'number' ? b.count : 1), 0);
    overlay.innerHTML =
      `<style>@keyframes dhFadeIn{from{opacity:0}to{opacity:1}}@keyframes dhSlideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>` +
      DH_SVG_DEFS +
      `<div role="dialog" aria-label="보너스 내역" style="width:100%;max-width:420px;background:var(--surface);border-top:1px solid rgba(255,255,255,0.08);border-radius:14px 14px 0 0;padding:6px 0 10px;margin-bottom:0;animation:dhSlideUp 220ms cubic-bezier(0.16,1,0.3,1);box-shadow:0 -12px 40px rgba(0,0,0,0.4);">` +
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">` +
          `<div>` +
            `<div style="font-size:10px;color:var(--text3);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${mo}월 ${dd}일 (${wk})</div>` +
            `<div style="font-size:14px;color:var(--text);font-weight:800;letter-spacing:-0.01em;margin-top:2px;">보너스 ×${totalCount}</div>` +
          `</div>` +
          `<button onclick="window.dhCloseBonusPopover&&window.dhCloseBonusPopover()" aria-label="닫기" style="background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:6px 8px;line-height:1;touch-action:manipulation;">✕</button>` +
        `</div>` +
        `<div>${rows}</div>` +
      `</div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  } catch (e) { /* silent */ }
}

export function dhCloseBonusPopover() {
  const el = document.getElementById('dh-bonus-overlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  document.body.style.overflow = '';
}
