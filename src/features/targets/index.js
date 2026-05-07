// 큐록 · features/targets — 할일 (todos) feature.
//
// "한 폴더 = 한 기능" 패턴의 *첫 번째 추출 시범* (2026-05-07).
// 이전: index.html 의 5개 비연속 region 에 흩어져 있었음 (~1018, 1779, 9867, 9895, 12937, 13091).
// 이후: 이 폴더 (index.js + targets.css) + index.html 의 mount 마크업 만.
//
// 외부 의존성 (window 글로벌 — 점진적으로 임포트로 전환 예정):
//   log, saveNow, queueSave, recomputeCubesHook, addScore, SCORE_EVENTS,
//   showWin, showScoreGain, showToast, esc, bounceEl, _tryMicroReward,
//   checkPerfectDay, updateTasksBadge, setExclusiveCard, openModal, closeModal,
//   renderMandatory, propagateMandatoryDefs.
//
// 인라인 onclick="fn()" 은 그대로 유지 — main.js 가 window 에 spread.

// ── Card 토글 + 요약 ─────────────────────────────────────────
export function toggleTargetsCard() {
  if (typeof window.setExclusiveCard === 'function') {
    window.setExclusiveCard('targets-card');
    return;
  }
  const card = document.getElementById('targets-card');
  if (!card) return;
  card.classList.toggle('expanded');
}

/** Collapsed 헤더 요약: "할일 0/3" / 빈상태 / 완료 */
export function renderTargetsSummary() {
  const sum = document.getElementById('targets-summary');
  if (!sum) return;
  const log = window.log;
  const tgts = (log?.targets || []).filter(t => t && t.text);
  if (tgts.length === 0) {
    sum.innerHTML = '<span class="summary-cta">할일 추가하기 →</span>';
    return;
  }
  const done = tgts.filter(t => t.st === 'done').length;
  if (done === tgts.length) {
    sum.innerHTML = '<span style="color:var(--green);font-weight:600;">✓ 완료</span>';
    return;
  }
  sum.innerHTML = `<span class="q-chip normal">할일 <span class="n">${done}/${tgts.length}</span></span>`;
}

// ── Render: 할일 카드 본문 ───────────────────────────────────
const EMPTY_HTML = `<div style="padding:16px 0;text-align:center;">
  <div style="font-size:var(--text-2xl);margin-bottom:6px;">🎯</div>
  <div style="font-size:var(--text-md);color:var(--text3);margin-bottom:4px;">오늘의 할일을 설정하세요</div>
  <div style="font-size:var(--text-xs);color:var(--text3);margin-bottom:10px;">예: 링크드인 연락 · 보고서 작성 · 병원 예약</div>
  <div style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-2xs);font-weight:600;padding:5px 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-pill);color:var(--text3);letter-spacing:-.01em;">
    <span style="color:var(--green);">+2pt</span>완료 · <span style="color:var(--red);">-2pt</span>실패
  </div>
</div>`;

function rowHtml(t, i) {
  const isDone = t.st === 'done';
  const isFail = t.st === 'fail';
  const checkContent = isDone
    ? '<span style="color:var(--green);font-size:var(--text-base);">✓</span>'
    : isFail
      ? '<span style="color:var(--red);font-size:var(--text-sm);">✕</span>'
      : '';
  const escFn = window.esc || ((s) => String(s ?? ''));
  const carriedBadge = t._carried
    ? ` <span style="font-size:var(--text-2xs);font-weight:600;padding:1px 5px;border-radius:var(--radius-sm);background:var(--accent-bg);color:var(--accent);border:0.5px solid var(--accent-bd);vertical-align:middle;">이월</span>`
    : '';
  const failBtn = !isDone
    ? `<button onclick="markFail(${i})" style="font-size:var(--text-xs);padding:5px 10px;border-radius:var(--radius-md);border:1px solid ${isFail ? 'var(--red)' : 'var(--border2)'};background:${isFail ? 'var(--red-bg)' : 'transparent'};color:${isFail ? 'var(--red)' : 'var(--text3)'};cursor:pointer;font-family:'DM Sans',sans-serif;touch-action:manipulation;white-space:nowrap;flex-shrink:0;">${isFail ? '취소' : '실패'}</button>`
    : '';
  return `<div class="tgt-row" style="${isFail ? 'background:var(--accent-tint-1);' : ''}">
    <div class="tgt-btn ${t.st || ''}"
      onclick="togTgt(${i})"
      style="cursor:pointer;-webkit-user-select:none;user-select:none;flex-shrink:0;">
      ${checkContent}
    </div>
    <div class="tgt-text ${isDone ? 'done' : isFail ? 'fail' : ''}"
      onclick="togTgt(${i})"
      style="cursor:pointer;flex:1;padding:12px 4px;-webkit-user-select:none;user-select:none;">${escFn(t.text || '')}${carriedBadge}
    </div>
    ${failBtn}
    <button onclick="openPromoteTodoModal(${i})" title="매일 반복하는 필수 루틴으로 변환" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:var(--text-base);padding:6px 8px;min-width:36px;touch-action:manipulation;">↻</button>
    <button onclick="delTgt(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:var(--text-xl);padding:6px 8px;min-width:36px;touch-action:manipulation;">✕</button>
  </div>`;
}

