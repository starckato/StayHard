// QROK · Pushup Counter Modal
//
// Full-screen overlay. Manual ± + 큰 카운터 + 완료. CV 자동·영상 녹화는 PR 2b 에서.
// Usage:
//   import { openPushupCounter } from './features/pushup/counter-modal.js';
//   window.openPushupCounter({ dailyGoal: 10, onComplete: (reps) => {...} });
//
// onComplete 가 호출되면 caller 가 daily_logs.cubes.pushup 업데이트 + score 부여.

let _modalEl = null;
let _state = { reps: 0, dailyGoal: 0, onComplete: null };

export function openPushupCounter({ dailyGoal = 0, onComplete = null } = {}) {
  if (_modalEl) closePushupCounter();
  _state = { reps: 0, dailyGoal: +dailyGoal || 0, onComplete };

  const el = document.createElement('div');
  el.id = 'pushup-counter-modal';
  el.style.cssText = 'position:fixed;inset:0;background:#0a0a0c;z-index:10001;display:flex;flex-direction:column;font-family:DM Sans,sans-serif;';
  el.innerHTML = _renderHTML();
  document.body.appendChild(el);
  _modalEl = el;
  document.body.style.overflow = 'hidden';

  el.querySelector('#pc-close').addEventListener('click', closePushupCounter);
  el.querySelector('#pc-done').addEventListener('click', _confirmComplete);
  el.querySelectorAll('[data-add]').forEach(b => {
    b.addEventListener('click', () => _updateReps(+b.dataset.add));
  });
  _renderCount();
}

export function closePushupCounter() {
  if (!_modalEl) return;
  _modalEl.remove();
  _modalEl = null;
  document.body.style.overflow = '';
  _state = { reps: 0, dailyGoal: 0, onComplete: null };
}

function _renderHTML() {
  const goalHint = _state.dailyGoal ? `오늘 목표 ${_state.dailyGoal}개` : '목표 없음';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
      <button id="pc-close" style="background:none;border:none;color:#a8a8b4;font-size:22px;cursor:pointer;touch-action:manipulation;">←</button>
      <div style="font-size:14px;font-weight:700;color:#eaeaea;">푸쉬업 카운트</div>
      <div style="width:24px;"></div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;">
      <div style="font-size:11px;color:#7a7a86;letter-spacing:0.04em;margin-bottom:8px;">${goalHint}</div>
      <div id="pc-count" style="font-size:120px;font-weight:800;font-family:DM Mono,monospace;color:#ff4d4d;line-height:1;">0</div>
      <div id="pc-progress" style="font-size:12px;color:#a8a8b4;margin-top:10px;font-family:DM Mono,monospace;height:18px;"></div>
      <div style="display:flex;gap:8px;margin-top:36px;flex-wrap:wrap;justify-content:center;">
        <button data-add="-1" style="width:48px;height:48px;border-radius:24px;background:#1c1c22;border:1px solid rgba(255,255,255,0.10);color:#a8a8b4;font-size:18px;cursor:pointer;font-weight:700;touch-action:manipulation;">−</button>
        <button data-add="1"  style="width:48px;height:48px;border-radius:24px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.25);color:#ff4d4d;font-size:18px;cursor:pointer;font-weight:700;touch-action:manipulation;">+1</button>
        <button data-add="5"  style="padding:0 16px;height:48px;border-radius:24px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.25);color:#ff4d4d;font-size:14px;cursor:pointer;font-weight:700;touch-action:manipulation;">+5</button>
        <button data-add="10" style="padding:0 16px;height:48px;border-radius:24px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.25);color:#ff4d4d;font-size:14px;cursor:pointer;font-weight:700;touch-action:manipulation;">+10</button>
      </div>
      <div style="font-size:10px;color:#7a7a86;margin-top:32px;text-align:center;line-height:1.5;">
        CV 자동 카운트·영상 녹화는 다음 업데이트.<br>지금은 손가락으로 ±
      </div>
    </div>
    <div style="padding:16px 18px 24px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
      <button id="pc-done" style="width:100%;padding:15px;border-radius:14px;background:#ff4d4d;border:none;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;touch-action:manipulation;">완료</button>
    </div>
  `;
}

function _updateReps(delta) {
  _state.reps = Math.max(0, _state.reps + Number(delta));
  _renderCount();
}

function _renderCount() {
  if (!_modalEl) return;
  const cntEl = _modalEl.querySelector('#pc-count');
  const progEl = _modalEl.querySelector('#pc-progress');
  cntEl.textContent = _state.reps;
  if (_state.dailyGoal > 0) {
    const pct = Math.min(100, Math.round((_state.reps / _state.dailyGoal) * 100));
    progEl.textContent = `${_state.reps} / ${_state.dailyGoal} (${pct}%)`;
    cntEl.style.color = pct >= 100 ? '#34d399' : '#ff4d4d';
  } else {
    progEl.textContent = '';
    cntEl.style.color = '#ff4d4d';
  }
}

async function _confirmComplete() {
  if (_state.reps === 0) {
    if (!confirm('카운트가 0이에요. 그래도 종료할까요?')) return;
  }
  const reps = _state.reps;
  const cb = _state.onComplete;
  closePushupCounter();
  if (typeof cb === 'function') {
    try {
      await cb(reps, null);
    } catch (e) {
      console.warn('[pushup-counter] onComplete error', e);
    }
  }
}
