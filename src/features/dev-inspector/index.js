// 큐록 · features/dev-inspector — AI-native dev workflow.
//
// 활성: URL 에 ?dev=1
// 작동:
//   1. 우측 floating panel 출현
//   2. 🎯 Pick Element 버튼 클릭 → armed 상태 (cursor crosshair)
//   3. 페이지의 어떤 요소든 클릭 → 선택 + outline 강조
//   4. 패널에 선택 요소 컨텍스트 (selector / class / id / outer HTML / 핵심 styles)
//   5. 텍스트박스에 요청 입력 ("이 카드 padding 줄여줘" 등)
//   6. 📋 Copy 버튼 → 구조화 markdown 클립보드
//   7. 사용자가 Claude 채팅에 paste → 정확한 컨텍스트와 함께 작업 요청
//
// production 빌드에는 *영향 없음* — ?dev=1 없으면 init 함수 자체가 early-return.

const _MAX_OUTER_HTML = 500;
const _KEY_STYLES = [
  'display', 'position', 'padding', 'margin', 'background', 'background-color',
  'border', 'border-radius', 'color', 'font-size', 'font-weight', 'line-height',
  'gap', 'flex-direction', 'align-items', 'justify-content', 'width', 'height',
  'opacity', 'transform', 'overflow',
];

let _picked = null;
let _armed = false;
let _hoverOutline = null;
let _lockedOutline = null;
let _panel = null;

function _isDevMode() {
  try {
    return /[?&]dev=1\b/.test(window.location.search);
  } catch (_) { return false; }
}

function _selectorOf(el) {
  if (!el || el === document.body) return 'body';
  if (el.id) return '#' + el.id;
  const cls = (el.className && typeof el.className === 'string')
    ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    : '';
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
}

function _parentChain(el) {
  const chain = [];
  let cur = el.parentElement;
  while (cur && cur !== document.body && chain.length < 5) {
    chain.unshift(_selectorOf(cur));
    cur = cur.parentElement;
  }
  return chain.join(' > ');
}

function _keyStyles(el) {
  const cs = window.getComputedStyle(el);
  const out = {};
  for (const prop of _KEY_STYLES) {
    const v = cs.getPropertyValue(prop);
    if (v && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'none' && v !== 'rgba(0, 0, 0, 0)') {
      out[prop] = v;
    }
  }
  return out;
}

function _outerHtmlSnippet(el) {
  const s = el.outerHTML || '';
  if (s.length <= _MAX_OUTER_HTML) return s;
  return s.slice(0, _MAX_OUTER_HTML) + ' …';
}

