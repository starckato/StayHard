// 큐록 · src/tests/node-runner.mjs
// Node 환경에서 pure unit test 실행 (CI / pre-commit 검증용).
//
// 사용: node src/tests/node-runner.mjs
//
// 제약: window 의존 없는 pure module 만 가능.
//   - cubes/judge.js · score.js · pr.js · streak.js
//   - returner/grace.js
//   - exempt/index.js
//   - score-events.js
//   - cheat.js (supabase 사이드이펙트 회피 위해 getCheatWeekKey 만 inline 테스트)

// Polyfill minimal window/localStorage/WebSocket stubs (test 파일이 안전하게 import 되도록)
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem: (k) => _store.has(k) ? _store.get(k) : null,
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
  };
}
// Supabase realtime 가 WebSocket 요구 — Node 20 에선 stub 으로 충분 (테스트는 query 안 함)
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class StubWS {
    constructor() { this.readyState = 3; }
    addEventListener() {} removeEventListener() {}
    close() {} send() {}
  };
}

let totalPass = 0, totalFail = 0, totalCount = 0;
const failedSuites = [];

async function runSuite(name, importer) {
  console.log('\n─── ' + name + ' ───');
  try {
    const mod = await importer();
    const runner = mod.runReturnerTests || mod.runExemptTests || mod.runCubeTests
                 || mod.runScoreEventsTests || mod.runCheatTests
                 || mod.runTierTests || mod.runDateTests
                 || mod.runFirstCubeTests || mod.runOptInTests
                 || mod.runVolumeDeltaTests || mod.runMetricsTests
                 || mod.runMandatoryTests;
    if (typeof runner !== 'function') {
      console.warn('  ⚠ runner function not found');
      return;
    }
    const r = runner();
    totalPass += r.pass;
    totalFail += r.fail;
    totalCount += r.total;
    if (r.fail) failedSuites.push({ name, fails: r.fails || [] });
  } catch (e) {
    console.error('  ✗ ERROR:', e.message);
    failedSuites.push({ name, fails: [e.message] });
    totalFail++;
  }
}

console.log('═══════════════════════════════════════════════');
console.log(' 큐록 · pure-function unit tests (Node)');
console.log('═══════════════════════════════════════════════');

await runSuite('Cubes Judge',    () => import('../features/cubes/tests.js'));
await runSuite('Returner Grace', () => import('../features/returner/tests.js'));
await runSuite('Exempt 1-tap',   () => import('../features/exempt/tests.js'));
await runSuite('Score Events',   () => import('../data/score-events.tests.js'));
await runSuite('Tier System',    () => import('../lib/tier.tests.js'));
await runSuite('Date Utils',     () => import('../lib/date.tests.js'));
await runSuite('First Cube',     () => import('../features/activation/first-cube.tests.js'));
await runSuite('Notif Opt-in',   () => import('../features/notif/opt-in-scheduler.tests.js'));
await runSuite('Volume Delta',   () => import('../features/volume-delta/tests.js'));
await runSuite('Metrics EVT',    () => import('../features/metrics/tests.js'));
await runSuite('Mandatory Merge',() => import('../features/mandatory/tests.js'));
// cheat.tests.js 는 supabase 사이드이펙트 회피 위해 별도 처리
try {
  console.log('\n─── Cheat Quota ───');
  const { getCheatWeekKey } = await import('../lib/cheat.js');
  let pass = 0, fail = 0, n = 0;
  const t = (label, cond) => { n++; if (cond) pass++; else { fail++; console.warn('  ✗ ' + label); } };
  t('format YYYY-WNN', /^\d{4}-W\d{2}$/.test(getCheatWeekKey(new Date('2026-05-26'))));
  t('Mon~Sun 같은 키',
    getCheatWeekKey(new Date('2026-05-25')) === getCheatWeekKey(new Date('2026-05-31')));
  t('Sun → Mon 경계',
    getCheatWeekKey(new Date('2026-05-31')) !== getCheatWeekKey(new Date('2026-06-01')));
  t('연 경계 다른 키',
    getCheatWeekKey(new Date('2024-12-30')) !== getCheatWeekKey(new Date('2025-01-06')));
  t('Tue=Wed=Thu',
    getCheatWeekKey(new Date('2026-03-03')) === getCheatWeekKey(new Date('2026-03-04'))
      && getCheatWeekKey(new Date('2026-03-04')) === getCheatWeekKey(new Date('2026-03-05')));
  console.log('[cheat-quota] pass=' + pass + ' fail=' + fail + ' total=' + n);
  totalPass += pass; totalFail += fail; totalCount += n;
  if (fail) failedSuites.push({ name: 'Cheat Quota', fails: [] });
} catch (e) {
  console.error('  ✗ cheat suite ERROR:', e.message);
  totalFail++;
}

console.log('\n═══════════════════════════════════════════════');
console.log(' 총합: ' + totalPass + '/' + totalCount + ' passed' +
            (totalFail ? '  (' + totalFail + ' FAILED)' : '   ✓ ALL GREEN'));
console.log('═══════════════════════════════════════════════');

if (failedSuites.length) {
  console.log('\nFailed suites:');
  failedSuites.forEach(s => {
    console.log('  - ' + s.name);
    s.fails.forEach(f => console.log('     · ' + f));
  });
  process.exit(1);
}
process.exit(0);
