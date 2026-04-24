// Stay Hard · daily mottos (neutral placeholder pool)
//
// 2026-04-24 rebrand phase 1: Goggins 인용·번역 전량 제거 (저작권 리스크).
// 마케팅 대체 문구 공급 전까지 임시 neutral pool 로 동작. 문구 공급 시 아래 배열만 교체.
//
// Rotates via showDailyMotto() in index.html (DOM-coupled).

/** @typedef {{ko:string, en?:string}} Motto */
/** @type {Motto[]} */
export const DAILY_MOTTOS = [
  { ko: '오늘의 증거는 너만 남길 수 있다.' },
  { ko: '빈칸은 변명하지 않는다. 기록이 말한다.' },
  { ko: '편한 길은 내일을 약하게 만든다.' },
  { ko: '고통은 기록될 때 성장으로 바뀐다.' },
  { ko: '어제의 너를 이기는 가장 조용한 방법 — 한 줄 더.' },
  { ko: '변명 없음. 기록 있음.' },
  { ko: '잘한 날은 쌓이고, 못한 날도 쌓인다. 둘 다 너다.' },
  { ko: '오늘 남긴 한 줄이 내일의 기준이다.' },
  { ko: '말은 잊히고, 기록은 남는다.' },
  { ko: '계속 가. 조용히, 매일.' },
];

// Legacy export alias — stale bundle 이 GOGGINS_MOTTOS 참조 시 throw 방지.
// Phase 1 rename 확정 후 다음 릴리스에서 제거.
export const GOGGINS_MOTTOS = DAILY_MOTTOS;
