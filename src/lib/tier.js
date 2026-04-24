// 큐록 · tier system
// Pure data + pure functions for tier ladder, tier assets, and tier quotes.
// No app state. No DOM. Safely importable from anywhere; also exposed on
// window via src/main.js for inline-onclick compatibility during migration.
//
// Tier 6 = 기록자 (DEV_ANSWER_20260424.md §2, 2026-04-24 락인).
// Icon 이모지는 Phase 2 에서 inline SVG 로 교체 예정 — no-emoji 정책.

/** Tier thresholds 방관자 (0) → 기록자 (7000+). */
export const TIERS = [
  { min: 0,    max: 199,   icon: '',  name: '방관자',  desc: '자기 삶을 구경만 하는 자',       color: '#888' },
  { min: 200,  max: 599,   icon: '',  name: '각성자',  desc: '뭔가 달라져야 함을 느낀 자',     color: '#38bdf8' },
  { min: 600,  max: 1499,  icon: '',  name: '저항자',  desc: '나태함에 맞서 싸우기 시작한 자', color: '#f59e0b' },
  { min: 1500, max: 3499,  icon: '',  name: '수련자',  desc: '고통을 선택하며 단련되는 자',    color: '#34d399' },
  { min: 3500, max: 6999,  icon: '',  name: '지배자',  desc: '자신의 삶을 완전히 통제하는 자', color: '#ff4d4d' },
  { min: 7000, max: 99999, icon: '',  name: '기록자',  desc: '전부 기록하고, 전부 책임진 자',  color: '#a855f7' }
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

/** Per-tier-index asset URLs.
 * 유저 folder 명명:
 *   tier1/ = 방관자 (index 0)
 *   tier2/ = 각성자 (index 1) — hamburger throwing
 *   tier3/ = 저항자 (index 2) — walking (gym-ready, tank top)
 * 각성자 (index 1) 은 더 이상 tier 1 art 와 공유하지 않음 — 자체 로컬 art.
 */
export const TIER_ASSETS = {
  0: { char: `${ASSET_BASE}/GymRat_Tier1_character.png`, room: `${ASSET_BASE}/GymRat_Tier1_room.png` },
  1: {
    // 각성자 (200-599) — 햄버거 던지기 4프레임. 2026-04-24 assets/tier2 → index 1 로 재매핑.
    char: '/assets/tier2/Tier2_cha_nobg.png',
    room: '/assets/tier2/tier2_room.png',
    throwFramesSrc: [
      '/assets/tier2/Tier2_cha_throwingBurgur1.png',
      '/assets/tier2/Tier2_cha_throwingBurgur2.png',
      '/assets/tier2/Tier2_cha_throwingBurgur3.png',
      '/assets/tier2/Tier2_cha_throwingBurgur4.png',
    ],
  },
  2: {
    // 저항자 (600-1499) — walking 4프레임. 2026-04-24 assets/tier3 → index 2 로 재매핑.
    char: '/assets/tier3/Tier3_cha_nobg.png',
    room: `${ASSET_BASE}/GymRat_Tier3_room.png`, // 룸은 유저가 아직 안 줌 — supabase 유지
    walkFramesSrc: [
      '/assets/tier3/Tier3_cha_walking1.png',
      '/assets/tier3/Tier3_cha_walking2.png',
      '/assets/tier3/Tier3_cha_walking3.png',
      '/assets/tier3/Tier3_cha_walking4.png',
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

/** Rotating per-tier quote bank shown in the status band. Key = tier.name.
 *  DEV_ANSWER_20260424.md §2 6단 전체 신규 pool (Goggins 파생 제거).
 *  각 4개씩 · 25자 이내 · 해라체 or 명사구 · 이모지 0 · 무출처. */
export const TIER_QUOTES = {
  '방관자': [
    '아직 아무 칸도 남지 않았다.',
    '구경은 기록이 아니다.',
    '오늘이 첫 칸이다.',
    '빈칸이 너를 대신 말한다.',
  ],
  '각성자': [
    '느꼈으면 남겨라.',
    '하루 한 칸이 첫걸음이다.',
    '각성은 시작이지 끝이 아니다.',
    '빠진 칸은 다시 채울 수 있다.',
  ],
  '저항자': [
    '불편함을 택한 하루가 기록된다.',
    '싸움은 오늘의 칸에서 시작된다.',
    '피한 만큼 비어 있다.',
    '한 칸이 다음 칸을 부른다.',
  ],
  '수련자': [
    '단련은 반복의 기록이다.',
    '고통은 지나간다. 칸은 남는다.',
    '빠진 칸 없이 일주일을 남겼다.',
    '기록이 습관이 되었다.',
  ],
  '지배자': [
    '오늘의 칸을 네가 결정한다.',
    '통제는 기록으로 확인된다.',
    '붉은 칸도 네가 고른 기록이다.',
    '변명이 아니라 남은 칸이 말한다.',
  ],
  '기록자': [
    '기록이 몸이 됐다.',
    '전부 남겼다. 전부 책임진다.',
    '나는 내가 쌓은 기록이다.',
    '지나간 하루가 네 증거다.',
  ],
};
