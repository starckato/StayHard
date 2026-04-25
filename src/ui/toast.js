// QROK · toast
//
// Tiny queued toast notification. Assumes `<div id="toast">` exists in
// index.html (it does — static markup). Shows messages one at a time
// with a 300ms fade-out between them.

/** @type {Array<{m:string, duration:number}>} */
const _queue = [];
let _showing = false;

/**
 * Enqueue a toast. Safe to call any time; DOM #toast must exist.
 * @param {string} m message text
 * @param {number} [duration=2000] visible ms
 */
export function showToast(m, duration = 2000) {
  _queue.push({ m, duration });
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
