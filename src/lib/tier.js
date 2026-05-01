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

/**
 * Per-tier sprite sheet asset URLs.
 *
 * Sheet layout (모든 sheet 동일):
 *   4344×724 px, 6 frames × 724×724 (가로 6프레임 portrait).
 *
 * 각 tier 5 actions:
 *   idle      : 기본 호흡/대기
 *   walk      : 이동
 *   exercise  : 메인 운동 (티어별 상징)
 *   food      : 식단 (먹기/던지기)
 *   special   : 티어별 특수 동작 (잠/플란치/회복 등)
 *
 * 폴더 매핑:
 *   tier1/ = 방관자 (idx 0)
 *   tier2/ = 각성자 (idx 1)
 *   tier3/ = 저항자 (idx 2)
 *   tier4/ = 수련자 (idx 3)
 *   tier5/ = 지배자 (idx 4)
 *   tier6/ = 기록자 (idx 5)
 */
export const SHEET_FRAMES = 6;
export const SHEET_FW = 724;
export const SHEET_FH = 724;

export const TIER_ASSETS = {
  0: {
    name: '방관자',
    sheets: {
      idle:     '/assets/tier1/Tier1_cha_idle_breathing_sheet.png',
      walk:     '/assets/tier1/Tier1_cha_walk_sheet.png',
      exercise: '/assets/tier1/Tier1_cha_dumbbell_sheet.png',
      food:     '/assets/tier1/Tier1_cha_eat_hamburger_sheet.png',
      special:  '/assets/tier1/Tier1_cha_sleep_sheet.png',
    },
    room: '/assets/rooms/Tier1_room.png',
    char: `${ASSET_BASE}/GymRat_Tier1_character.png`,
  },
  1: {
    name: '각성자',
    sheets: {
      idle:     '/assets/tier2/Tier2_cha_idle_breathing_sheet.png',
      walk:     '/assets/tier2/Tier2_cha_walk_sheet.png',
      exercise: '/assets/tier2/Tier2_cha_bench_press_sheet.png',
      food:     '/assets/tier2/Tier2_cha_throw_hamburger_sheet.png',
      special:  '/assets/tier2/Tier2_cha_pushup_sheet.png',
    },
    room: '/assets/rooms/Tier2_room.png',
    char: '/assets/tier2/Tier2_cha_nobg.png',
  },
  2: {
    name: '저항자',
    sheets: {
      idle:     '/assets/tier3/Tier3_cha_idle_breathing_sheet.png',
      walk:     '/assets/tier3/Tier3_cha_walk_sheet.png',
      exercise: '/assets/tier3/Tier3_cha_squat_sheet.png',
      food:     '/assets/tier3/Tier3_cha_burpee_sheet.png',
      special:  '/assets/tier3/Tier3_cha_planche_sheet.png',
    },
    room: '/assets/rooms/Tier3_room.png',
    char: '/assets/tier3/Tier3_cha_nobg.png',
  },
  3: {
    name: '수련자',
    sheets: {
      idle:     '/assets/tier4/Tier4_cha_idle_breath_sheet.png',
      walk:     '/assets/tier4/Tier4_cha_walk_sheet.png',
      exercise: '/assets/tier4/Tier4_cha_power_punch_sheet.png',
      food:     '/assets/tier4/Tier4_cha_guard_block_sheet.png',
      special:  '/assets/tier4/Tier4_cha_victory_flex_sheet.png',
    },
    room: '/assets/rooms/Tier4_room.png',
    char: `${ASSET_BASE}/GymRat_Tier4_character.png`,
  },
  4: {
    name: '지배자',
    sheets: {
      idle:     '/assets/tier5/Tier5_cha_idle_focus_sheet.png',
      walk:     '/assets/tier5/Tier5_cha_walk_champion_sheet.png',
      exercise: '/assets/tier5/Tier5_cha_combo_punch_sheet.png',
      food:     '/assets/tier5/Tier5_cha_iron_will_charge_sheet.png',
      special:  '/assets/tier5/Tier5_cha_roar_flex_sheet.png',
    },
    room: '/assets/rooms/Tier5_room.png',
    char: `${ASSET_BASE}/GymRat_Tier4_character.png`,
  },
  5: {
    name: '기록자',
    sheets: {
      idle:     '/assets/tier6/Tier6_cha_idle_legend_sheet.png',
      walk:     '/assets/tier6/Tier6_cha_heavy_walk_sheet.png',
      exercise: '/assets/tier6/Tier6_cha_ground_slam_sheet.png',
      food:     '/assets/tier6/Tier6_cha_golden_power_up_sheet.png',
      special:  '/assets/tier6/Tier6_cha_champion_pose_sheet.png',
    },
    room: '/assets/rooms/Tier6_room.png',
    char: `${ASSET_BASE}/GymRat_Tier4_character.png`,
  },
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
