// 큐록 · features/sticky-header — 슬림 56px 고정 헤더.
//
// prototype A6+A18 v2 통합 (2026-05-07). Status Band 의 cube stack /
// tier / streak / today / progress 를 sticky 로 이전 — 항상 화면 상단 노출.
//
// 마크업은 index.html 에 mount (architecture 컨벤션). 이 모듈은:
//   - applyRedCollapse(): 액션 (red 발생 시) sticky shake + burn flash 트리거
//   - smoke tests
// 데이터 sync (cube count / tier / progress) 는 inline 의 updateHeaderStatus 가
// 그대로 ID 로 접근 — sticky 로 element 이전된 후에도 이상 없음.

/** Red 발생 시 sticky 흔들림 + 빨간 burn flash. ui-events 의 _playRedCollapse 에서 호출. */
export function applyRedCollapse() {
  const sh = document.getElementById('sticky-header');
  if (!sh) return;
  sh.classList.remove('shaking', 'red-burn');
  void sh.offsetWidth;
  sh.classList.add('shaking', 'red-burn');
  setTimeout(() => sh.classList.remove('shaking', 'red-burn'), 950);
}

/** 큐브 카운터 도착 직전 호출 — Sticky 의 dot bump. */
export function bumpStickyDot(color) {
  const map = { gold: 'sh-dot-gold', silver: 'sh-dot-silver', red: 'sh-dot-red' };
  const id = map[color];
  if (!id) return;
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.classList.remove('bumped');
  void dot.offsetWidth;
  dot.classList.add('bumped');
  setTimeout(() => dot.classList.remove('bumped'), 420);
}

/**
 * Sticky-stuck detection — 스크롤로 상단 고정될 때 .is-stuck 토글.
 *
 * "합쳐+분리" 패턴 (Material collapsing toolbar / iOS large title 응용):
 *   rest 상태  → .sb 와 한 카드처럼 (둥근 모서리, 좌우 14px margin)
 *   stuck 상태 → 풀 너비로 *확장*, 모서리 sharp, 강한 그림자
 *
 * IntersectionObserver sentinel pattern:
 *   sticky 바로 위에 1px sentinel. sentinel 이 viewport 밖으로 나가면 sticky 가
 *   stuck 상태. 스크롤 핸들러보다 가볍고 정확.
 */
export function setupStickyHeader() {
  const sticky = document.getElementById('sticky-header');
  const sentinel = document.getElementById('sticky-sentinel');
  if (!sticky || !sentinel) return;
  if (sticky._stuckObs) return; // 중복 wiring 방지
  const observer = new IntersectionObserver(
    ([entry]) => {
      sticky.classList.toggle('is-stuck', !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(sentinel);
  sticky._stuckObs = observer;
}
