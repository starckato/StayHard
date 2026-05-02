// QROK · toast
//
// Tiny queued toast notification. Assumes `<div id="toast">` exists in
// index.html (it does — static markup). Shows messages one at a time
// with a 300ms fade-out between them.
//
// Auto-haptic: 메시지 톤 (성공 ✓ / 저장됨 / 완료 / 실패 / 에러) 을 인식해
// 적절한 햅틱을 트리거. native 환경에만 적용 (web noop).

/** @type {Array<{m:string, duration:number}>} */
const _queue = [];
let _showing = false;

const RX_SUCCESS = /(✓|✅|🎉|저장됨|완료|성공|기록됨|추가됨|받았어|달성)/;
const RX_ERROR   = /(실패|에러|오류|❌|⚠️\s)/;

function _maybeHaptic(m) {
  try {
    const h = (typeof window !== 'undefined') && window.sh && window.sh.haptics;
    if (!h) return;
    if (RX_ERROR.test(m) && typeof h.notify === 'function') h.notify('error');
    else if (RX_SUCCESS.test(m) && typeof h.notify === 'function') h.notify('success');
    // 그 외는 무음 — 정보성 toast 는 햅틱 없이.
  } catch {}
}

/**
 * Enqueue a toast. Safe to call any time; DOM #toast must exist.
 * @param {string} m message text
 * @param {number} [duration=2000] visible ms
 */
export function showToast(m, duration = 2000) {
  _queue.push({ m, duration });
  _maybeHaptic(m);
  if (!_showing) _flushToast();
}

function _flushToast() {
  if (!_queue.length) { _showing = false; return; }
  _showing = true;
  const { m, duration } = _queue.shift();
  const t = document.getElementById('toast');
  if (!t) { _showing = false; return; }
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(_flushToast, 300);
  }, duration);
}
