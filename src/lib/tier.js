// Stay Hard · tier system
// Pure data + pure functions for tier ladder, tier assets, and tier quotes.
// No app state. No DOM. Safely importable from anywhere; also exposed on
// window via src/main.js for inline-onclick compatibility during migration.

/** Tier thresholds from 방관자 (0) to Goggins (7000+). */
export const TIERS = [
  { min: 0,    max: 199,   icon: '😴',  name: '방관자',  desc: '자기 삶을 구경만 하는 자',       color: '#888' },
  { min: 200,  max: 599,   icon: '👁️', name: '각성자',  desc: '뭔가 달라져야 함을 느낀 자',     color: '#38bdf8' },
  { min: 600,  max: 1499,  icon: '⚔️', name: '저항자',  desc: '나태함에 맞서 싸우기 시작한 자', color: '#f59e0b' },
  { min: 1500, max: 3499,  icon: '🔥',  name: '수련자',  desc: '고통을 선택하며 단련되는 자',    color: '#34d399' },
  { min: 3500, max: 6999,  icon: '💎',  name: '지배자',  desc: '자신의 삶을 완전히 통제하는 자', color: '#ff4d4d' },
  { min: 7000, max: 99999, icon: '💀',  name: 'Goggins', desc: '타협 없음. 한계란 없음',         color: '#a855f7' }
];

/**
 * Resolve tier for a given accumulated score.
 * Highest tier whose `min` ≤ score; fallback = lowest tier.
 * @param {number} score
 * @returns {typeof TIERS[number]}
 */
export function getTier(score) {
  return [...TIERS].reverse().find(t => score >= t.min) || TIERS[0];
}

/** Supabase public storage base for tier character/room art. */
export const ASSET_BASE = 'https://uvaosxhsjscigheyymus.supabase.co/storage/v1/object/public/game-assets';

/** Per-tier-index asset URLs. Tier 1 shares art with Tier 0, Tier 5 with Tier 4. */
// 2026-04-24: tier 2 (저항자) 는 로컬 assets/tier2/ 로 전환. throw sprite sheet 4-frame.
// 다른 tier 는 Supabase 유지 — 점진적 전환.
export const TIER_ASSETS = {
  0: { char: `${ASSET_BASE}/GymRat_Tier1_character.png`, room: `${ASSET_BASE}/GymRat_Tier1_room.png` },
  1: { char: `${ASSET_BASE}/GymRat_Tier1_character.png`, room: `${ASSET_BASE}/GymRat_Tier1_room.png` },
  2: {
    char: '/assets/tier2/Tier2_cha_nobg.png',
    room: '/assets/tier2/tier2_room.png', // 2026-04-24: gym 룸 (bench + 덤벨)
    // 2026-04-24: sprite sheet 대신 4개 개별 프레임 (각 675×685). JS 로 순환.
    throwFramesSrc: [
      '/assets/tier2/Tier2_cha_throwingBurgur1.png',
      '/assets/tier2/Tier2_cha_throwingBurgur2.png',
      '/assets/tier2/Tier2_cha_throwingBurgur3.png',
      '/assets/tier2/Tier2_cha_throwingBurgur4.png',
    ],
  },
  3: { char: `${ASSET_BASE}/GymRat_Tier3_character.png`, room: `${ASSET_BASE}/GymRat_Tier3_room.png` },
  4: { char: `${ASSET_BASE}/GymRat_Tier4_character.png`, room: `${ASSET_BASE}/GymRat_Tier4_room.png` },
  5: { char: `${ASSET_BASE}/GymRat_Tier4_character.png`, room: `${ASSET_BASE}/GymRat_Tier4_room.png` }
};

/**
 * Resolve tier art for a given score.
 * @param {number} score
 * @returns {{char:string, room:string}}
 */
export function getTierAssets(score) {
  const tier = getTier(score);
  const idx = TIERS.indexOf(tier);
  return TIER_ASSETS[idx] || TIER_ASSETS[0];
}

/** Rotating per-tier quote bank shown in the status band. Key = tier.name. */
export const TIER_QUOTES = {
  '방관자':  ['일어나... 아직 늦지 않았어.','언제까지 구경만 할 거야?','오늘이 시작하기 가장 좋은 날이야.','변하고 싶다며? 증명해.'],
  '각성자':  ['눈을 떴구나. 이제 시작이야.','각성했어. 멈추지 마.','어제의 너는 죽었어. 오늘의 너를 만들어.','느꼈으면 움직여.'],
  '저항자':  ['고통이 느껴지지? 그게 성장이야.','나태함과 싸우는 중이야. 이기고 있어.','포기하고 싶을 때가 진짜 시작이야.','불편함을 선택한 너는 이미 다르다.'],
  '수련자':  ['멈추지 마. 넌 이미 다른 사람이야.','규율이 습관이 됐어. 이게 진짜 힘이야.','고통을 즐기기 시작했구나.','네가 걸어온 길을 돌아봐. 대단해.'],
  '지배자':  ['네 삶은 네가 통제한다. 계속해.','약한 자신은 이미 죽었어.','이제 남들이 너를 보고 배운다.','통제. 규율. 반복. 이게 네 무기야.'],
  'Goggins': ["They don't know me, son.","Who's gonna carry the boats?","Stay hard. Always.","You are not done. Not even close."]
};
