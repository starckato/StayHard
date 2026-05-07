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

// GPU warmup — 첫 cube 렌더 시 compositor 가 3D layer 처음 구성하면서
// 200~400ms 프레임 드랍. 앱 로드 후 1회 invisible cube 생성해 미리 컴파일.
let _cubeWarmedUp = false;
export function _warmupCube3D() {
  if (_cubeWarmedUp) return;
  _cubeWarmedUp = true;
  try {
    const stage = document.createElement('div');
    stage.className = 'cube-event-stage';
    stage.style.cssText = 'opacity:0;pointer-events:none;';
    const outer = document.createElement('div');
    outer.className = 'cube-event';
    outer.setAttribute('data-color', 'gold');
    const wrap = document.createElement('div');
    wrap.className = 'cube-event-wrap';
    outer.appendChild(wrap);
    const cube = document.createElement('div');
    cube.className = 'cube-event-cube';
    ['f-front','f-back','f-right','f-left','f-top','f-bottom'].forEach(f => {
      const face = document.createElement('div');
      face.className = 'cube-face ' + f;
      cube.appendChild(face);
    });
    wrap.appendChild(cube);
    stage.appendChild(outer);
    document.body.appendChild(stage);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (stage.parentNode) stage.parentNode.removeChild(stage);
      });
    });
  } catch (_) { /* silent */ }
}

// 팝오버 중첩 큐 — 동시 변경 여러 개면 짧은 텀으로 순차 노출.
let _cubeEventQueue = [];
let _cubeEventShowing = false;

// ── A6+A18 Zen Tap (2026-05-07 prototype 통합) ──
// 카드 위에 큐브 부유 → 사용자 탭 OR 1.8s 자동 → header cube stack 으로 glide.
// 이전 동작 (캐릭터로 fly + label) 은 폐기. legacy CSS 일부는 cubes-ui.css 에 그대로 (호환).

const _ZEN_SUSPEND_MS = 1800;
const _ZEN_TAP_GLIDE_MS = 550;
const _ZEN_AUTO_GLIDE_MS = 850;

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
  // header cube stack 의 숫자 노드. gold/silver 둘 다 #hdr-cube-stack 안.
  if (color === 'gold')   return document.getElementById('cc-num-gold');
  if (color === 'silver') return document.getElementById('cc-num-silver');
  // red 도 일단 silver 로 fallback (header 에 red counter 없음 — sticky header 도입 후 wired)
  return document.getElementById('cc-num-silver') || document.getElementById('cc-num-gold');
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

/**
 * Red collapse (간소): 캐릭터 휘청 + body shake. 다음 단계: sticky shake + token fall.
 */
function _playRedCollapse(ev, onDone) {
  const cardEl = _zenCardForEvent(ev);
  _tintCard(cardEl, 'red');
  // 캐릭터 휘청 — 기존 .sb-canvas-wrap 사용.
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
  if (window.sh?.haptics?.tap) window.sh.haptics.tap('medium');
  else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([35, 25, 35]);
  setTimeout(() => onDone?.(), 800);
}

/**
 * Zen Tap: 카드 위 큐브 부유 → 탭 OR 1.8s 자동 → stack 으로 glide.
 */
export function _playCubeEvent(ev, onDone) {
  const color = ev.color || 'gray';
  // gray = no-op (대부분 _diffCubes 에서 안 만들지만 안전망).
  if (color === 'gray') { onDone?.(); return; }
  // red/crimson 은 collapse 시퀀스로.
  if (color === 'red' || color === 'crimson') {
    _playRedCollapse(ev, onDone);
    return;
  }

  const cardEl = _zenCardForEvent(ev);
  const targetEl = _zenTargetForColor(color);

  // 카드 tint 펄스
  _tintCard(cardEl, color);

  // 시작 좌표 — 카드 위 ~50px (또는 화면 중앙 fallback)
  const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
  const startCx = cardRect
    ? cardRect.left + cardRect.width / 2
    : window.innerWidth / 2;
  const startCy = cardRect
    ? Math.max(80, cardRect.top - 50)
    : window.innerHeight * 0.4;

  // ── 큐브 element ──
  const cube = document.createElement('div');
  cube.className = 'zen-cube ' + color;
  cube.style.left = (startCx - 17) + 'px';
  cube.style.top = (startCy - 17) + 'px';
  document.body.appendChild(cube);

  // ── Countdown ring ──
  const ring = document.createElement('div');
  ring.className = 'zen-ring ' + color;
  ring.style.left = (startCx - 32) + 'px';
  ring.style.top = (startCy - 32) + 'px';
  ring.innerHTML = '<svg viewBox="0 0 64 64"><circle class="ring-track" cx="32" cy="32" r="28"/><circle class="ring-fg" cx="32" cy="32" r="28"/></svg>';
  document.body.appendChild(ring);
  requestAnimationFrame(() => ring.classList.add('go'));

  // ── Tap label ──
  const label = document.createElement('div');
  label.className = 'zen-tap-label ' + color;
  label.textContent = '탭';
  label.style.left = (startCx - 30) + 'px';
  label.style.top = (startCy + 38) + 'px';
  document.body.appendChild(label);

  let committed = false;
  let autoTimer = null;

  function commit(viaTap) {
    if (committed) return;
    committed = true;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }

    label.classList.add('fading');
    setTimeout(() => label.remove(), 320);
    ring.remove();

    // glide → header cube counter
    if (targetEl) {
      const tRect = targetEl.getBoundingClientRect();
      const dx = tRect.left + tRect.width / 2 - startCx;
      const dy = tRect.top + tRect.height / 2 - startCy;
      cube.style.setProperty('--dx', dx + 'px');
      cube.style.setProperty('--dy', dy + 'px');
    } else {
      cube.style.setProperty('--dx', '0px');
      cube.style.setProperty('--dy', '-200px');
    }
    cube.classList.add(viaTap ? 'committed-tap' : 'committed-auto');

    // haptic
    if (window.sh?.haptics?.tap) {
      window.sh.haptics.tap(viaTap ? (color === 'gold' ? 'medium' : 'light') : 'light');
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(viaTap ? (color === 'gold' ? 25 : 18) : 12);
    }

    // 도착 직전 stack 숫자 bump
    const arriveAt = viaTap ? 320 : 600;
    setTimeout(() => _bumpStackNum(targetEl, color), arriveAt);

    setTimeout(() => {
      cube.remove();
      onDone?.();
    }, viaTap ? _ZEN_TAP_GLIDE_MS + 50 : _ZEN_AUTO_GLIDE_MS + 50);
  }

  cube.onclick = (e) => { e.stopPropagation(); commit(true); };
  autoTimer = setTimeout(() => commit(false), _ZEN_SUSPEND_MS);
}

export function _showNextCubeEvent() {
  if (!_cubeEventQueue.length) { _cubeEventShowing = false; return; }
  _cubeEventShowing = true;
  const ev = _cubeEventQueue.shift();
  _playCubeEvent(ev, () => {
    setTimeout(_showNextCubeEvent, 150);
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