export function renderTargets() {
  const log = window.log;
  if (!log) return;
  if (!log.targets) log.targets = [];
  const done = log.targets.filter(t => t.st === 'done').length;
  const b = document.getElementById('tgt-badge');
  if (b) {
    b.textContent = done + '/' + log.targets.length;
    b.className = 's-badge ' + (done > 0 && done === log.targets.length ? 'green' : '');
  }
  if (typeof window.updateTasksBadge === 'function') window.updateTasksBadge();
  const rows = document.getElementById('tgt-rows');
  if (rows) {
    rows.innerHTML = log.targets.length === 0
      ? EMPTY_HTML
      : log.targets.map((t, i) => rowHtml(t, i)).join('');
  }
  try { renderTargetsSummary(); } catch (e) { /* noop */ }
}

// ── 토글 / 실패 / 삭제 ──────────────────────────────────────
export function togTgt(i) {
  const log = window.log;
  if (!log?.targets?.[i]) return;
  const s = log.targets[i].st || '';
  const nowDone = s !== 'done';
  // 토글 전 origin 좌표 캡처 (점수 popover 출발점)
  const _origin = document.querySelectorAll('#tgt-rows .tgt-btn')[i] || null;
  const _originRect = _origin ? _origin.getBoundingClientRect() : null;
  log.targets[i].st = nowDone ? 'done' : '';
  renderTargets();
  try { window.recomputeCubesHook?.(); } catch {}
  try { window.saveNow?.(); } catch {}
  if (nowDone) {
    try { window._tryMicroReward?.('tasks'); } catch {}
    try { window.addScore?.('target_done'); } catch {}
    if (_originRect && window.SCORE_EVENTS && window.showScoreGain) {
      const proxy = { getBoundingClientRect: () => _originRect };
      window.showScoreGain(window.SCORE_EVENTS.target_done.pts, proxy);
    }
    setTimeout(() => {
      const btn = document.querySelectorAll('#tgt-rows .tgt-btn')[i];
      if (btn && window.bounceEl) window.bounceEl(btn);
      if (window.showWin && window.SCORE_EVENTS) {
        window.showWin('task', window.SCORE_EVENTS.target_done.pts, '할일 완료!');
      }
      try { window.checkPerfectDay?.(); } catch {}
    }, 50);
  } else {
    try { window.addScore?.('target_done_cancel'); } catch {}
  }
}

export function markFail(i) {
  const log = window.log;
  if (!log?.targets?.[i]) return;
  const wasFail = log.targets[i].st === 'fail';
  log.targets[i].st = wasFail ? '' : 'fail';
  if (!wasFail) {
    try { window.addScore?.('target_fail'); } catch {}
  } else {
    try { window.addScore?.('target_fail_cancel'); } catch {}
  }
  renderTargets();
  try { window.recomputeCubesHook?.(); } catch {}
  try { window.saveNow?.(); } catch {}
}

export function delTgt(i) {
  const log = window.log;
  if (!log?.targets) return;
  log.targets.splice(i, 1);
  renderTargets();
  try { window.saveNow?.(); } catch {}
}

// ── 추가 ────────────────────────────────────────────────────
export function toggleAddTgt() {
  const x = document.getElementById('add-tgt-input');
  if (!x) return;
  x.classList.toggle('open');
  if (x.classList.contains('open')) {
    document.getElementById('tgt-inp')?.focus();
  }
}

