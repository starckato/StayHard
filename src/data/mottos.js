// 큐록 · daily mottos
//
// Manifesto register · 무출처 · 이모지 0 · 10~25자 이내 · 해라체 or 명사구.
// 마케팅 최종 락인 (DEV_ANSWER_20260424.md §1, 2026-04-24).
// 온보딩 3화면 · 스크린샷 · 공유 카드 전역에서 재사용되는 카피와 연속성 확보.
//
// Rotates via showDailyMotto() in index.html (DOM-coupled).

/** @typedef {{ko:string, en?:string}} Motto */
/** @type {Motto[]} */
export const DAILY_MOTTOS = [
  { ko: '전부 해내야 변한다.' },
  { ko: '오늘의 칸을 비우지 마라.' },
  { ko: '하루는 말보다 정직하다.' },
  { ko: '기록하지 않은 하루는 없다.' },
  { ko: '빠진 칸은 변명하지 않는다.' },
  { ko: '붉은 칸도 네 하루다. 숨기지 마라.' },
  { ko: '다짐은 사라진다. 남는 것은 오늘 채운 칸이다.' },
  { ko: '네 하루는 네 기록만큼 남는다.' },
  { ko: '나는 내가 쌓은 기록이다.' },
  { ko: '편한 쪽은 함정이다.' },
];
