// 큐록 · src/tests/run-all.js
// 통합 테스트 runner — 브라우저 콘솔에서 window.runAllTests() 호출.
//
// 모든 pure unit test 를 순서대로 실행 + 종합 결과 리포트.

export function runAllTests() {
  const suites = [
    { name: 'Cubes Judge',    fn: typeof window !== 'undefined' && window.runCubeTests },
    { name: 'Returner Grace', fn: typeof window !== 'undefined' && window.runReturnerTests },
    { name: 'Exempt 1-tap',   fn: typeof window !== 'undefined' && window.runExemptTests },
    { name: 'Score Events',   fn: typeof window !== 'undefined' && window.runScoreEventsTests },
    { name: 'Cheat Quota',    fn: typeof window !== 'undefined' && window.runCheatTests },
    { name: 'Tier System',    fn: typeof window !== 'undefined' && window.runTierTests },
    { name: 'Date Utils',     fn: typeof window !== 'undefined' && window.runDateTests },
    { name: 'First Cube',     fn: typeof window !== 'undefined' && window.runFirstCubeTests },
    { name: 'Notif Opt-in',   fn: typeof window !== 'undefined' && window.runOptInTests },
    { name: 'Volume Delta',   fn: typeof window !== 'undefined' && window.runVolumeDeltaTests },
    { name: 'Metrics EVT',    fn: typeof window !== 'undefined' && window.runMetricsTests },
    { name: 'Mandatory Merge',fn: typeof window !== 'undefined' && window.runMandatoryTests },
    { name: 'Status Band',    fn: typeof window !== 'undefined' && window.runStatusBandTests },
    { name: 'Targets',        fn: typeof window !== 'undefined' && window.runTargetsTests },
  ];

  console.log('═══════════════════════════════════════════════');
  console.log('큐록 · 통합 unit test 실행');
  console.log('═══════════════════════════════════════════════');

  const results = [];
  let totalPass = 0, totalFail = 0, totalCount = 0;

  for (const s of suites) {
    if (typeof s.fn !== 'function') {
      results.push({ suite: s.name, status: 'SKIP', reason: 'runner not found' });
      continue;
    }
    try {
      const r = s.fn();
      const pass = r.pass || 0;
      const fail = r.fail || 0;
      const total = r.total || (pass + fail);
      totalPass += pass;
      totalFail += fail;
      totalCount += total;
      results.push({
        suite: s.name,
        pass,
        fail,
        total,
        status: fail === 0 ? '✓' : '✗',
        fails: r.fails || [],
      });
    } catch (e) {
      results.push({ suite: s.name, status: 'ERROR', error: e && e.message });
      totalFail++;
    }
  }

  console.log('');
  console.log('─── 결과 요약 ───');
  console.table(results.map(r => ({
    Suite: r.suite,
    Status: r.status,
    Pass: r.pass ?? '-',
    Fail: r.fail ?? '-',
    Total: r.total ?? '-',
  })));

  const allGreen = totalFail === 0;
  console.log('');
  console.log(`총합: ${totalPass}/${totalCount} passed${totalFail ? ` (${totalFail} FAILED)` : ' ✓ ALL GREEN'}`);

  // Fail 상세
  results.forEach(r => {
    if (r.fails && r.fails.length) {
      console.warn(`[${r.suite}] failures:`);
      r.fails.forEach(f => console.warn('  - ' + f));
    }
  });

  return {
    allGreen,
    totalPass,
    totalFail,
    totalCount,
    suites: results,
  };
}

if (typeof window !== 'undefined') {
  window.runAllTests = runAllTests;
}
