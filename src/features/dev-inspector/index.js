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

// ── Drag (헤더 잡고 이동) ───────────────────────────────
let _dragOff = null;
function _onHdrMouseDown(e) {
  // 버튼 클릭은 드래그 시작 X
  if (e.target.closest('button')) return;
  if (!_panel) return;
  const r = _panel.getBoundingClientRect();
  _dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
  _panel.classList.add('is-dragging');
  // top:0; left:현재; right:auto; 로 잠가서 드래그 자유롭게
  _panel.style.top = r.top + 'px';
  _panel.style.left = r.left + 'px';
  _panel.style.right = 'auto';
  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup', _onDragEnd, { once: true });
  e.preventDefault();
}
function _onDragMove(e) {
  if (!_dragOff || !_panel) return;
  const nx = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - _dragOff.x));
  const ny = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - _dragOff.y));
  _panel.style.left = nx + 'px';
  _panel.style.top = ny + 'px';
}
function _onDragEnd() {
  if (!_panel) return;
  _panel.classList.remove('is-dragging');
  try {
    localStorage.setItem('qrok_dev_pos', JSON.stringify({
      left: _panel.style.left,
      top: _panel.style.top,
    }));
  } catch (_) {}
  document.removeEventListener('mousemove', _onDragMove);
  _dragOff = null;
}
function _restorePosition() {
  try {
    const s = localStorage.getItem('qrok_dev_pos');
    if (!s) return;
    const p = JSON.parse(s);
    if (p && p.left && p.top && _panel) {
      _panel.style.top = p.top;
      _panel.style.left = p.left;
      _panel.style.right = 'auto';
    }
  } catch (_) {}
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
  // 좁은 viewport: '_' 버튼이 미니 ↔ 펼침 토글. 넓은 viewport: 미니화 (body hidden).
  p.querySelector('[data-qd-btn="min"]').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 830px)').matches) {
      p.classList.toggle('is-open');
    } else {
      p.classList.toggle('is-min');
    }
  });
  // 헤더 드래그
  p.querySelector('.qd-hdr').addEventListener('mousedown', _onHdrMouseDown);

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
  _panel = _buildPanel();
  _restorePosition();
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
