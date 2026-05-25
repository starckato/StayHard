// 큐록 · features/mountain — 챌린지 룸 산 leaderboard 렌더.
//
// Entry: renderMountain(sortedProfiles, memberWeightMaps, memberWgoals, chStart, chEnd, dayNum, currentUserId)
//   - sortedProfiles : profiles 배열 (본인 우선 정렬)
//   - memberWeightMaps : { [user_id]: { dateStr: kg } }
//   - memberWgoals : { [user_id]: goal_kg }
//   - chStart / chEnd : 챌린지 시작/종료일 (ISO yyyy-mm-dd)
//   - dayNum : 현재 경과일수
//   - currentUserId : 본인 user_id (highlight 용)
//
// Production v1 (2026-05-25): prototype `ch-D-mountain-climb.html` v9 패턴.
//   포함: SVG 산, 4 체크포인트 (캠프1/2/3/정상), 멤버별 progress %,
//   aura 단계 (lv-0~4), 캐릭터 색, 깃발 자국, First ★, 정상 깃발.
//   생략 (v2 후속): 클릭 인터랙션, history popup, broadcast, demo 트리거.

const MT_COLORS = ['#ff4d4d', '#ffd54a', '#38bdf8', '#ec4899', '#a855f7', '#f97316'];

// SVG 산 polygon (200, 80) = 정상. y∈[80,300] 좌측 / [80,260] 우측 슬로프.
// 각 climber 의 feet y 에서 mountain x 범위 계산해 그 안에 배치.
function _mtXRangeAt(y) {
  // 좌측 edge
  let xLeft;
  if (y < 80) xLeft = 200; // 정상 위 (이론상 없음)
  else if (y < 300) xLeft = 100 + (300 - y) / 2.2;
  else if (y < 400) xLeft = 400 - y;
  else xLeft = 0;
  // 우측 edge
  let xRight;
  if (y < 80) xRight = 200;
  else if (y < 260) xRight = 200 + (y - 80) / 1.8;
  else if (y < 360) xRight = 300 + (y - 260);
  else xRight = 400;
  return { xLeft, xRight };
}

// 멤버 progress % 계산 — index.html bullet bar 로직 (lines 13146-13158) 미러.
function _calcProgressPct(startW, curW, goal) {
  if (startW == null || curW == null || goal == null) return null;
  const diff = goal - startW;
  const dir = diff < -0.1 ? 'down' : diff > 0.1 ? 'up' : 'flat';
  if (dir === 'flat') {
    const drift = Math.abs(curW - startW);
    return Math.max(0, Math.min(100, Math.round(100 - drift * 50)));
  }
  const totalNeeded = Math.abs(startW - goal);
  const achieved = (dir === 'down') ? (startW - curW) : (curW - startW);
  return totalNeeded > 0 ? Math.max(0, Math.round(achieved / totalNeeded * 100)) : 100;
}

// progress % → aura level
function _levelFromPct(pct) {
  if (pct == null) return 0;
  if (pct >= 100) return 4;
  if (pct >= 75)  return 3;
  if (pct >= 50)  return 2;
  if (pct >= 25)  return 1;
  return 0;
}

// 4가지 climber 포즈 (만세 / 등반우 / 등반좌 / 지침 / 주저앉음)
const _POSES = {
  victory: 'M8 6.5 L8 13 M8 7.5 L3 3 M8 7.5 L13 3 M8 13 L4 21 M8 13 L12 21',
  climbR:  'M8 6.5 L8 13 M8 7.5 L13 3 M8 9 L3 13 M8 13 L11 21 M8 13 L4 19',
  climbL:  'M8 6.5 L8 13 M8 7.5 L3 3 M8 9 L13 13 M8 13 L5 21 M8 13 L12 19',
  tired:   { head: { cx: 9, cy: 5 }, path: 'M9 7.5 L7 14 M8 9 L4 13 M8 9 L11 13 M7 14 L4 21 M7 14 L10 21' },
  sit:     { head: { cx: 8, cy: 8 }, path: 'M8 10.5 L8 14 M8 11 L5 13 M8 11 L11 13 M8 14 L4 17 L4 21 M8 14 L12 17 L12 21' },
};

