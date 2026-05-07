// 큐록 · features/status-band/tests.js — 콘솔 smoke test.
// 사용: window.runStatusBandTests() — 결과 console.table.

import { renderTierLadder, cycleQuote, getCurrentQuote, setYrActive } from './index.js';

function _run(name, fn) {
  try { fn(); return { name, ok: true }; }
  catch (e) { return { name, ok: false, err: e?.message || String(e) }; }
}

export function runStatusBandTests() {
  const results = [];

  results.push(_run('renderTierLadder builds 6 steps', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="sb-ladder"></div>');
    window.TIERS = [
      { name: '방관자', color: '#888' }, { name: '각성자', color: '#38bdf8' },
      { name: '저항자', color: '#f59e0b' }, { name: '수련자', color: '#34d399' },
      { name: '지배자', color: '#ff4d4d' }, { name: '기록자', color: '#a855f7' },
    ];
    renderTierLadder(2);
    const wrap = document.getElementById('sb-ladder');
    const steps = wrap.querySelectorAll('.sb-ladder-step');
    if (steps.length !== 6) throw new Error('expected 6 steps, got ' + steps.length);
    const current = wrap.querySelector('.sb-ladder-step.is-current');
    if (!current) throw new Error('expected one is-current');
    if (current.dataset.tierIdx !== '2') throw new Error('current idx should be 2');
    const done = wrap.querySelectorAll('.sb-ladder-step.is-done');
    if (done.length !== 2) throw new Error('expected 2 done (idx 0,1), got ' + done.length);
    wrap.remove();
  }));

  results.push(_run('cycleQuote rotates within pool', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="char-quote"></div>');
    window.TIER_QUOTES = {
      '저항자': ['quote A', 'quote B', 'quote C'],
    };
    window.CU = { id: 'test-user-1' };
    // Reset state
    localStorage.removeItem(`sb_quote_idx_test-user-1_저항자`);
    const first = getCurrentQuote('저항자');
    if (first !== 'quote A') throw new Error('first quote should be A');
    cycleQuote('저항자');
    // 회전 트랜지션 (250ms) 후 검사 — 동기 검증 위해 상태값 읽기.
    const next = getCurrentQuote('저항자');
    if (next !== 'quote B') throw new Error('after cycle: should be B, got ' + next);
    document.getElementById('char-quote').remove();
  }));

  results.push(_run('setYrActive toggles body class', () => {
    setYrActive(true);
    if (!document.body.classList.contains('has-yr-active')) throw new Error('expected has-yr-active');
    setYrActive(false);
    if (document.body.classList.contains('has-yr-active')) throw new Error('expected no class');
  }));

  console.table(results);
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`Status Band tests: ${pass}/${results.length} passed${fail ? ` (${fail} FAILED)` : ' ✓'}`);
  return { pass, fail, results };
}

if (typeof window !== 'undefined') {
  window.runStatusBandTests = runStatusBandTests;
}
