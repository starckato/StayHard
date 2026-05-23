// 큐록 · features/cubes/ui-events — 큐브 보상 인터랙션 (popover + banner + recap).
//
// 추출 (2026-05-07): index.html 의 ~6855-7244 region 에서 통째로 이전.
// 기존 동작과 1:1 — 함수 시그니처 / DOM 클래스 / 타이밍 모두 그대로.
//
// 외부 의존성 (window 글로벌 — 점진적으로 줄여나갈 예정):
//   CU (current user), sb (Supabase client), dkey (date key formatter),
//   logCache, log, window.sh.platform / window.sh.haptics.
//
// 추출 안 된 형제 함수들 (recomputeCubesHook / renderCardCubes / renderCubeStack /
// getCubeCounts 등) 는 index.html 에 잔존. 다음 단계에서 분리.

// ─────────────────────────────────────────────────────────────
// 1. Constants (color copy + timing + score points)
// ─────────────────────────────────────────────────────────────

export const CUBE_CHANGE_COPY = {
  diet: {
    gold:    { title: '식단 gold',    body: 'clean 2끼 이상' },
    silver:  { title: '식단 silver',  body: '기록 하나 채움' },
    crimson: { title: '식단 crimson', body: '오늘 한 번 흔들렸다' },
  },
  exercise: {
    gold:    { title: '운동 gold',    body: '땀 흘린 하루' },
    crimson: { title: '운동 crimson', body: '' },
  },
  exercise_bonus: {
    gold:    { title: '이중 큐브',    body: '헬스 + 유산소 완료' },
  },
  routine: {
    gold:    { title: '루틴 gold',    body: '모든 루틴 완수' },
    silver:  { title: '루틴 silver',  body: '실패 없이 부분 완수' },
    crimson: { title: '루틴 crimson', body: '실패도 기록이다' },
  },
  tasks: {
    gold:    { title: '할일 gold',    body: '모든 할일 완수' },
    silver:  { title: '할일 silver',  body: '부분 완수' },
    crimson: { title: '할일 crimson', body: '오늘 한 번 졌다' },
  },
};

// 색상별 절대 점수 — Phase 1 src/features/cubes/score.js 의 BASE_SCORE 와 동일.
const _CUBE_COLOR_POINTS = { gold: 3, silver: 2, crimson: -3, gray: 0 };
export function _cubeColorPoints(c) {
  if (c == null) return 0;
  return _CUBE_COLOR_POINTS[c] || 0;
}
export function _formatCubeDelta(n) {
  return n > 0 ? ('+' + n) : n < 0 ? ('−' + Math.abs(n)) : '0';
}
export function _cubeColorMeta(color) {
  if (color === 'gold')    return { fg: '#ffd54a', border: 'rgba(255,213,74,0.55)', bg: 'linear-gradient(135deg,rgba(255,241,168,0.15) 0%,rgba(255,213,74,0.10) 100%)' };
  if (color === 'silver')  return { fg: '#b5c0cc', border: 'rgba(181,192,204,0.50)', bg: 'linear-gradient(135deg,rgba(242,244,247,0.12) 0%,rgba(181,192,204,0.08) 100%)' };
  if (color === 'crimson') return { fg: '#ff6b6b', border: 'var(--accent-tint-4)', bg: 'var(--accent-tint-2)' };
  return { fg: '#eaeaf0', border: 'rgba(255,255,255,0.14)', bg: 'rgba(20,20,24,0.92)' };
}

// 타이밍 상수 — CSS 와 일치 (cubes-ui.css 의 transition duration).
// 2026-04-24 유저 피드백: 글씨 읽기 전에 depart 시작 → linger 500ms 로 확장.
const _CUBE_SHOW_MS   = 280;  // fade + scale in
const _CUBE_LINGER_MS = 500;  // 정지 구간 — 라벨 읽을 시간
const _CUBE_DEPART_MS = 900;  // 회전 + 비상 + fade out

// ─────────────────────────────────────────────────────────────
// 2. Cube event popover engine
// ─────────────────────────────────────────────────────────────

