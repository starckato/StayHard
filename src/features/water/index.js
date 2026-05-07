// 큐록 · features/water — 물 컵 카운트 + 일일 목표.
//
// 추출 (2026-05-07): index.html 의 4개 region 에서 통째로 이전.
//   - CSS region #1 (line ~370): .wg-btn (목표 선택 버튼)
//   - CSS region #2 (line ~902): .water-strip / .water-cups / .wc / .water-val
//   - JS region #1 (line ~5965): getWaterGoal / toggleWaterGoalPanel / setWaterGoal / refreshWaterGoalUI
//   - JS region #2 (line ~10261): renderWater
//   - HTML markup (line ~1610-1628) — index.html 에 mount 지점 그대로 유지.
//
// 외부 의존성 (window 글로벌):
//   CP, CU, sb, log, scheduleSave, recomputeCubesHook, _tryMicroReward,
//   tipWater, renderFoodSummary, showToast.

/** 사용자 일일 물 목표 (컵 단위, 1컵 = 0.5L). 미설정 시 6컵 (3L). */
export function getWaterGoal() {
  const CP = window.CP;
  return (CP && CP.water_goal) || 6;
}

/** 12개 0.5L 단위 버튼 중 현재 목표에 해당하는 버튼만 active. */
function refreshWaterGoalUI() {
  const goal = getWaterGoal();
  for (let i = 1; i <= 12; i++) {
    const btn = document.getElementById('wg-btn-' + i);
    if (btn) btn.classList.toggle('active', i === goal);
  }
}

/** 물 목표 panel 토글 — gear 버튼 색도 동기. */
export function toggleWaterGoalPanel() {
  const panel = document.getElementById('water-goal-panel');
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  const btn = document.getElementById('water-gear-btn');
  if (btn) btn.style.color = open ? 'var(--accent)' : 'var(--text3)';
  if (open) refreshWaterGoalUI();
}

/** 목표 변경 — DB 갱신 + 재렌더 + 닫기. */
export async function setWaterGoal(cups) {
  const CP = window.CP;
  const sb = window.sb;
  const CU = window.CU;
  if (!CP || !sb || !CU) return;
  CP.water_goal = cups;
  await sb.from('profiles').update({ water_goal: cups }).eq('id', CU.id);
  refreshWaterGoalUI();
  renderWater();
  const panel = document.getElementById('water-goal-panel');
  if (panel) panel.style.display = 'none';
  const gearBtn = document.getElementById('water-gear-btn');
  if (gearBtn) gearBtn.style.color = 'var(--text3)';
  if (window.showToast) window.showToast('물 목표: ' + (cups * .5).toFixed(1) + 'L 설정됨 💧');
}

/** 12 컵 그리드 렌더 + 목표 대비 표시. 컵 클릭 = toggle. */
export function renderWater() {
  const log = window.log;
  if (!log) return;
  const c = document.getElementById('water-cups');
  if (!c) return;
  c.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div');
    d.className = 'wc' + (i < log.water_cups ? ' on' : '');
    d.onclick = () => {
      try { window.tipWater?.(); } catch {}
      const prev = log.water_cups;
      log.water_cups = (log.water_cups === i + 1) ? i : i + 1;
      renderWater();
      try { window.scheduleSave?.(); } catch {}
      if (log.water_cups > prev) {
        try { window._tryMicroReward?.('water'); } catch {}
      }
      try { window.recomputeCubesHook?.(); } catch {}
    };
    c.appendChild(d);
  }
  const val = document.getElementById('water-val');
  const goal = getWaterGoal();
  const met = log.water_cups >= goal;
  const curL = (log.water_cups * .5).toFixed(1);
  const goalL = (goal * .5).toFixed(1);
  if (val) {
    val.textContent = curL + ' / ' + goalL + 'L' + (met ? ' ✓' : '');
    val.style.color = met ? 'var(--blue)' : 'var(--text2)';
  }
  // Tint the gear button when goal is met
  const gear = document.getElementById('water-gear-btn');
  if (gear) gear.style.color = met ? 'var(--blue)' : 'var(--text3)';
  // Keep the food card's collapsed summary in sync with water changes
  try { window.renderFoodSummary?.(); } catch {}
}
