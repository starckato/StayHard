// Stay Hard · weight feature (v2 — collapsed/expanded accordion)
//
// Renders the collapsed summary AND the expanded body: status meta, big
// number, 30-day line graph with goal line, target strip, and action row.
// Still writes through window.log / window.logCache / window.CP via the
// proxies set up in index.html inline script.

import { sb } from '../../lib/supabase.js';
import { SCORE_EVENTS } from '../../data/score-events.js';
import { showToast } from '../../ui/toast.js';

// Exclusive accordion helper — collapses every other .s-card.accordion
// before expanding `targetId`. When `targetId` is already expanded we
// simply collapse it (toggle off, nothing else opens).
export function setExclusiveCard(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const willExpand = !target.classList.contains('expanded');
  document.querySelectorAll('.s-card.accordion').forEach(c => {
    if (c !== target) c.classList.remove('expanded');
  });
  target.classList.toggle('expanded', willExpand);
  try { window.sh?.haptics?.tap('light'); } catch {}
  return willExpand;
}

export function toggleWeightCard() {
  const expanded = setExclusiveCard('wt-card');
  if (expanded) renderWeight();
}

export function toggleWeightInfo() {
  const panel = document.getElementById('wt-info-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// ── State derivation ──────────────────────────────────────────────────
// 'recorded'   today's weight exists
// 'carryover'  today empty, last non-null within 7 days
// 'stale'      last non-null 7-13 days ago
// 'overdue'    last non-null 14+ days ago
// 'empty'      no weight anywhere
function deriveState() {
  const todayW = window.log?.weight != null ? parseFloat(window.log.weight) : null;
  if (todayW != null) return { state: 'recorded', value: todayW, daysSince: 0 };

  // scan logCache backwards from today up to 60 days
  const today = new Date(window.now);
  let found = null;
  for (let i = 1; i <= 60; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = window.dkey(d);
    const l = window.logCache?.[k];
    if (l && l.weight != null) { found = { value: parseFloat(l.weight), daysSince: i }; break; }
  }
  if (!found) return { state: 'empty', value: null, daysSince: null };
  if (found.daysSince <= 7) return { state: 'carryover', ...found };
  if (found.daysSince < 14) return { state: 'stale', ...found };
  return { state: 'overdue', ...found };
}

// Compare the currently-displayed weight to the previous non-null weight
// in logCache. `offsetDays` lets the caller anchor the search relative to
// the displayed value — e.g. in carryover state the shown weight is 3 days
// old, so we want the entry BEFORE that, not the gap between today and 3d.
// Returns just the signed delta string (no '어제' / 'N일 전' label).
function formatDelta(w, offsetDays) {
  if (w == null) return null;
  const anchor = new Date(window.selectedDate);
  const start = (offsetDays || 0) + 1;
  for (let i = start; i <= 60; i++) {
    const d = new Date(anchor); d.setDate(anchor.getDate() - i);
    const k = window.dkey(d);
    const l = window.logCache?.[k];
    const prev = l?.weight != null ? parseFloat(l.weight) : null;
    if (prev == null) continue;
    const diff = w - prev;
    if (Math.abs(diff) < 0.05) return { text: '±0.0', cls: '' };
    if (diff < 0) return { text: diff.toFixed(1), cls: 'down pos' };
    return { text: '+' + diff.toFixed(1), cls: 'up neg' };
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────
export function renderWeight() {
  // 첫 주 미션 재평가
  try { if (typeof renderFirstWeekCard === 'function') renderFirstWeekCard(); } catch (e) {}

  const info = deriveState();
  const goal = getWeightGoal();
  const card = document.getElementById('wt-card');
  if (!card) return;

  // ─── Collapsed summary ───────────────────────────────────────────────
  const ccMain = document.getElementById('wt-cc-main');
  const ccDelta = document.getElementById('wt-cc-delta');
  const ccSep = document.getElementById('wt-cc-sep');
  if (info.state === 'empty') {
    if (ccMain) { ccMain.textContent = '기록 필요'; ccMain.className = 'empty'; }
    if (ccDelta) { ccDelta.textContent = ''; ccDelta.className = ''; }
    if (ccSep) ccSep.style.display = 'none';
  } else {
    if (ccMain) {
      ccMain.textContent = info.value.toFixed(1) + ' kg';
      ccMain.className = info.state === 'stale' ? 'main stale'
                       : info.state === 'overdue' ? 'main overdue'
                       : 'main';
    }
    if (ccSep) ccSep.style.display = '';
    if (ccDelta) {
      // Signed kg vs the record BEFORE the displayed value. If there is
      // no prior record to compare against, hide the delta entirely so we
      // don't clutter the row with '첫 기록' noise — the kg value is
      // enough on its own.
      const d = formatDelta(info.value, info.daysSince || 0);
      if (d) {
        ccDelta.textContent = d.text;
        ccDelta.className = d.cls.split(' ').map(c => c === 'down' ? 'pos' : c === 'up' ? 'neg' : c).join(' ');
        ccSep && (ccSep.style.display = '');
      } else {
        ccDelta.textContent = '';
        ccDelta.className = '';
        ccSep && (ccSep.style.display = 'none');
      }
    }
  }

  // ─── Expanded body ───────────────────────────────────────────────────
  // Only fill if the body is actually visible to avoid layout work.
  if (!card.classList.contains('expanded')) return;

  const meta = document.getElementById('wt-meta');
  const metaStatus = document.getElementById('wt-meta-status');
  const metaSep = document.getElementById('wt-meta-sep');
  const metaDelta = document.getElementById('wt-meta-delta');
  const weightWrap = document.getElementById('wt-weight-wrap');
  const weightDisplay = document.getElementById('wt-display');
  const unitEl = document.getElementById('wt-unit');
  const emptyMsg = document.getElementById('wt-empty-msg');
  const inbodyRow = document.getElementById('wt-inbody-row');
  const graphWrap = document.getElementById('wt-graph-wrap');
  const goalBtn = document.getElementById('wt-goal-btn');
  const primaryBtn = document.getElementById('wt-primary-btn');
  const axisStart = document.getElementById('wt-axis-start');
  const axisEnd = document.getElementById('wt-axis-end');

  if (meta) {
    meta.className = 'wc-meta ' + info.state;
  }
  if (metaStatus) {
    metaStatus.textContent = info.state === 'recorded' ? '오늘 기록됨'
                          : info.state === 'carryover' ? info.daysSince + '일 전 기록'
                          : info.state === 'stale' ? info.daysSince + '일 전 기록'
                          : info.state === 'overdue' ? '업데이트 필요'
                          : '기록 없음';
  }
  {
    const d = formatDelta(info.value, info.daysSince || 0);
    if (d) {
      if (metaSep) metaSep.style.display = '';
      if (metaDelta) { metaDelta.style.display = ''; metaDelta.textContent = d.text; metaDelta.className = 'delta ' + d.cls.split(' ')[0]; }
    } else {
      if (metaSep) metaSep.style.display = 'none';
      if (metaDelta) metaDelta.style.display = 'none';
    }
  }

  // Goal info merged into meta line: "목표까지 -6.4kg" / "🎯 달성" / "목표 미설정"
  const metaGoalSep = document.getElementById('wt-meta-goal-sep');
  const metaGoal = document.getElementById('wt-meta-goal');
  if (metaGoal && metaGoalSep) {
    if (info.state === 'empty') {
      metaGoalSep.style.display = 'none';
      metaGoal.style.display = 'none';
    } else if (goal && info.value != null) {
      const diff = goal - info.value;
      metaGoalSep.style.display = '';
      metaGoal.style.display = '';
      if (diff >= 0) {
        // Above or at goal (still gaining toward a gain target) or already reached.
        metaGoal.textContent = '🎯 달성';
        metaGoal.className = 'wc-meta-goal achieved';
      } else {
        metaGoal.textContent = '목표까지 ' + diff.toFixed(1) + 'kg';
        metaGoal.className = 'wc-meta-goal';
      }
    } else if (!goal) {
      metaGoalSep.style.display = '';
      metaGoal.style.display = '';
      metaGoal.textContent = '목표 미설정';
      metaGoal.className = 'wc-meta-goal unset';
    } else {
      metaGoalSep.style.display = 'none';
      metaGoal.style.display = 'none';
    }
  }

  if (weightWrap && weightDisplay && unitEl && emptyMsg) {
    if (info.state === 'empty') {
      weightWrap.style.display = 'none';
      unitEl.style.display = 'none';
      emptyMsg.style.display = 'block';
      emptyMsg.textContent = '체중을 처음 기록해주세요';
    } else if (info.state === 'overdue') {
      weightWrap.style.display = 'none';
      unitEl.style.display = 'none';
      emptyMsg.style.display = 'block';
      emptyMsg.textContent = info.daysSince + '일간 업데이트 없음';
    } else {
      weightWrap.style.display = 'inline-flex';
      unitEl.style.display = '';
      emptyMsg.style.display = 'none';
      weightDisplay.textContent = info.value.toFixed(1);
      weightWrap.className = 'wc-weight' + (info.state === 'carryover' ? ' carryover' : info.state === 'stale' ? ' stale' : '');
    }
  }

  // 인바디 (recorded 상태에서만)
  if (inbodyRow) {
    const m = window.log?.muscle_mass;
    const f = window.log?.body_fat_pct;
    if (info.state === 'recorded' && (m || f)) {
      const parts = [];
      if (m) parts.push('💪 골격근 ' + parseFloat(m).toFixed(1) + 'kg');
      if (f) parts.push('🔥 체지방 ' + parseFloat(f).toFixed(1) + '%');
      inbodyRow.textContent = parts.join('  ·  ');
      inbodyRow.style.display = 'block';
    } else {
      inbodyRow.style.display = 'none';
    }
  }

  // ─── Graph ───
  renderWeightGraph(goal);
  if (graphWrap) graphWrap.style.opacity = info.state === 'empty' ? '0.3' : '1';

  // ─── Primary CTA state ───
  if (primaryBtn) {
    primaryBtn.className = 'wc-btn-primary';
    primaryBtn.textContent = '입력';
    if (info.state === 'overdue') { primaryBtn.classList.add('urgent'); primaryBtn.textContent = '오늘 체중 입력'; }
    else if (info.state === 'empty') { primaryBtn.classList.add('cta'); primaryBtn.textContent = '입력'; }
    else if (info.state === 'stale') { primaryBtn.classList.add('cta'); primaryBtn.textContent = '업데이트'; }
  }

  // ─── Goal-set ghost button: tint amber when no goal yet to nudge user ───
  if (goalBtn) {
    goalBtn.className = 'wc-btn-ghost' + (!goal ? ' cta' : '');
    goalBtn.textContent = goal ? '목표 편집' : '목표 설정';
  }

  // Axis labels
  const history = collectHistory(30);
  const vals = history.filter(v => v != null);
  if (axisStart) axisStart.textContent = vals.length ? vals[0].toFixed(1) : '—';
  if (axisEnd) axisEnd.textContent = info.value != null ? info.value.toFixed(1) : (vals.length ? vals[vals.length - 1].toFixed(1) : '—');
}

// Collect last N days of weight values from logCache. Missing days are null.
function collectHistory(days) {
  const out = [];
  const today = new Date(window.now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = window.dkey(d);
    const l = window.logCache?.[k];
    const w = l?.weight != null ? parseFloat(l.weight) : null;
    out.push(isFinite(w) ? w : null);
  }
  return out;
}

function renderWeightGraph(goal) {
  const points = document.getElementById('wt-points');
  const linePath = document.getElementById('wt-line-path');
  const areaPath = document.getElementById('wt-area-path');
  const goalLine = document.getElementById('wt-goal-line');
  const goalLabel = document.getElementById('wt-goal-label');
  if (!points || !linePath || !areaPath) return;

  const history = collectHistory(30);
  const vals = history.filter(v => v != null);

  if (!vals.length) {
    points.innerHTML = '';
    linePath.setAttribute('d', '');
    areaPath.setAttribute('d', '');
    if (goalLine) goalLine.style.display = 'none';
    if (goalLabel) goalLabel.style.display = 'none';
    return;
  }

  const W = 340, H = 64, PAD_Y = 8, PAD_X = 4;
  const minV = Math.min(...vals, goal ?? vals[0]) - 0.5;
  const maxV = Math.max(...vals, goal ?? vals[0]) + 0.5;
  const range = (maxV - minV) || 1;
  const yFor = v => PAD_Y + (1 - (v - minV) / range) * (H - PAD_Y * 2);
  const xFor = i => PAD_X + (i / (history.length - 1)) * (W - PAD_X * 2);

  if (goal && goalLine && goalLabel) {
    const gy = yFor(goal);
    goalLine.style.display = '';
    goalLabel.style.display = '';
    goalLine.setAttribute('y1', gy);
    goalLine.setAttribute('y2', gy);
    goalLabel.setAttribute('y', gy - 3);
    goalLabel.textContent = goal.toFixed(1);
  } else if (goalLine && goalLabel) {
    goalLine.style.display = 'none';
    goalLabel.style.display = 'none';
  }

  let d = '', areaD = '', started = false;
  let lastRealIdx = -1;
  history.forEach((v, i) => { if (v != null) lastRealIdx = i; });

  history.forEach((v, i) => {
    if (v == null) return;
    const x = xFor(i), y = yFor(v);
    if (!started) { d += `M ${x} ${y}`; areaD += `M ${x} ${H - PAD_Y} L ${x} ${y}`; started = true; }
    else { d += ` L ${x} ${y}`; areaD += ` L ${x} ${y}`; }
  });
  if (started) areaD += ` L ${xFor(lastRealIdx)} ${H - PAD_Y} Z`;

  linePath.setAttribute('d', d);
  areaPath.setAttribute('d', areaD);

  points.innerHTML = '';
  history.forEach((v, i) => {
    if (v == null) return;
    const x = xFor(i), y = yFor(v);
    const isLast = i === lastRealIdx;
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', isLast ? 3 : 1.4);
    c.setAttribute('fill', 'var(--accent)');
    c.setAttribute('opacity', isLast ? 1 : 0.5);
    if (isLast) { c.setAttribute('stroke', 'var(--surface)'); c.setAttribute('stroke-width', 1.5); }
    points.appendChild(c);
  });
}

// ── Goal storage (unchanged — reads window.CP → localStorage) ──────────
export function _wgKey() { return window.CU ? 'wg_' + window.CU.id : null; }
export function getWeightGoal() {
  if (window.CP?.weight_goal) return parseFloat(window.CP.weight_goal);
  try {
    const k = _wgKey(); if (!k) return null;
    const v = localStorage.getItem(k);
    return v ? parseFloat(v) : null;
  } catch (e) { return null; }
}
export async function saveWeightGoal(gv) {
  if (window.CP) CP.weight_goal = gv;
  try { const k = _wgKey(); if (k) { if (gv) localStorage.setItem(k, String(gv)); else localStorage.removeItem(k); } } catch {}
  if (window.CU) {
    const { error } = await sb.from('profiles').update({ weight_goal: gv || null }).eq('id', window.CU.id);
    if (error) console.error('[saveWeightGoal] DB 저장 실패:', error);
  }
}

// ── Modal open ─────────────────────────────────────────────────────────
// mode:
//   'weight' — today's weight only (default from 수정 button)
//   'goal'   — target weight only (from 목표 설정 button)
//   'both'   — both fields (first-time / empty state)
export function openWeightModal(mode) {
  // First-time users: no weight AND no goal → show both fields so the
  // modal doubles as onboarding.
  if (!mode) {
    const hasWeight = window.log?.weight != null;
    const hasGoal = !!getWeightGoal();
    mode = hasWeight || hasGoal ? 'weight' : 'both';
  }
  // Auto-expand the card so user sees the result after save
  const wtCard = document.getElementById('wt-card');
  if (wtCard && !wtCard.classList.contains('expanded')) {
    // Collapse any other accordion so we don't leave two cards open.
    document.querySelectorAll('.s-card.accordion').forEach(c => {
      if (c !== wtCard) c.classList.remove('expanded');
    });
    wtCard.classList.add('expanded');
  }
  // Title + field visibility per mode
  const title = document.getElementById('wt-modal-title');
  const weightField = document.querySelector('[data-wt-field="weight"]');
  const goalField = document.querySelector('[data-wt-field="goal"]');
  if (title) {
    title.textContent = mode === 'goal' ? '목표 체중 설정'
                      : mode === 'weight' ? '공복 체중 기록'
                      : '체중 & 목표 설정';
  }
  if (weightField) weightField.style.display = mode === 'goal' ? 'none' : '';
  if (goalField) goalField.style.display = mode === 'weight' ? 'none' : '';
  // Target label hint shows "필수" in goal-only mode since it's the sole required field
  const goalLabelHint = document.getElementById('wt-goal-label-hint');
  if (goalLabelHint) {
    if (mode === 'goal') {
      goalLabelHint.textContent = '';
    } else {
      goalLabelHint.textContent = '선택사항';
      goalLabelHint.style.color = 'var(--text3)';
    }
  }

  const inp = document.getElementById('wt-inp');
  const gi = document.getElementById('wt-goal-inp');
  if (inp) inp.value = window.log?.weight != null ? parseFloat(window.log.weight).toFixed(1) : '';
  const currentGoal = getWeightGoal();
  if (gi) gi.value = currentGoal ? currentGoal.toFixed(1) : '';
  try { _pkBindAll(document.getElementById('weight-modal')); _pkSync('wt-inp'); _pkSync('wt-goal-inp'); } catch (e) {}
  const hint = document.getElementById('wt-yesterday-hint');
  if (hint) {
    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    const yk = dkey(yest);
    const yl = window.logCache[yk];
    const yWeight = yl?.weight != null ? parseFloat(yl.weight) : null;
    if (yWeight != null) {
      const todayW = window.log?.weight != null ? parseFloat(window.log.weight) : null;
      let diffStr = '';
      if (todayW != null) {
        const diff = todayW - yWeight;
        const sign = diff > 0 ? '+' : '';
        const col = diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--green)' : 'var(--text3)';
        diffStr = ` <span style="font-weight:600;color:${col};">${sign}${diff.toFixed(1)}kg</span>`;
      }
      hint.style.display = 'flex';
      hint.innerHTML = `<span style="color:var(--text3);">어제</span><span style="color:var(--text);font-weight:600;">${yWeight.toFixed(1)}kg</span>${diffStr}`;
    } else {
      hint.style.display = 'none';
    }
  }
  openModal('weight-modal');
}

// ── Inbody helpers (unchanged) ────────────────────────────────────────
export function calcBodyFat() {
  const hasM = document.getElementById('wt-muscle')?.value.trim();
  const hasP = document.getElementById('wt-fatpct')?.value.trim();
  if (hasM) calcBodyFatFromMuscle();
  else if (hasP) calcBodyFatFromPct();
}
export function calcBodyFatFromMuscle() {
  const w = parseFloat(document.getElementById('wt-inp')?.value);
  const m = parseFloat(document.getElementById('wt-muscle')?.value);
  if (isNaN(w) || isNaN(m) || w <= 0 || m <= 0) return;
  const leanMass = m / 0.45;
  const fatMass = Math.max(0, w - leanMass);
  const fatPct = Math.round((fatMass / w) * 1000) / 10;
  const inp = document.getElementById('wt-fatpct');
  if (inp && inp.value.trim() === '') {
    inp.value = fatPct.toFixed(1);
    showCalcResult(`골격근량 ${m}kg → 체지방률 자동계산: ${fatPct.toFixed(1)}%`);
  }
}
export function calcBodyFatFromPct() {
  const w = parseFloat(document.getElementById('wt-inp')?.value);
  const pct = parseFloat(document.getElementById('wt-fatpct')?.value);
  if (isNaN(w) || isNaN(pct) || w <= 0 || pct <= 0) return;
  const fatMass = w * (pct / 100);
  const leanMass = w - fatMass;
  const muscleMass = Math.round(leanMass * 0.45 * 10) / 10;
  const inp = document.getElementById('wt-muscle');
  if (inp && inp.value.trim() === '') {
    inp.value = muscleMass.toFixed(1);
    showCalcResult(`체지방률 ${pct}% → 골격근량 자동계산: ${muscleMass.toFixed(1)}kg`);
  }
}
export function showCalcResult(msg) {
  const el = document.getElementById('wt-calc-result');
  const txt = document.getElementById('wt-calc-text');
  if (el && txt) { el.style.display = 'block'; txt.textContent = '🤖 ' + msg; }
}

// ── Save ──────────────────────────────────────────────────────────────
export async function saveWeight() {
  // Goal-only mode: 체중 필드가 숨겨진 상태일 땐 목표만 저장하고 조기 반환.
  const weightField = document.querySelector('[data-wt-field="weight"]');
  const goalOnly = weightField && weightField.style.display === 'none';

  const gi = document.getElementById('wt-goal-inp');
  if (goalOnly) {
    if (gi && gi.value.trim() !== '') {
      const gv = parseFloat(gi.value);
      if (!isNaN(gv) && gv > 0) {
        await saveWeightGoal(gv);
        showToast('🎯 목표 체중 저장됨');
      } else {
        showToast('목표 체중을 입력해주세요'); return;
      }
    } else {
      await saveWeightGoal(null);
      showToast('목표 체중 해제됨');
    }
    closeModal('weight-modal');
    renderWeight();
    return;
  }

  const v = parseFloat(document.getElementById('wt-inp').value);
  if (isNaN(v) || v <= 0) { showToast('체중을 입력해주세요'); return; }
  if (gi && gi.value.trim() !== '') {
    const gv = parseFloat(gi.value);
    if (!isNaN(gv) && gv > 0) await saveWeightGoal(gv);
  } else if (gi && gi.value.trim() === '') {
    await saveWeightGoal(null);
  }
  const prev = window.log.weight;
  window.log.weight = v;
  closeModal('weight-modal');

  renderWeight();
  const todayPtsLog = (window.logCache[window.selectedKey] || log)._ptsLog || [];
  const alreadyRecorded = todayPtsLog.some(e => e.type === 'weight_record');
  if (!alreadyRecorded) { setTimeout(() => showWin('weight', SCORE_EVENTS.weight_record.pts, '체중 기록 성공!'), 200); addScore('weight_record'); }
  const alreadyLoss = todayPtsLog.some(e => e.type === 'weight_loss');
  if (!alreadyLoss && prev !== null && prev !== undefined && v < prev) { addScore('weight_loss'); setTimeout(() => showWin('weight_loss', SCORE_EVENTS.weight_loss.pts, '감량 성공!'), 500); }
  const goal = getWeightGoal();
  if (goal && v <= goal && (prev === null || prev > goal)) { addScore('weight_goal'); setTimeout(() => showWin('weight_goal', SCORE_EVENTS.weight_goal.pts, '목표 체중 달성!'), 800); }
  saveNow();
}