// _warmupCube3D — Arc Throw 전환 (2026-05-23) 후 3D 큐브 사용 안 함. no-op.
export function _warmupCube3D() { /* deprecated — Arc Throw 패턴엔 3D cube 없음 */ }

// 팝오버 중첩 큐 — 동시 변경 여러 개면 짧은 텀으로 순차 노출.
let _cubeEventQueue = [];
let _cubeEventShowing = false;

// ── Arc Throw (2026-05-23 prototype A41 통합) ──
// 카드 중앙에서 spawn → 베지어 포물선 → counter 도착 → cleanup.
// 이전 Zen Tap (1.8s 부유 + 탭 강제) 폐기 — 사용자 피드백 "휙 하고 날라가게".

const _ARC_FLIGHT_MS = 420;       // 큐브 비행 시간 (animation duration)
const _ARC_QUEUE_ADVANCE_MS = 70; // 다음 큐브 발사까지 — 4 burst 시 trajectory 자연 overlap
const _ARC_HEIGHT_PX = 90;        // 포물선 정점 — 직선 중간보다 위로 N px

const _CARD_FOR_CAT = {
  diet:     'food-card',
  exercise: 'workout-card',
  routine:  'routine-card',
  tasks:    'targets-card',
  weight:   'wt-card',
};

function _zenCardForEvent(ev) {
  if (!ev || !ev.cat) return null;
  const id = _CARD_FOR_CAT[ev.cat];
  return id ? document.getElementById(id) : null;
}

function _zenTargetForColor(color) {
  // sticky-header cube counter 의 숫자 노드. gold/silver/red 모두 wired.
  if (color === 'gold')                       return document.getElementById('cc-num-gold');
  if (color === 'silver')                     return document.getElementById('cc-num-silver');
  if (color === 'red' || color === 'crimson') return document.getElementById('cc-num-red');
  return document.getElementById('cc-num-silver') || document.getElementById('cc-num-gold');
}

function _arcTargetDotForColor(color) {
  // sticky-header dot — pulse 효과 대상.
  if (color === 'gold')                       return document.getElementById('sh-dot-gold');
  if (color === 'silver')                     return document.getElementById('sh-dot-silver');
  if (color === 'red' || color === 'crimson') return document.getElementById('sh-dot-red');
  return null;
}

function _tintCard(cardEl, color) {
  if (!cardEl) return;
  const cls = 'zen-card-tint-' + color;
  cardEl.classList.remove('zen-card-tint-gold', 'zen-card-tint-silver', 'zen-card-tint-red', 'zen-card-tint-crimson');
  void cardEl.offsetWidth;
  cardEl.classList.add(cls);
  setTimeout(() => cardEl.classList.remove(cls), 1100);
}

function _bumpStackNum(numEl, color) {
  if (!numEl) return;
  numEl.classList.remove('zen-bumped');
  void numEl.offsetWidth;
  numEl.classList.add('zen-bumped');
  setTimeout(() => numEl.classList.remove('zen-bumped'), 480);
}

function _pulseStackDot(dotEl) {
  if (!dotEl) return;
  dotEl.classList.remove('arc-pulse');
  void dotEl.offsetWidth;
  dotEl.classList.add('arc-pulse');
  setTimeout(() => dotEl.classList.remove('arc-pulse'), 360);
}

/**
 * Red collapse: sticky shake + 캐릭터 휘청 + 카드 tint + heavy haptic.
 * (token fall + crack overlay 는 후속 단계에서 추가)
 */