function _poseFor(level, isLeader) {
  if (level === 4 || isLeader) return _POSES.victory;
  if (level >= 2) return _POSES.climbR;
  if (level === 1) return _POSES.climbL;
  return _POSES.sit;
}

function _poseHead(pose) {
  if (typeof pose === 'object') return pose.head;
  return { cx: 8, cy: 4 };
}
function _posePath(pose) {
  if (typeof pose === 'object') return pose.path;
  return pose;
}

// climber 한 명 HTML
function _renderClimber(opts) {
  const {
    name, pct, level, colorIdx, isLeader, isMe, isOut,
    top, left, side, // side: 'name-left' or 'name-right'
  } = opts;
  const poseRaw = _poseFor(level, isLeader);
  const head = _poseHead(poseRaw);
  const path = _posePath(poseRaw);
  // aura element (level 별)
  let auraEls = '';
  if (level === 2) auraEls = '<div class="mt-aura-disc"></div>';
  else if (level === 3) auraEls = '<div class="mt-aura-flame"></div><div class="mt-aura-spark"></div>';
  else if (level === 4) auraEls = '<div class="mt-aura-beams"></div><div class="mt-aura-pulse"></div><div class="mt-aura-flame"></div>';

  const classes = [
    'mt-climber',
    `mt-c${colorIdx}`,
    `mt-lv-${level}`,
    side,
    isLeader ? 'is-leader' : '',
    isMe ? 'is-me' : '',
    isOut ? 'is-out' : '',
  ].filter(Boolean).join(' ');

  const pctText = pct == null ? '—' : (pct >= 100 ? '🎉' : pct + '%');
  return `<div class="${classes}" style="top:${top}%; left:calc(${left}% - 7px);" data-name="${escapeHtml(name)}">
    ${auraEls}
    <div class="mt-pwrap">
      <svg class="mt-pfig" viewBox="0 0 16 22">
        <circle class="head" cx="${head.cx}" cy="${head.cy}" r="2.4"/>
        <path class="stroke" d="${path}"/>
      </svg>
    </div>
    <div class="mt-tag">
      <span class="nm">${escapeHtml(name)}${isMe ? ' (나)' : ''}</span>
      <span class="pct">${pctText}</span>
      <span class="lv-badge">lv${level}</span>
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// 정상 깃발 — 목표 라벨 (감량 −Xkg 등). chStart/chEnd 로 D-day 표시.
function _renderPeakFlag(goalLabel, dayLabel) {
  return `<div class="mt-peak-flag">
    <div class="pole"></div>
    <div class="banner"></div>
    <div class="info">
      <div class="info-num">${escapeHtml(goalLabel || '목표')}</div>
      <div class="info-day">${escapeHtml(dayLabel || '')}</div>
    </div>
  </div>`;
}

// 체크포인트 한 개
function _renderCheckpoint(cp, climbedColors, firstClimber) {
  const cpName = cp.name;
  const pct = cp.pct;
  const reward = cp.rewardHtml;
  const isPeak = cp.isPeak;
  const flagsHtml = climbedColors.map(c => `<span class="mt-cp-flag" style="--c:${c};"></span>`).join('');
  const firstHtml = firstClimber
    ? `<span class="star">★</span><span class="nm" style="color:${firstClimber.color};">${escapeHtml(firstClimber.name)}</span>`
    : `<span class="nm">아직 0명</span>`;
  return `<div class="mt-cp${isPeak ? ' is-peak' : ''}" style="top:${cp.top}%;">
    <div class="mt-cp-row">
      <span class="mt-cp-name">${escapeHtml(cpName)} ${reward}</span>
      <span class="mt-cp-pct">${escapeHtml(pct)}</span>
    </div>
    <div class="mt-cp-first">${firstHtml}</div>
    <div class="mt-cp-flags">${flagsHtml}</div>
  </div>`;
}

/**
 * 산 leaderboard 렌더 — `#gs-mountain-panel` 안에 마운트.
 */
export function renderMountain(sortedProfiles, memberWeightMaps, memberWgoals, chStart, chEnd, dayNum, currentUserId) {
  const panel = document.getElementById('gs-mountain-panel');
  if (!panel) return;
  if (!sortedProfiles || !sortedProfiles.length) {
    panel.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px;">멤버 데이터 없음</div>';
    return;
  }

  // 각 멤버 progress 계산 + 정렬 (높은 % 가 상단)
  const climbers = sortedProfiles.map((p, idx) => {
    const name = (p.display_name && p.display_name.trim()) ? p.display_name : (p.username || '유저');
    const isMe = p.id === currentUserId;
    const goal = memberWgoals && memberWgoals[p.id] != null ? parseFloat(memberWgoals[p.id]) : null;
    const wmap = (memberWeightMaps && memberWeightMaps[p.id]) || {};
    const wArr = Object.entries(wmap).sort((a, b) => a[0].localeCompare(b[0]));
    const startW = wArr.length > 0 ? wArr[0][1] : null;
    const curW = wArr.length > 0 ? wArr[wArr.length - 1][1] : null;
    const pct = _calcProgressPct(startW, curW, goal);
    const level = _levelFromPct(pct);
    return {
      profile: p, name, isMe, goal, startW, curW, pct, level,
      colorIdx: idx % MT_COLORS.length,
      color: MT_COLORS[idx % MT_COLORS.length],
    };
  });

  // 정렬: pct 큰 순. null 은 맨 아래.
  const ranked = [...climbers].sort((a, b) => {
    if (a.pct == null && b.pct == null) return 0;
    if (a.pct == null) return 1;
    if (b.pct == null) return -1;
    return b.pct - a.pct;
  });
  if (ranked.length > 0) ranked[0]._isLeader = true;

  // 각 climber 의 mountain 위 위치 계산.
  //   y_feet = 80 + (100 - pct) * 5.2  (정상 y=80, 베이스 y=600)
  //   top % = (y_feet - 20) / 600 * 100  (climber 높이 20px 빼서 feet 가 y_feet 에 닿게)
  //   x 는 mountain x-range 내 분산 slot 분배 (1위 가운데, 좌우 wide spread).
  //   같은 progress 그룹은 y 도 살짝 stagger 해서 겹치지 않게.

  // rank index 별 slot — % within mountain x-range (좌단 0 ~ 우단 1)
  // 좌우 wide spread 로 겹침 방지. side 도 strict alternate.
  const slotX    = [0.50, 0.80, 0.20, 0.92, 0.08, 0.65, 0.35, 0.85, 0.15];
  const slotSide = ['right', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'left'];

  const placed = ranked.map((c, i) => {
    const pctClamped = c.pct == null ? 0 : Math.max(0, Math.min(100, c.pct));
    let yFeet = 80 + (100 - pctClamped) * 5.2;

    // 비슷한 progress (5%p 이내) 인 이전 climber 마다 y 를 24px 씩 stagger.
    // tag height ~17px 라 24px 이상 stagger 해야 vertical 겹침 없음.
    let nudgePx = 0;
    for (let j = 0; j < i; j++) {
      if (ranked[j].pct != null && c.pct != null && Math.abs(ranked[j].pct - c.pct) < 5) {
        nudgePx += 24;
      }
    }
    yFeet += nudgePx;
    // mountain bottom 넘어가지 않게 clamp
    yFeet = Math.min(yFeet, 590);

    const top = (yFeet - 20) / 600 * 100;
    const range = _mtXRangeAt(yFeet);
    const rangeStartPct = range.xLeft / 400 * 100;
    const rangeEndPct   = range.xRight / 400 * 100;
    const rangeWidthPct = rangeEndPct - rangeStartPct;

    const slot = slotX[i % slotX.length];
    let left = rangeStartPct + rangeWidthPct * slot;
    // mountain x-range 안에 보장 (±1% 여유)
    left = Math.max(rangeStartPct + 1, Math.min(rangeEndPct - 1, left));

    const side = `name-${slotSide[i % slotSide.length]}`;
    return { ...c, top, left, side, rank: i };
  });

  // climber HTML
  const climbersHtml = placed.map(c => _renderClimber({
    name: c.name,
    pct: c.pct,
    level: c.level,
    colorIdx: c.colorIdx,
    isLeader: c._isLeader && c.level >= 1, // 0 인 사람은 leader 표시 안 함
    isMe: c.isMe,
    isOut: c.level === 0 && !c.isMe,
    top: c.top,
    left: c.left,
    side: c.side,
  })).join('');

  // 체크포인트
  const checkpoints = [
    { key: 'peak', name: '정상', pct: '100%', top: 13.3, isPeak: true, threshold: 100,
      rewardHtml: '<svg class="mt-trophy" viewBox="0 0 12 12"><path d="M3 1 L9 1 L9 4 C 9 6, 8 7, 6 7 C 4 7, 3 6, 3 4 Z M5 7 L7 7 L7 9 L5 9 Z M3 9 L9 9 L9 10.5 L3 10.5 Z"/></svg>' },
    { key: 'camp3', name: '캠프3', pct: '75%', top: 35, threshold: 75,
      rewardHtml: '<span class="mt-cube is-gold"></span><span class="mt-cube is-gold"></span>' },
    { key: 'camp2', name: '캠프2', pct: '50%', top: 56.7, threshold: 50,
      rewardHtml: '<span class="mt-cube is-gold"></span>' },
    { key: 'camp1', name: '캠프1', pct: '25%', top: 78.3, threshold: 25,
      rewardHtml: '<span class="mt-cube is-silver"></span>' },
  ];

  const cpHtml = checkpoints.map(cp => {
    // climbedColors = 이 체크포인트를 통과한 멤버 색깔들
    const climbed = placed.filter(c => c.pct != null && c.pct >= cp.threshold);
    const climbedColors = climbed.map(c => c.color);
    // first = 가장 진행률 높은 통과자 (대용 — 실제 timestamp 없으므로)
    const first = climbed.length > 0 ? climbed[0] : null;
    const firstClimber = first ? { name: first.name, color: first.color } : null;
    return _renderCheckpoint(cp, climbedColors, firstClimber);
  }).join('');

  // 정상 깃발 정보
  const meEntry = climbers.find(c => c.isMe);
  let goalLabel = '목표';
  if (meEntry && meEntry.goal != null && meEntry.startW != null) {
    const diff = meEntry.goal - meEntry.startW;
    const sign = diff < 0 ? '−' : (diff > 0 ? '+' : '');
    goalLabel = `${sign}${Math.abs(diff).toFixed(1)}kg`;
  }
  const dayLabel = dayNum != null ? `${dayNum}일차` : '';

  // 최종 HTML
  panel.innerHTML = `
    <div class="mt-wrap">
      <svg class="mt-svg" viewBox="0 0 400 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mt-mtn1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3a3a55" stop-opacity="0.5"/><stop offset="100%" stop-color="#1a1a25" stop-opacity="0.95"/></linearGradient>
          <linearGradient id="mt-mtn2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4a4a6a" stop-opacity="0.65"/><stop offset="100%" stop-color="#252535" stop-opacity="1"/></linearGradient>
          <linearGradient id="mt-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8e8f5"/><stop offset="100%" stop-color="#a8a8c8"/></linearGradient>
        </defs>
        <polygon points="0,600 0,260 80,180 160,240 240,160 320,220 400,180 400,600" fill="url(#mt-mtn1)"/>
        <polygon points="0,600 0,400 100,300 200,80 300,260 400,360 400,600" fill="url(#mt-mtn2)"/>
        <polygon points="170,140 200,80 230,140 215,135 200,100 185,135" fill="url(#mt-snow)" opacity="0.7"/>
        <path d="M 60,520 Q 100,440 140,400 T 180,300 T 200,80" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="2,4" fill="none"/>
      </svg>
      <div class="mt-zone mt-zone-peak"></div>
      <div class="mt-zone mt-zone-chase"></div>
      <div class="mt-zone mt-zone-stall"></div>
      <div class="mt-zone mt-zone-start"></div>
      <div class="mt-zone-label is-peak" style="top:21%;"><span class="nm">정상구간</span><span class="sub">마지막 사력</span></div>
      <div class="mt-zone-label" style="top:43%;"><span class="nm">추격구간</span><span class="sub">결정구간</span></div>
      <div class="mt-zone-label" style="top:64%;"><span class="nm">정체구간</span><span class="sub">지치기 쉽다</span></div>
      <div class="mt-zone-label" style="top:86%;"><span class="nm">출발구간</span><span class="sub">발걸음 시작</span></div>
      ${cpHtml}
      ${_renderPeakFlag(goalLabel, dayLabel)}
      ${climbersHtml}
    </div>
  `;
}
