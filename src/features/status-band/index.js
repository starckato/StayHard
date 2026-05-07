// 큐록 · features/status-band — Tier Hero v2.
//
// 스크롤하면 사라지는 atmosphere/personal 영역. 캐릭터 정체성 + tier 동기부여.
// stats summary 는 sticky-header 가 담당 — 역할 분리.
//
// 외부 의존성 (window 글로벌):
//   TIERS, TIER_QUOTES (src/lib/tier.js — 이미 spread 됨)
//   openRoomOverlay (index.html inline)
//   CP, CU.
//
// API:
//   renderTierLadder(tierIdx)  — 6단 ladder dots 렌더 (current/done/future)
//   cycleQuote(tierName)       — quote 풀 다음 항목으로 회전. localStorage 영속
//   setupStatusBand()           — 이벤트 wiring (quote 클릭, ladder 클릭). 부트시 1회.

const _LADDER_NAMES = ['방관자', '각성자', '저항자', '수련자', '지배자', '기록자'];
const _LADDER_ICONS = ['😴', '⚡', '🦴', '🔥', '👑', '🏆'];

/** 6단 tier ladder 마크업 렌더. tierIdx (0~5) 의 위치 highlight. */
export function renderTierLadder(tierIdx) {
  const wrap = document.getElementById('sb-ladder');
  if (!wrap) return;
  const TIERS = window.TIERS || [];
  const html = _LADDER_NAMES.map((name, i) => {
    let cls = 'sb-ladder-step';
    if (i < tierIdx) cls += ' is-done';
    else if (i === tierIdx) cls += ' is-current';
    const tier = TIERS[i];
    const colorVar = (tier && tier.color) ? `--ladder-color:${tier.color};` : '';
    return `<div class="${cls}" data-tier-idx="${i}" style="${colorVar}" onclick="window.openRoomOverlay&&window.openRoomOverlay()">
      <span class="sb-ladder-dot"></span>
      <span class="sb-ladder-name">${name}</span>
    </div>`;
  }).join('');
  wrap.innerHTML = html;
}

/** Quote 회전 인덱스 — localStorage 영속. tier 별 별도 저장. */
function _quoteIdxKey(tierName) {
  const CU = window.CU;
  const id = CU?.id || 'anon';
  return `sb_quote_idx_${id}_${tierName}`;
}
function _readQuoteIdx(tierName) {
  try {
    const v = parseInt(localStorage.getItem(_quoteIdxKey(tierName)) || '0', 10);
    return isNaN(v) ? 0 : v;
  } catch { return 0; }
}
function _writeQuoteIdx(tierName, idx) {
  try { localStorage.setItem(_quoteIdxKey(tierName), String(idx)); } catch {}
}

/** Quote 회전 — 같은 tier 풀 안에서 다음 항목. 회전 시 fade-out → in 트랜지션. */
export function cycleQuote(tierName) {
  const TIER_QUOTES = window.TIER_QUOTES || {};
  const pool = TIER_QUOTES[tierName] || TIER_QUOTES['방관자'] || ['오늘이 첫 칸이다.'];
  const cur = _readQuoteIdx(tierName);
  const next = (cur + 1) % pool.length;
  _writeQuoteIdx(tierName, next);
  const el = document.getElementById('char-quote');
  if (!el) return;
  el.classList.add('cycling');
  setTimeout(() => {
    el.textContent = '"' + pool[next] + '"';
    el.classList.remove('cycling');
  }, 250);
}

/** Status Band 의 quote 의 *현재 인덱스* quote 를 반환. renderCharCard 가 호출. */
export function getCurrentQuote(tierName) {
  const TIER_QUOTES = window.TIER_QUOTES || {};
  const pool = TIER_QUOTES[tierName] || TIER_QUOTES['방관자'] || ['오늘이 첫 칸이다.'];
  const idx = _readQuoteIdx(tierName);
  return pool[idx % pool.length];
}

/** 부트시 1회 — quote 클릭 wiring. */
export function setupStatusBand() {
  const quoteEl = document.getElementById('char-quote');
  if (quoteEl && !quoteEl._sbWired) {
    quoteEl._sbWired = true;
    quoteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      // 현재 tier 추출 — TIER_QUOTES 풀 회전.
      const TIERS = window.TIERS || [];
      const score = +(window.CP?.total_score) || 0;
      const getTier = window.getTier;
      const tier = (typeof getTier === 'function') ? getTier(score) : (TIERS[0] || { name: '방관자' });
      cycleQuote(tier.name);
    });
  }
}

/**
 * yesterday-ribbon (또는 다른 promo) 가시성에 따라 body 클래스 토글.
 * compact 모드 트리거. 외부 (yesterday-ribbon 핸들러) 가 호출.
 */
export function setYrActive(active) {
  document.body.classList.toggle('has-yr-active', !!active);
}

/**
 * 오늘 4 카테고리 (식단·운동·루틴·할일) 완수도 렌더.
 * Cube system 의 categorical judger (judgeDiet/judgeExercise/judgeRoutine/judgeTasks)
 * 결과를 그대로 사용 — 디자인 시스템 일관성.
 *
 * 각 cell 의 상태 클래스:
 *   gold (clean / all done)        → .is-done
 *   silver (partial / 1+ logged)   → .is-partial
 *   crimson (fail / red registered) → .is-fail
 *   gray / null                    → (no class — dim)
 *
 * stat (N/4) — gold 카테고리 갯수. 4/4 = .is-perfect (강한 glow).
 *
 * renderCharCard 가 호출 — 모든 액션 후 자동 갱신.
 */
export function renderCompletion() {
  const log = window.log;
  if (!log) return;
  const Cubes = window.Cubes || {};
  const judgeDiet     = Cubes.judgeDiet     || (() => 'gray');
  const judgeExercise = Cubes.judgeExercise || (() => ({ exercise: 'gray' }));
  const judgeRoutine  = Cubes.judgeRoutine  || (() => 'gray');
  const judgeTasks    = Cubes.judgeTasks    || (() => null);

  // 오늘 요일 (Mon-based) — judgeRoutine 패턴.
  const wd = (new Date().getDay() + 6) % 7;

  const states = {
    diet:     judgeDiet(log.meals || []),
    exercise: (judgeExercise(log.workouts || []) || {}).exercise || 'gray',
    routine:  judgeRoutine(log.mandatory || [], wd),
    tasks:    judgeTasks(log.targets || []),
  };

  let doneCount = 0;
  Object.entries(states).forEach(([cat, color]) => {
    const cell = document.querySelector(`.cm-cell[data-cat="${cat}"]`);
    if (!cell) return;
    cell.classList.remove('is-done', 'is-partial', 'is-fail');
    if (color === 'gold') {
      cell.classList.add('is-done');
      doneCount++;
    } else if (color === 'silver') {
      cell.classList.add('is-partial');
    } else if (color === 'crimson') {
      cell.classList.add('is-fail');
    }
    // gray / null = no class → dim default
  });

  const num = document.getElementById('cm-stat-num');
  if (num) num.textContent = doneCount;
  const stat = num?.parentElement;
  if (stat) stat.classList.toggle('is-perfect', doneCount === 4);
}