function _showToast(msg) {
  const t = _panel?.querySelector('.qd-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('is-on');
  setTimeout(() => t.classList.remove('is-on'), 1400);
}

function _renderPicked() {
  if (!_panel) return;
  const empty = !_picked;
  const valSel = _panel.querySelector('[data-qd-field="selector"]');
  const valHtml = _panel.querySelector('[data-qd-field="html"]');
  const valStyle = _panel.querySelector('[data-qd-field="styles"]');
  const valChain = _panel.querySelector('[data-qd-field="chain"]');

  if (empty) {
    [valSel, valHtml, valStyle, valChain].forEach(el => {
      if (el) { el.textContent = '아직 선택된 요소 없음 — 🎯 누르고 클릭하세요'; el.classList.add('is-empty'); }
    });
    return;
  }
  [valSel, valHtml, valStyle, valChain].forEach(el => el && el.classList.remove('is-empty'));
  if (valSel) valSel.textContent = _selectorOf(_picked);
  if (valChain) valChain.textContent = _parentChain(_picked);
  if (valHtml) valHtml.textContent = _outerHtmlSnippet(_picked);
  if (valStyle) {
    const ks = _keyStyles(_picked);
    valStyle.textContent = Object.entries(ks).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
}

function _buildMarkdown(userMsg) {
  if (!_picked) {
    return userMsg
      ? `**User message:**\n\n${userMsg}`
      : '_요소 미선택_';
  }
  const sel = _selectorOf(_picked);
  const chain = _parentChain(_picked);
  const html = _outerHtmlSnippet(_picked);
  const ks = _keyStyles(_picked);
  const stylesLines = Object.entries(ks).map(([k, v]) => `- ${k}: ${v}`).join('\n');

  return [
    '## 🎯 선택된 요소',
    `**Selector**: \`${sel}\``,
    `**Parents**: \`${chain}\``,
    '',
    '**Outer HTML**:',
    '```html',
    html,
    '```',
    '',
    '**Computed Styles**:',
    stylesLines || '(키 스타일 추출 0)',
    '',
    userMsg ? `## ✏️ 작업 요청\n\n${userMsg}` : '',
  ].filter(Boolean).join('\n');
}

function _ensureOutline(el, locked) {
  if (!el || el === _panel || (_panel && _panel.contains(el))) return null;
  const r = el.getBoundingClientRect();
  const o = locked ? _lockedOutline : _hoverOutline;
  if (!o) return null;
  o.style.left = r.left + 'px';
  o.style.top = r.top + 'px';
  o.style.width = r.width + 'px';
  o.style.height = r.height + 'px';
  o.style.display = 'block';
  return o;
}

function _handleMove(e) {
  if (!_armed) return;
  const el = e.target;
  if (el === _panel || (_panel && _panel.contains(el))) {
    if (_hoverOutline) _hoverOutline.style.display = 'none';
    return;
  }
  _ensureOutline(el, false);
}

function _handlePick(e) {
  if (!_armed) return;
  const el = e.target;
  if (el === _panel || (_panel && _panel.contains(el))) return;
  e.preventDefault();
  e.stopPropagation();
  _picked = el;
  _armed = false;
  document.body.classList.remove('qrok-dev-armed');
  const armBtn = _panel?.querySelector('[data-qd-btn="arm"]');
  if (armBtn) { armBtn.classList.remove('is-armed'); armBtn.textContent = '🎯 Pick Element'; }
  if (_hoverOutline) _hoverOutline.style.display = 'none';
  _ensureOutline(el, true);
  _renderPicked();
}

function _onArmClick() {
  _armed = !_armed;
  const armBtn = _panel?.querySelector('[data-qd-btn="arm"]');
  if (_armed) {
    document.body.classList.add('qrok-dev-armed');
    if (armBtn) { armBtn.classList.add('is-armed'); armBtn.textContent = '… 클릭하세요'; }
  } else {
    document.body.classList.remove('qrok-dev-armed');
    if (armBtn) { armBtn.classList.remove('is-armed'); armBtn.textContent = '🎯 Pick Element'; }
    if (_hoverOutline) _hoverOutline.style.display = 'none';
  }
}

async function _onCopyClick() {
  const ta = _panel?.querySelector('.qd-textarea');
  const userMsg = ta?.value?.trim() || '';
  const md = _buildMarkdown(userMsg);
  try {
    await navigator.clipboard.writeText(md);
    _showToast('✓ 복사됨 — 클로드 채팅에 paste');
  } catch (_) {
    // fallback — execCommand
    try {
      const textArea = document.createElement('textarea');
      textArea.value = md;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      _showToast('✓ 복사됨');
    } catch (e) {
      _showToast('복사 실패');
    }
  }
}

function _onClearClick() {
  _picked = null;
  if (_lockedOutline) _lockedOutline.style.display = 'none';
  const ta = _panel?.querySelector('.qd-textarea');
  if (ta) ta.value = '';
  _renderPicked();
}

function _onResize() {
  if (_picked && _lockedOutline) _ensureOutline(_picked, true);
}

// 사이드바 layout — 드래그 / 위치 영속 폐기 (필요 없어짐).

// ── Mock challenge data (6명 합성, dev 전용) ─────────────────
// test 계정에서 챌린지 룸 UI 시각 검증용. DB 안 건드림 — renderGroupStats 직접 호출.
const _MOCK_MEMBERS = [
  // [name, goal_diff_kg, diet_profile, workout_profile]
  // diet: clean (% green) / cheat / violate per day
  // workout: vol per day (분), 운동일 빈도
  ['김민준', -5, { clean: 0.85, cheat: 0.05, violate: 0.02 }, { freq: 0.9, volMean: 60, volStd: 15 }],
  ['박지영', +3, { clean: 0.55, cheat: 0.15, violate: 0.05 }, { freq: 0.5, volMean: 35, volStd: 12 }],
  ['이준호',  0, { clean: 0.30, cheat: 0.35, violate: 0.08 }, { freq: 0.2, volMean: 20, volStd: 8 }],
  ['최서연', -3, { clean: 0.65, cheat: 0.10, violate: 0.20 }, { freq: 0.6, volMean: 40, volStd: 10 }],
  ['정태우', -8, { clean: 0.92, cheat: 0.04, violate: 0.00 }, { freq: 1.0, volMean: 75, volStd: 12 }],
  ['한지호', +5, { clean: 0.45, cheat: 0.20, violate: 0.15 }, { freq: 0.85, volMean: 55, volStd: 18 }],
];

function _rand(seed) {
  // Simple LCG so mock data is deterministic per seed
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _generateMockChallenge() {
  const today = new Date();
  const days = 14;
  const chStart = new Date(today); chStart.setDate(chStart.getDate() - days + 1);
  const chEnd = new Date(today);
  const fmtDate = d => d.toISOString().slice(0, 10);

  const profiles = _MOCK_MEMBERS.map((m, i) => ({
    id: 'mock_' + i,
    display_name: m[0],
    username: m[0],
  }));
  // 첫 멤버를 '나' 로 흉내 — renderGroupStats 가 CU.id 비교하므로 잠깐 _origCU swap
  const mbs = profiles.map(p => p.id);

  const memberWgoals = {};
  const startWeights = {};
  const allLogs = [];

  _MOCK_MEMBERS.forEach((m, i) => {
    const [name, goalDiff, diet, workout] = m;
    const startW = 70 + (i * 1.5); // baseline 70~78 사이
    const goalW = startW + goalDiff;
    memberWgoals[profiles[i].id] = goalW;
    startWeights[profiles[i].id] = startW;

    const rand = _rand(i * 7919 + 13);

    // 14 days logs
    for (let d = 0; d < days; d++) {
      const date = new Date(chStart); date.setDate(date.getDate() + d);
      const dateStr = fmtDate(date);

      // 체중 — start 에서 goal 방향으로 점진 (마지막에 ~80% 달성)
      const progress = (d / (days - 1)) * 0.78 + (rand() - 0.5) * 0.04;
      const weight = startW + (goalW - startW) * progress;

      // 식단 — 3끼 시뮬레이션
      const meals = [];
      for (let m = 0; m < 3; m++) {
        const r = rand();
        let type = 'normal';
        let category = null;
        if (r < diet.clean) type = 'green';
        else if (r < diet.clean + diet.cheat) type = 'cheat';
        else if (r > 1 - diet.violate) {
          if (rand() < 0.5) { type = 'red'; }
          else { category = 'alcohol'; type = 'normal'; }
        }
        meals.push({ type, category, time: ['아침','점심','저녁'][m] });
      }

      // 운동 — 빈도 따라 sometimes 없음
      const workouts = [];
      if (rand() < workout.freq) {
        const mins = Math.max(10, workout.volMean + (rand() - 0.5) * workout.volStd * 2);
        // Simplified gym workout w/ minutes-equivalent volume
        workouts.push({
          type: 'gym',
          status: 'done',
          exercises: [{
            name: 'Squat',
            sets: [
              { weight: 60, reps: 10, completed: true },
              { weight: 60, reps: 10, completed: true },
              { weight: 60, reps: 8, completed: true },
            ],
          }],
          totalVolume: Math.round(mins * 30), // proxy
          totalMinutes: Math.round(mins),
        });
      }

      allLogs.push({
        user_id: profiles[i].id,
        log_date: dateStr,
        weight: Math.round(weight * 10) / 10,
        meals,
        workouts,
      });
    }
  });

  return { profiles, mbs, allLogs, memberWgoals, chStart: fmtDate(chStart), chEnd: fmtDate(chEnd), dayNum: days, startWeights };
}

export function mockChallengeRoom() {
  // 임시 CU swap (renderGroupStats 가 'mock_0' 을 '나' 로 인식하도록)
  const origCU = window.CU;
  const data = _generateMockChallenge();
  window.CU = { id: data.profiles[0].id };

  // Overlay 강제 표시
  const room = document.getElementById('challenge-room');
  if (room) room.style.display = 'flex';
  // Header
  const tEl = document.getElementById('room-title');
  if (tEl) tEl.textContent = '🎭 Mock 챌린지 (6명, 14일)';
  const sEl = document.getElementById('room-subtitle');
  if (sEl) sEl.textContent = 'dev inspector 합성 데이터';
  // D-Day
  const ddEl = document.getElementById('room-dday');
  if (ddEl) ddEl.textContent = 'D-DAY';
  const pdEl = document.getElementById('room-period');
  if (pdEl) pdEl.textContent = data.chStart + ' ~ ' + data.chEnd;
  // Progress
  const pb = document.getElementById('room-progress-bar');
  if (pb) pb.style.width = '100%';
  const pl = document.getElementById('room-progress-label');
  if (pl) pl.textContent = data.dayNum + '일 / ' + data.dayNum + '일';
  const pp = document.getElementById('room-progress-pct');
  if (pp) pp.textContent = '100%';
  // group-stats-section 열기
  const gsBody = document.getElementById('group-stats-body');
  if (gsBody) gsBody.style.display = 'block';
  const gsChev = document.getElementById('group-stats-chevron');
  if (gsChev) gsChev.style.transform = 'rotate(0deg)';

  // renderGroupStats 직접 호출
  if (typeof window.renderGroupStats === 'function') {
    window.renderGroupStats(
      data.profiles, data.mbs, data.allLogs,
      data.memberWgoals, data.chStart, data.chEnd,
      data.dayNum, data.startWeights
    );
  }

  // 멤버 list 도 mock 으로 채워주기 (room-members)
  const membersEl = document.getElementById('room-members');
  if (membersEl) {
    membersEl.innerHTML = data.profiles.map((p, i) => {
      const startW = data.startWeights[p.id];
      const goalW = data.memberWgoals[p.id];
      const curLogs = data.allLogs.filter(l => l.user_id === p.id);
      const curW = curLogs.length ? curLogs[curLogs.length - 1].weight : startW;
      const isMe = i === 0;
      return `<div style="background:${isMe?'var(--accent-bg)':'var(--surface2)'};border:1px solid ${isMe?'var(--accent-bd)':'var(--border)'};border-radius:var(--radius-lg);padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;">${p.display_name}${isMe?' (나)':''}</div>
          <div style="font-family:'DM Mono',monospace;font-size:var(--text-sm);color:var(--text2);">${curW}kg → ${goalW}kg</div>
        </div>
      </div>`;
    }).join('');
  }

  // Note: CU 는 복원하되 dev 세션 동안만 mock 으로 유지하면 다른 곳에서 충돌.
  // 단순화: 호출 후 CU 즉시 복원 — renderGroupStats 가 sync 라 OK.
  window.CU = origCU;

  console.log('[mock-challenge] 6명 14일 합성 데이터 렌더 완료', data);
}

// 콘솔에서도 호출 가능
if (typeof window !== 'undefined') {
  window.mockChallengeRoom = mockChallengeRoom;
}

function _buildPanel() {
  const p = document.createElement('div');
  p.id = 'qrok-dev';
  p.innerHTML = `
    <div class="qd-hdr">
      <div class="qd-title">QROK · DEV</div>
      <div class="qd-actions">
        <button class="qd-btn" data-qd-btn="arm">🎯 Pick Element</button>
        <button class="qd-btn is-secondary" data-qd-btn="min" title="접기">_</button>
      </div>
    </div>
    <div class="qd-body">
      <div class="qd-section">
        <div class="qd-label">Selector</div>
        <div class="qd-value is-empty" data-qd-field="selector"></div>
      </div>
      <div class="qd-section">
        <div class="qd-label">Parents</div>
        <div class="qd-value is-empty" data-qd-field="chain"></div>
      </div>
      <div class="qd-section">
        <div class="qd-label">Outer HTML</div>
        <div class="qd-value is-empty" data-qd-field="html"></div>
      </div>
      <div class="qd-section">
        <div class="qd-label">Key Styles</div>
        <div class="qd-value is-empty" data-qd-field="styles"></div>
      </div>
      <div class="qd-section">
        <div class="qd-label">작업 요청 (선택)</div>
        <textarea class="qd-textarea" placeholder="이 카드 padding 더 줄여줘 / 색 바꿔줘 ..."></textarea>
      </div>
      <div class="qd-section" style="display:flex;gap:6px;">
        <button class="qd-btn" data-qd-btn="copy" style="flex:1;">📋 Copy Context</button>
        <button class="qd-btn is-secondary" data-qd-btn="clear">초기화</button>
      </div>
      <div class="qd-section">
        <div class="qd-label">🎭 Mock 데이터</div>
        <button class="qd-btn is-secondary" data-qd-btn="mock-challenge" style="width:100%;">
          챌린지 룸 — 6명 14일 합성
        </button>
      </div>
    </div>
    <div class="qd-toast"></div>
  `;
  document.body.appendChild(p);

  // Outlines
  _hoverOutline = document.createElement('div');
  _hoverOutline.className = 'qrok-dev-outline';
  _hoverOutline.style.display = 'none';
  document.body.appendChild(_hoverOutline);

  _lockedOutline = document.createElement('div');
  _lockedOutline.className = 'qrok-dev-outline is-locked';
  _lockedOutline.style.display = 'none';
  document.body.appendChild(_lockedOutline);

  // Wire buttons
  p.querySelector('[data-qd-btn="arm"]').addEventListener('click', _onArmClick);
  p.querySelector('[data-qd-btn="copy"]').addEventListener('click', _onCopyClick);
  p.querySelector('[data-qd-btn="clear"]').addEventListener('click', _onClearClick);
  // '_' 버튼 — 좁은 viewport 에서만 토글 사용 (넓은 화면은 사이드바라 항상 펼침).
  p.querySelector('[data-qd-btn="min"]').addEventListener('click', () => {
    p.classList.toggle('is-open');
  });
  // 🎭 Mock 챌린지
  p.querySelector('[data-qd-btn="mock-challenge"]').addEventListener('click', () => {
    try { mockChallengeRoom(); _showToast('✓ Mock 챌린지 룸 열림'); }
    catch (e) { _showToast('Mock 실패'); console.warn(e); }
  });

  // Capture phase so we beat normal click handlers
  document.addEventListener('mousemove', _handleMove, true);
  document.addEventListener('click', _handlePick, true);
  window.addEventListener('resize', _onResize);
  window.addEventListener('scroll', _onResize, true);

  return p;
}

export function activateDevInspector() {
  if (typeof window === 'undefined') return;
  if (!_isDevMode()) return;
  if (document.getElementById('qrok-dev')) return;
  // body shift — 앱이 좌측으로 가고 패널이 우측 사이드바.
  document.body.classList.add('qrok-dev-on');
  _panel = _buildPanel();
  _renderPicked();
}

// 자동 activate (main.js 가 호출 안 해도 작동)
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateDevInspector);
  } else {
    setTimeout(activateDevInspector, 0);
  }
}
