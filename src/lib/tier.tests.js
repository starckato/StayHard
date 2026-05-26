// 큐록 · src/lib/tier.tests.js
// Tier 시스템 (점수 → 티어 매핑) 테스트.
// 브라우저 콘솔: window.runTierTests()

import {
  TIERS,
  CUBE_TIER_THRESHOLDS,
  getTier,
  getTierFromCubes,
  scoreFromLifetime,
  getTierAssets,
} from './tier.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── TIERS 데이터 정합성 ───────────────────────────
t('TIERS · 6단', () => TIERS.length === 6);
t('TIERS · 순서 [방관자,각성자,저항자,수련자,지배자,기록자]',
  () => TIERS.map(t => t.name).join(',') === '방관자,각성자,저항자,수련자,지배자,기록자');
t('TIERS · min 오름차순',
  () => TIERS.every((t, i) => i === 0 || TIERS[i - 1].min < t.min));
t('TIERS · min 0 부터 시작',
  () => TIERS[0].min === 0);
t('TIERS · 마지막 max 큰 값 (>= 7000)',
  () => TIERS[5].min === 7000);
t('TIERS · 각 tier 에 name/color/desc',
  () => TIERS.every(t => t.name && t.color && t.desc));
t('TIERS · icon 전부 빈 문자열 (2026-05-26 이모지 제거)',
  () => TIERS.every(t => t.icon === ''));

// ───── getTier ───────────────────────────────────────
t('getTier · 0 → 방관자', () => getTier(0).name === '방관자');
t('getTier · 100 → 방관자', () => getTier(100).name === '방관자');
t('getTier · 199 → 방관자 (boundary)', () => getTier(199).name === '방관자');
t('getTier · 200 → 각성자 (boundary +1)', () => getTier(200).name === '각성자');
t('getTier · 599 → 각성자', () => getTier(599).name === '각성자');
t('getTier · 600 → 저항자', () => getTier(600).name === '저항자');
t('getTier · 1499 → 저항자', () => getTier(1499).name === '저항자');
t('getTier · 1500 → 수련자', () => getTier(1500).name === '수련자');
t('getTier · 3499 → 수련자', () => getTier(3499).name === '수련자');
t('getTier · 3500 → 지배자', () => getTier(3500).name === '지배자');
t('getTier · 6999 → 지배자', () => getTier(6999).name === '지배자');
t('getTier · 7000 → 기록자', () => getTier(7000).name === '기록자');
t('getTier · 100000 → 기록자', () => getTier(100000).name === '기록자');
t('getTier · 음수 → 방관자 (fallback)', () => getTier(-100).name === '방관자');

// ───── CUBE_TIER_THRESHOLDS / getTierFromCubes ────────
t('CUBE_TIER_THRESHOLDS · 6단', () => CUBE_TIER_THRESHOLDS.length === 6);
t('CUBE_TIER_THRESHOLDS · [0,12,60,200,500,1400]',
  () => CUBE_TIER_THRESHOLDS.join(',') === '0,12,60,200,500,1400');

t('getTierFromCubes · 0,0 → 방관자',
  () => getTierFromCubes(0, 0).name === '방관자');
t('getTierFromCubes · 11,0 → 방관자 (12 미만)',
  () => getTierFromCubes(11, 0).name === '방관자');
t('getTierFromCubes · 12,0 → 각성자',
  () => getTierFromCubes(12, 0).name === '각성자');
t('getTierFromCubes · silver 만 36 (=12 점) → 각성자',
  () => getTierFromCubes(0, 36).name === '각성자');
t('getTierFromCubes · gold 60 → 저항자',
  () => getTierFromCubes(60, 0).name === '저항자');
t('getTierFromCubes · gold 200 → 수련자',
  () => getTierFromCubes(200, 0).name === '수련자');
t('getTierFromCubes · gold 500 → 지배자',
  () => getTierFromCubes(500, 0).name === '지배자');
t('getTierFromCubes · gold 1400 → 기록자',
  () => getTierFromCubes(1400, 0).name === '기록자');
t('getTierFromCubes · gold + silver 혼합',
  () => getTierFromCubes(100, 30).name === '저항자'); // 100 + 10 = 110 < 200
t('getTierFromCubes · 음수 → 0 으로 처리 → 방관자',
  () => getTierFromCubes(-10, -5).name === '방관자');
t('getTierFromCubes · 문자열 coerce',
  () => getTierFromCubes('60', '0').name === '저항자');

// ───── scoreFromLifetime ─────────────────────────────
t('scoreFromLifetime · 12 gold + 0 silver = 12',
  () => scoreFromLifetime(12, 0) === 12);
t('scoreFromLifetime · 0 gold + 30 silver = 10',
  () => scoreFromLifetime(0, 30) === 10);
t('scoreFromLifetime · 10 gold + 9 silver = 13',
  () => scoreFromLifetime(10, 9) === 13);
t('scoreFromLifetime · 음수 → 0 처리',
  () => scoreFromLifetime(-10, -10) === 0);

// ───── getTierAssets ─────────────────────────────────
t('getTierAssets · 0 → tier1 asset',
  () => {
    const a = getTierAssets(0);
    return a.char && a.room && a.sheets && a.name === '방관자';
  });
t('getTierAssets · 200 → tier2 (각성자)',
  () => getTierAssets(200).name === '각성자');
t('getTierAssets · 100000 → 기록자',
  () => getTierAssets(100000).name === '기록자');
t('getTierAssets · 각 tier sheet 5종 (idle/walk/exercise/food/special)',
  () => {
    const a = getTierAssets(0);
    return a.sheets.idle && a.sheets.walk && a.sheets.exercise && a.sheets.food && a.sheets.special;
  });

// ───── Runner ────────────────────────────────────────
export function runTierTests() {
  let pass = 0, fail = 0;
  const fails = [];
  for (const c of _cases) {
    try {
      const ok = c.fn();
      if (ok) pass++;
      else { fail++; fails.push(c.name); }
    } catch (e) {
      fail++;
      fails.push(c.name + ' [THROW: ' + (e && e.message) + ']');
    }
  }
  console.log('[tier-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runTierTests = runTierTests;
}