function _playRedCollapse(ev, onDone) {
  const cardEl = _zenCardForEvent(ev);
  _tintCard(cardEl, 'red');

  // Sticky header shake + burn flash — sticky-header feature 의 헬퍼 호출.
  try { window.applyRedCollapse?.(); } catch (_) {}

  // 캐릭터 휘청.
  try {
    const charEl = document.querySelector('.sb-canvas-wrap');
    if (charEl && charEl.animate) {
      charEl.animate(
        [
          { transform: 'translateX(0) scale(1)', filter: 'saturate(1)' },
          { transform: 'translateX(-6px) scale(0.95) rotate(-4deg)', filter: 'saturate(0.4) brightness(0.7)' },
          { transform: 'translateX(6px) scale(1.02) rotate(3deg)', filter: 'saturate(0.5) brightness(0.8)' },
          { transform: 'translateX(0) scale(1) rotate(0)', filter: 'saturate(1)' },
        ],
        { duration: 700, easing: 'cubic-bezier(.55,0,.45,1)' }
      );
    }
  } catch (_) { /* silent */ }

  // Heavy haptic.
  if (window.sh?.haptics?.tap) window.sh.haptics.tap('medium');
  else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([40, 30, 40, 30, 60]);
  }

  setTimeout(() => onDone?.(), 900);
}

/**
 * Arc Throw: 카드 중앙 → 베지어 포물선 → counter. 사용자 인터랙션 X.
 * onDone 은 큐 advance 용 — 비행 도중 fire 되어 다음 큐브가 자연 overlap.
 * 도착 시 counter +1 bump + dot pulse + cleanup.
 */
export function _playCubeEvent(ev, onDone) {
  const color = ev.color || 'gray';
  // gray = no-op.
  if (color === 'gray') { onDone?.(); return; }
  // red/crimson 은 collapse 시퀀스 별도 (sticky shake + 캐릭터 휘청).
  if (color === 'red' || color === 'crimson') {
    _playRedCollapse(ev, onDone);
    return;
  }

  const cardEl = _zenCardForEvent(ev);
  const numEl = _zenTargetForColor(color);
  const dotEl = _arcTargetDotForColor(color);

  // 카드 tint 펄스 — "여기서 발사됐다" 신호
  _tintCard(cardEl, color);

  // 시작 좌표 — 카드 중앙
  const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
  const sx = cardRect ? cardRect.left + cardRect.width / 2 : window.innerWidth / 2;
  const sy = cardRect ? cardRect.top + cardRect.height / 2 : window.innerHeight * 0.5;

  // 도착 좌표 — sticky 의 counter 숫자 노드 중앙
  const dRect = (dotEl || numEl)?.getBoundingClientRect();
  const tx = dRect ? dRect.left + dRect.width / 2 : window.innerWidth / 2;
  const ty = dRect ? dRect.top  + dRect.height / 2 : 40;

  const dx = tx - sx;
  const dy = ty - sy;
  // 포물선 정점 = 직선 중간점에서 위로 _ARC_HEIGHT_PX
  const midX = dx / 2;
  const midY = dy / 2 - _ARC_HEIGHT_PX;

  // ── 큐브 element ──
  const cube = document.createElement('div');
  cube.className = 'arc-cube ' + color;
  cube.style.left = (sx - 9) + 'px';
  cube.style.top  = (sy - 9) + 'px';
  cube.style.setProperty('--midX', midX + 'px');
  cube.style.setProperty('--midY', midY + 'px');
  cube.style.setProperty('--endX', dx + 'px');
  cube.style.setProperty('--endY', dy + 'px');
  cube.style.animation = `arcThrow ${_ARC_FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`;
  document.body.appendChild(cube);

  // 도착 시 — pulse + counter bump + haptic + cleanup
  setTimeout(() => {
    _pulseStackDot(dotEl);
    _bumpStackNum(numEl, color);

    if (window.sh?.haptics?.tap) {
      window.sh.haptics.tap(color === 'gold' ? 'medium' : 'light');
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(color === 'gold' ? 22 : 14);
    }

    cube.remove();
  }, _ARC_FLIGHT_MS);

  // 큐 advance 는 일찍 (70ms) — 후속 큐브가 trajectory 도중 overlap 하며 burst 자연스러움.
  setTimeout(() => onDone?.(), _ARC_QUEUE_ADVANCE_MS);
}