export function addTarget() {
  const log = window.log;
  if (!log) return;
  const inp = document.getElementById('tgt-inp');
  if (!inp) return;
  const t = inp.value.trim();
  if (!t) return;
  if (!log.targets) log.targets = [];
  log.targets.push({ text: t, st: '' });
  inp.value = '';
  document.getElementById('add-tgt-input')?.classList.remove('open');
  renderTargets();
  try { window.saveNow?.(); } catch {}
}

// ── Promote: 할일 → 매일 반복 루틴 변환 모달 ─────────────────
let _promoteTodoIdx = null;
let _promoteDays = [0, 1, 2, 3, 4, 5, 6];
let _promoteEndDate = null;

export function openPromoteTodoModal(i) {
  const log = window.log;
  const t = log?.targets?.[i];
  if (!t) return;
  _promoteTodoIdx = i;
  _promoteDays = [0, 1, 2, 3, 4, 5, 6];
  _promoteEndDate = null;
  const textEl = document.getElementById('promote-todo-text');
  if (textEl) textEl.textContent = '"' + t.text + '"을(를) 매일 반복하는 필수 루틴으로 변환합니다.';
  const daysEl = document.getElementById('promote-days');
  if (daysEl) {
    const names = ['월', '화', '수', '목', '금', '토', '일'];
    daysEl.innerHTML = names.map((n, idx) =>
      `<button type="button" data-day="${idx}" onclick="togglePromoteDay(${idx},this)" style="flex:1;min-width:38px;padding:10px 0;background:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-lg);color:#fff;font-size:var(--text-md);font-weight:600;cursor:pointer;touch-action:manipulation;">${n}</button>`
    ).join('');
  }
  const endEl = document.getElementById('promote-end-date');
  if (endEl) endEl.value = '';
  if (window.openModal) window.openModal('promote-modal');
}

export function togglePromoteDay(idx, el) {
  if (_promoteDays.includes(idx)) {
    _promoteDays = _promoteDays.filter(d => d !== idx);
    el.style.background = 'var(--surface2)';
    el.style.borderColor = 'var(--border2)';
    el.style.color = 'var(--text3)';
  } else {
    _promoteDays.push(idx);
    el.style.background = 'var(--accent)';
    el.style.borderColor = 'var(--accent)';
    el.style.color = '#fff';
  }
}

export function setPromoteEnd(days) {
  if (days === null) {
    _promoteEndDate = null;
    const el = document.getElementById('promote-end-date');
    if (el) el.value = '';
  } else {
    const d = new Date();
    d.setDate(d.getDate() + days);
    _promoteEndDate = d.toISOString().slice(0, 10);
    const el = document.getElementById('promote-end-date');
    if (el) el.value = _promoteEndDate;
  }
}

export function confirmPromoteTodo() {
  const log = window.log;
  if (_promoteTodoIdx == null) return;
  const t = log?.targets?.[_promoteTodoIdx];
  if (!t) {
    if (window.closeModal) window.closeModal('promote-modal');
    return;
  }
  if (_promoteDays.length === 0) {
    if (window.showToast) window.showToast('최소 1개 요일을 선택해주세요');
    return;
  }
  const customCount = (log.mandatory || []).filter(m => m && m.type === 'custom').length;
  if (customCount >= 10) {
    if (window.showToast) window.showToast('필수 루틴은 최대 10개까지 추가할 수 있어요.');
    if (window.closeModal) window.closeModal('promote-modal');
    return;
  }
  const entry = {
    type: 'custom',
    name: t.text,
    done: t.st === 'done',
    days: [..._promoteDays].sort((a, b) => a - b),
    end_date: _promoteEndDate,
  };
  if (!log.mandatory) log.mandatory = [];
  log.mandatory.push(entry);
  log.targets.splice(_promoteTodoIdx, 1);
  _promoteTodoIdx = null;
  if (window.closeModal) window.closeModal('promote-modal');
  try { window.renderMandatory?.(); } catch {}
  renderTargets();
  try { window.queueSave?.(); } catch {}
  try { window.propagateMandatoryDefs?.(log.mandatory); } catch {}
  if (window.showToast) window.showToast('↻ 매일 반복 루틴으로 변환됐어요');
}

// ── Bootstrap: Enter 키 → addTarget ──────────────────────────
// DOMContentLoaded 후 한 번. main.js 가 호출.
export function initTargetsModule() {
  // input Enter
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.id === 'tgt-inp' && e.key === 'Enter') addTarget();
  });
  // promote 종료일 수동 입력 동기화
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.id === 'promote-end-date') {
      _promoteEndDate = t.value || null;
    }
  });
}
