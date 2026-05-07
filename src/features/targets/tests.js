// 큐록 · features/targets/tests.js — 콘솔 smoke test.
// 사용: window.runTargetsTests() — 결과 console.table.

import * as targets from './index.js';

function _mockLog() {
  return { targets: [], mandatory: [] };
}

function _runTest(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (e) {
    return { name, ok: false, err: e?.message || String(e) };
  }
}

export function runTargetsTests() {
  const results = [];

  // 1. addTarget 빈 input 무시
  results.push(_runTest('addTarget empty input is ignored', () => {
    const log = _mockLog();
    window.log = log;
    // input element 없으면 early-return — 안 던짐.
    targets.addTarget();
    if (log.targets.length !== 0) throw new Error('expected 0 targets');
  }));

  // 2. renderTargetsSummary 빈 상태
  results.push(_runTest('renderTargetsSummary empty', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="targets-summary"></div>');
    window.log = _mockLog();
    targets.renderTargetsSummary();
    const sum = document.getElementById('targets-summary');
    if (!sum.innerHTML.includes('할일 추가하기')) throw new Error('expected empty CTA');
    sum.remove();
  }));

  // 3. renderTargetsSummary 진행 중
  results.push(_runTest('renderTargetsSummary in-progress chip', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="targets-summary"></div>');
    window.log = { targets: [
      { text: 'a', st: 'done' },
      { text: 'b', st: '' },
    ]};
    targets.renderTargetsSummary();
    const sum = document.getElementById('targets-summary');
    if (!sum.innerHTML.includes('1/2')) throw new Error('expected 1/2 chip, got: ' + sum.innerHTML);
    sum.remove();
  }));

  // 4. renderTargetsSummary 모두 완료
  results.push(_runTest('renderTargetsSummary all done', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="targets-summary"></div>');
    window.log = { targets: [
      { text: 'a', st: 'done' },
      { text: 'b', st: 'done' },
    ]};
    targets.renderTargetsSummary();
    const sum = document.getElementById('targets-summary');
    if (!sum.innerHTML.includes('완료')) throw new Error('expected ✓ 완료');
    sum.remove();
  }));

  // 5. delTgt 인덱스 정상
  results.push(_runTest('delTgt removes by index', () => {
    window.log = { targets: [{ text: 'a', st: '' }, { text: 'b', st: '' }, { text: 'c', st: '' }] };
    document.body.insertAdjacentHTML('beforeend', '<div id="tgt-rows"></div>');
    targets.delTgt(1);
    if (window.log.targets.length !== 2) throw new Error('expected 2 left');
    if (window.log.targets[0].text !== 'a' || window.log.targets[1].text !== 'c') throw new Error('wrong order');
    document.getElementById('tgt-rows')?.remove();
  }));

  console.table(results);
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`Targets tests: ${pass}/${results.length} passed${fail ? ` (${fail} FAILED)` : ' ✓'}`);
  return { pass, fail, results };
}

if (typeof window !== 'undefined') {
  window.runTargetsTests = runTargetsTests;
}