export function _showNextCubeEvent() {
  if (!_cubeEventQueue.length) { _cubeEventShowing = false; return; }
  _cubeEventShowing = true;
  const ev = _cubeEventQueue.shift();
  _playCubeEvent(ev, () => {
    // 다음 큐브 즉시 — onDone 이 70ms 후 발화되므로 이미 stagger 효과.
    _showNextCubeEvent();
  });
}

// ─────────────────────────────────────────────────────────────
// 3. Micro Reward Banner — silver 진행 중 조용한 응원 + haptic
// ─────────────────────────────────────────────────────────────

const MICRO_COPY = {
  diet: {
    silver: ['한 끼 기록.','다음 끼니까지.','시작했다. 세 번 더.','첫 끼 OK. 이제 구성.'],
    gold:   ['이미 완수. 더 가도 OK.','보너스 한 끼.','오늘 식단 끝났다.','계속 가.'],
    crimson:['흔들렸다. 복구해라.','한 번 놓쳤다.','내일을 바꿔라.'],
  },
  exercise: {
    silver: ['움직였다.','다음 한 세트.','계속 가.'],
    gold:   ['오늘 운동 끝.','이미 완수. 보너스 세트.','계속 밀어.'],
  },
  routine: {
    silver: ['하나 밀었다.','남은 것 끝내.','절반.','마무리까지.'],
    gold:   ['루틴 다 끝.','이미 완수. 더 채워.'],
    crimson:['놓친 하나. 내일.','실패도 기록이다.'],
  },
  tasks: {
    silver: ['하나 정리.','흐름 잡았다.','거의 다.','남은 건 간단하다.'],
    gold:   ['할일 다 끝.','오늘 깨끗.','보너스 정리.'],
    crimson:['놓쳤다.','내일.'],
  },
  water: {
    silver: ['한 잔.','한 잔 더.','계속 마셔.','목 마를 때 한 모금.'],
    gold:   ['오늘 목표 달성.','보너스 한 잔.','계속.'],
  },
};

export function _pickMicroCopy(cat, color) {
  const pool = (MICRO_COPY[cat] && MICRO_COPY[cat][color]) || ['계속.'];
  return pool[Math.floor(Math.random() * pool.length)];
}

let _microBannerEl = null;
let _microBannerTimers = [];

function _clearMicroBanner() {
  _microBannerTimers.forEach(t => clearTimeout(t));
  _microBannerTimers = [];
  if (_microBannerEl && _microBannerEl.parentNode) {
    _microBannerEl.parentNode.removeChild(_microBannerEl);
  }
  _microBannerEl = null;
}

export function playMicroReward(cat, color) {
  // Haptic
  try {
    const native = window.sh?.platform?.isNative?.();
    if (native && window.sh?.haptics?.tap) {
      window.sh.haptics.tap('light');
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(18);
    }
  } catch (_) { /* silent */ }
  // Banner — 이전 배너 살아있으면 교체.
  _clearMicroBanner();
  const text = _pickMicroCopy(cat, color);
  const el = document.createElement('div');
  el.className = 'micro-banner';
  el.textContent = text;
  document.body.appendChild(el);
  _microBannerEl = el;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('on'); }));
  _microBannerTimers.push(setTimeout(() => { el.classList.remove('on'); el.classList.add('off'); }, 1100));
  _microBannerTimers.push(setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
    if (_microBannerEl === el) _microBannerEl = null;
  }, 1420));
}

// 2026-04-24 유저 피드백:
//   첫 전환 (gray→silver) = cube 연출 + 배너 모두
//   이후 (silver 유지) = 배너만
//   gold (silver→gold) = cube 연출만
let _cubeSilverJustFired = 0;
let _cubeGoldJustFired   = 0;

export function showCubeEvent(ev) {
  if (!ev) return;
  if (ev.type === 'color' && ev.color === 'silver' && ev.cat) {
    playMicroReward(ev.cat, 'silver');
    _cubeSilverJustFired = Date.now();
  }
  if (ev.type === 'color' && ev.color === 'gold' && ev.cat) {
    _cubeGoldJustFired = Date.now();
  }
  _cubeEventQueue.push(ev);
  if (!_cubeEventShowing) _showNextCubeEvent();
}

export function _tryMicroReward(cat) {
  try {
    if (Date.now() - _cubeSilverJustFired < 500) return;
    if (Date.now() - _cubeGoldJustFired   < 500) return;
    const l = (typeof window !== 'undefined') ? window.log : null;
    const cubes = l && l.cubes;
    const color = (cubes && cubes[cat]) || 'silver';
    playMicroReward(cat, color);
  } catch (_) { /* silent */ }
}

// ─────────────────────────────────────────────────────────────
// 4. Diff — before/after cubes → events (count diff + bonus diff)
// ─────────────────────────────────────────────────────────────

export function _diffCubes(before, after) {
  const events = [];
  const bGold   = (before && before.gold)   || 0;
  const bSilver = (before && before.silver) || 0;
  const bRed    = (before && before.red)    || 0;
  const aGold   = (after && after.gold)   || 0;
  const aSilver = (after && after.silver) || 0;
  const aRed    = (after && after.red)    || 0;
  const dGold   = aGold   - bGold;
  const dSilver = aSilver - bSilver;
  const dRed    = aRed    - bRed;
  if (dGold   > 0) events.push({ type: 'count', color: 'gold',   count: dGold,   title: `+${dGold} 골드 큐브`,   body: '',                  delta: _formatCubeDelta(dGold * 3) });
  if (dSilver > 0) events.push({ type: 'count', color: 'silver', count: dSilver, title: `+${dSilver} 실버 큐브`, body: '',                  delta: _formatCubeDelta(dSilver * 1) });
  if (dRed    > 0) events.push({ type: 'count', color: 'red',    count: dRed,    title: `+${dRed} 레드 큐브`,    body: '금지식/위반',       delta: _formatCubeDelta(dRed * -5) });

  const bBonus = (before && Array.isArray(before.bonus)) ? before.bonus : [];
  const aBonus = (after  && Array.isArray(after.bonus))  ? after.bonus  : [];
  if (aBonus.length > bBonus.length) {
    const newOnes = aBonus.slice(bBonus.length);
    for (const b of newOnes) {
      if (!b) continue;
      const count = typeof b.count === 'number' ? b.count : 1;
      const bonusPts = count * 3;
      if (b.type === 'pr') {
        const name = b.exerciseName || '운동';
        const kindLbl = b.kind === 'one_rm' ? '1RM' : b.kind === 'volume' ? '볼륨' : b.kind === 'rep_max' ? ((b.reps || '') + 'rep') : 'PR';
        const kg = (typeof b.kg === 'number') ? (Number.isInteger(b.kg) ? b.kg + 'kg' : b.kg.toFixed(1) + 'kg') : '';
        events.push({ type: 'bonus', color: 'gold', title: 'PR 갱신', body: `${name} ${kindLbl} ${kg}`.trim(), delta: _formatCubeDelta(bonusPts) });
      } else if (typeof b.type === 'string' && b.type.indexOf('streak_') === 0) {
        const days = b.type.split('_')[1] || '';
        events.push({ type: 'bonus', color: 'gold', title: `${days}일 연속 기록`, body: '', delta: _formatCubeDelta(bonusPts) });
      } else {
        events.push({ type: 'bonus', color: 'gold', title: b.name || '보너스', body: '', delta: _formatCubeDelta(bonusPts) });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────
// 5. Daily recap — 다음날 첫 접속 시 어제의 큐브 모음 재생
// ─────────────────────────────────────────────────────────────

export async function runDailyCubeRecap() {
  try {
    const CU = window.CU;
    const sb = window.sb;
    const dkey = window.dkey;
    const logCache = window.logCache;
    if (!CU || !CU.id || !sb || !dkey || !logCache) return;
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yk = dkey(yest);
    const seenKey = 'cube_recap_seen_' + CU.id + '_' + yk;
    if (localStorage.getItem(seenKey) === '1') return;
    let yl = logCache[yk];
    if (!yl) {
      try {
        const { data } = await sb.from('daily_logs').select('*').eq('user_id', CU.id).eq('log_date', yk).maybeSingle();
        if (data) {
          yl = {
            weight: data.weight !== null ? parseFloat(data.weight) : null,
            water_cups: data.water_cups || 0,
            meals: data.meals || [], workouts: data.workouts || [],
            mandatory: data.mandatory || [], targets: data.targets || [],
            _ptsLog: data.points_log || [],
            cubes: data.cubes || null,
          };
          logCache[yk] = yl;
        }
      } catch (e) { /* silent */ }
    }
    if (!yl || !yl.cubes) {
      localStorage.setItem(seenKey, '1');
      return;
    }
    const events = [];
    const cats = [
      { key: 'diet',     cat: 'diet' },
      { key: 'exercise', cat: 'exercise' },
      { key: 'routine',  cat: 'routine' },
      { key: 'tasks',    cat: 'tasks' },
    ];
    for (const c of cats) {
      const color = yl.cubes[c.key];
      if (!color || color === 'gray') continue;
      const copy = CUBE_CHANGE_COPY[c.cat] && CUBE_CHANGE_COPY[c.cat][color];
      if (copy) {
        const pts = _cubeColorPoints(color);
        events.push({ type: 'color', cat: c.cat, color, ...copy, delta: _formatCubeDelta(pts) });
      }
    }
    const bonus = Array.isArray(yl.cubes.bonus) ? yl.cubes.bonus : [];
    for (const b of bonus) {
      if (!b) continue;
      const count = typeof b.count === 'number' ? b.count : 1;
      const bonusPts = count * 3;
      if (b.type === 'pr') {
        const name = b.exerciseName || '운동';
        const kindLbl = b.kind === 'one_rm' ? '1RM' : b.kind === 'volume' ? '볼륨' : b.kind === 'rep_max' ? ((b.reps || '') + 'rep') : 'PR';
        const kg = (typeof b.kg === 'number') ? (Number.isInteger(b.kg) ? b.kg + 'kg' : b.kg.toFixed(1) + 'kg') : '';
        events.push({ type: 'bonus', color: 'gold', title: 'PR 갱신', body: `${name} ${kindLbl} ${kg}`.trim(), delta: _formatCubeDelta(bonusPts) });
      } else if (typeof b.type === 'string' && b.type.indexOf('streak_') === 0) {
        const days = b.type.split('_')[1] || '';
        events.push({ type: 'bonus', color: 'gold', title: `${days}일 연속 기록`, body: '어제 달성', delta: _formatCubeDelta(bonusPts) });
      } else {
        events.push({ type: 'bonus', color: 'gold', title: b.name || '보너스', body: '', delta: _formatCubeDelta(bonusPts) });
      }
    }
    if (!events.length) {
      localStorage.setItem(seenKey, '1');
      return;
    }
    // 인트로 toast
    try {
      const intro = document.createElement('div');
      intro.style.cssText = 'position:fixed;top:max(60px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%) translateY(-12px);z-index:10000;padding:8px 16px;border-radius:var(--radius-lg);background:rgba(20,20,24,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.14);color:var(--text);font-size:var(--text-xs);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 10px 30px rgba(0,0,0,0.45);opacity:0;transition:opacity 220ms ease-out,transform 260ms cubic-bezier(0.16,1,0.3,1);pointer-events:none;';
      intro.textContent = '어제의 큐브';
      document.body.appendChild(intro);
      requestAnimationFrame(() => { intro.style.opacity = '1'; intro.style.transform = 'translateX(-50%) translateY(0)'; });
      setTimeout(() => {
        intro.style.opacity = '0'; intro.style.transform = 'translateX(-50%) translateY(-8px)';
        setTimeout(() => { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 260);
      }, 1400);
    } catch (e) { /* silent */ }
    setTimeout(() => { for (const ev of events) showCubeEvent(ev); }, 500);
    localStorage.setItem(seenKey, '1');
  } catch (e) {
    console.warn('[cube-recap]', e && e.message);
  }
}
