// Stay Hard · weight feature
//
// Renders weight card + weight modal. Saves weight value, handles weight
// goal, triggers weight-related score events (record / loss / goal met).
//
// State: reads/writes window.log, window.logCache, window.CP via proxies
// set up by index.html inline script (see declarations near line ~4680).

import { sb } from '../../lib/supabase.js';
import { SCORE_EVENTS } from '../../data/score-events.js';
import { showToast } from '../../ui/toast.js';

export function toggleWeightInfo(){
  const panel=document.getElementById('wt-info-panel');
  if(panel)panel.style.display=panel.style.display==='none'?'block':'none';
}

export function renderWeight(){
  // 첫 주 미션 재평가 — 체중 기록 즉시 반영
  try{if(typeof renderFirstWeekCard==='function')renderFirstWeekCard();}catch(e){}
  const emptyState=document.getElementById('wt-empty-state');
  const filledState=document.getElementById('wt-filled-state');
  const hasWeight=window.log.weight!==null&&window.log.weight!==undefined;
  if(emptyState)emptyState.style.display=hasWeight?'none':'block';
  if(filledState)filledState.style.display=hasWeight?'block':'none';

  const goal=getWeightGoal();

  // 미입력 상태 — 목표 있으면 미리보기
  const ge=document.getElementById('wt-goal-empty');
  if(ge){
    ge.style.display=goal?'block':'none';
    if(goal)ge.textContent='🎯 목표 체중 '+goal.toFixed(1)+'kg 설정됨';
  }

  if(!hasWeight){
    const wd=document.getElementById('wt-display');
    if(wd){wd.textContent='—';}
    return;
  }

  const w=parseFloat(window.log.weight);

  // 체중 숫자
  const wd=document.getElementById('wt-display');
  const wu=document.getElementById('wt-unit');
  if(wd){wd.textContent=w.toFixed(1);}
  if(wu)wu.style.display='inline';

  // 인바디 표시
  const inbodyRow=document.getElementById('wt-inbody-row');
  if(inbodyRow){
    const m=window.log.muscle_mass;
    const f=window.log.body_fat_pct;
    if(m||f){
      const parts=[];
      if(m) parts.push('💪 골격근 '+parseFloat(m).toFixed(1)+'kg');
      if(f) parts.push('🔥 체지방 '+parseFloat(f).toFixed(1)+'%');
      inbodyRow.textContent=parts.join('  ·  ');
      inbodyRow.style.display='block';
    } else {
      inbodyRow.style.display='none';
    }
  }

  // 어제 대비
  const yesterday=new Date(selectedDate);yesterday.setDate(yesterday.getDate()-1);
  const yKey=dkey(yesterday);
  const yLog=window.logCache[yKey];
  const yWeight=yLog?.weight!=null?parseFloat(yLog.weight):null;
  const vs=document.getElementById('wt-vs-yesterday');
  if(vs){
    if(yWeight!=null){
      const diff=w-yWeight;
      if(Math.abs(diff)<0.05){
        vs.style.display='inline-block';
        vs.textContent='→ 어제와 동일';
        vs.style.background='var(--surface3)';vs.style.color='var(--text3)';vs.style.border='1px solid var(--border2)';
      } else if(diff<0){
        vs.style.display='inline-block';
        vs.textContent='▼ 어제보다 '+Math.abs(diff).toFixed(1)+'kg';
        vs.style.background='var(--green-bg)';vs.style.color='var(--green)';vs.style.border='1px solid var(--green-bd)';
      } else {
        vs.style.display='inline-block';
        vs.textContent='▲ 어제보다 +'+diff.toFixed(1)+'kg';
        vs.style.background='var(--red-bg)';vs.style.color='var(--red)';vs.style.border='1px solid var(--red-bd)';
      }
    } else {vs.style.display='none';}
  }

  // 목표 없으면 오른쪽 블록 / 진행바 숨김
  const remainBlock=document.getElementById('wt-remain-block');
  const progressBlock=document.getElementById('wt-progress-block');
  const achievedBanner=document.getElementById('wt-achieved-banner');

  if(!goal){
    if(remainBlock)remainBlock.style.display='none';
    if(progressBlock)progressBlock.style.display='none';
    return;
  }

  const remaining=w-goal;
  const achieved=remaining<=0;

  // 오른쪽 남은 kg
  if(remainBlock){
    if(achieved){
      remainBlock.style.display='none';
    } else {
      remainBlock.style.display='block';
      const rn=document.getElementById('wt-remain-num');
      if(rn)rn.textContent=remaining.toFixed(1);
    }
  }

  // 진행바
  if(progressBlock){
    progressBlock.style.display='block';

    // 시작 체중: window.logCache에서 가장 오래된 기록 or 현재보다 높은 값을 시작으로 추정
    // 진행바 기준: 목표 도달 시 100%
    // startWeight = weight_goal + (reasonable range) 로 추정, 없으면 현재+10
    const startWeight=Math.max(w, goal+(w-goal)*1); // 최초 저장 시점 없으므로 현재 기준
    // 더 나은 방식: 캐시에서 가장 높은 weight 찾기
    let maxW=w;
    Object.values(window.logCache||{}).forEach(l=>{if(l&&l.weight!=null)maxW=Math.max(maxW,parseFloat(l.weight));});
    const totalDrop=maxW-goal;
    const doneDrop=maxW-w;
    const pct=totalDrop>0?Math.min(100,Math.max(0,Math.round(doneDrop/totalDrop*100))):0;

    const fill=document.getElementById('wt-bar-fill');
    const pctEl=document.getElementById('wt-bar-pct');
    const rangeEl=document.getElementById('wt-bar-range');
    const startLbl=document.getElementById('wt-bar-start-lbl');
    const goalLbl=document.getElementById('wt-bar-goal-lbl');

    if(fill)fill.style.width=pct+'%';
    if(pctEl)pctEl.textContent=pct+'%';
    if(rangeEl)rangeEl.textContent=maxW.toFixed(1)+'kg → '+goal.toFixed(1)+'kg';
    if(startLbl)startLbl.textContent='시작 '+maxW.toFixed(1)+'kg';
    if(goalLbl)goalLbl.textContent='목표 '+goal.toFixed(1)+'kg';

    if(achievedBanner){
      achievedBanner.style.display=achieved?'flex':'none';
      if(achieved&&fill)fill.style.background='var(--green)';
      if(achieved&&pctEl){pctEl.textContent='100%';pctEl.style.color='var(--green)';}
    }
  }
}
// ── 목표 체중: localStorage KEY (유저별)
export function _wgKey(){return window.CU?'wg_'+window.CU.id:null;}

// 목표 체중 읽기 — window.CP → localStorage 순으로 fallback
export function getWeightGoal(){
  if(window.CP?.weight_goal) return parseFloat(window.CP.weight_goal);
  try{
    const k=_wgKey(); if(!k)return null;
    const v=localStorage.getItem(k);
    return v?parseFloat(v):null;
  }catch(e){return null;}
}

// 목표 체중 저장 — window.CP + localStorage + profiles DB (이중 저장)
export async function saveWeightGoal(gv){
  if(window.CP)CP.weight_goal=gv;
  // localStorage 백업 (즉시, 오프라인도 OK)
  try{const k=_wgKey();if(k){if(gv)localStorage.setItem(k,String(gv));else localStorage.removeItem(k);}}catch(e){}
  // profiles DB (비동기, 실패해도 localStorage가 백업)
  if(window.CU){
    const{error}=await sb.from('profiles').update({weight_goal:gv||null}).eq('id',window.CU.id);
    if(error) console.error('[saveWeightGoal] DB 저장 실패 (localStorage는 유지됨):', error);
    else console.log('[saveWeightGoal] DB 저장 성공:', gv);
  }
}

export function openWeightModal(){
  const inp=document.getElementById('wt-inp');
  const gi=document.getElementById('wt-goal-inp');
  if(inp)inp.value=window.log.weight!=null?parseFloat(window.log.weight).toFixed(1):'';
  const currentGoal=getWeightGoal();
  if(gi)gi.value=currentGoal?currentGoal.toFixed(1):'';
  try{_pkBindAll(document.getElementById('weight-modal'));_pkSync('wt-inp');_pkSync('wt-goal-inp');}catch(e){}
  // 전날 체중 힌트
  const hint=document.getElementById('wt-yesterday-hint');
  if(hint){
    const yest=new Date(now);yest.setDate(yest.getDate()-1);
    const yk=dkey(yest);
    const yl=window.logCache[yk];
    const yWeight=yl?.weight!=null?parseFloat(yl.weight):null;
    if(yWeight!=null){
      const todayW=window.log.weight!=null?parseFloat(window.log.weight):null;
      let diffStr='';
      if(todayW!=null){
        const diff=todayW-yWeight;
        const sign=diff>0?'+':'';
        const col=diff>0?'var(--red)':diff<0?'var(--green)':'var(--text3)';
        diffStr=` <span style="font-weight:600;color:${col};">${sign}${diff.toFixed(1)}kg</span>`;
      }
      hint.style.display='flex';
      hint.innerHTML=`<span style="color:var(--text3);">어제</span><span style="color:var(--text);font-weight:600;">${yWeight.toFixed(1)}kg</span>${diffStr}`;
    } else {
      hint.style.display='none';
    }
  }
  openModal('weight-modal');
}
// ── 인바디 자동계산 헬퍼 ──
export function calcBodyFat(){
  // 체중 변경 시 기존 자동계산값 유지 (재계산)
  const hasM=document.getElementById('wt-muscle')?.value.trim();
  const hasP=document.getElementById('wt-fatpct')?.value.trim();
  if(hasM) calcBodyFatFromMuscle();
  else if(hasP) calcBodyFatFromPct();
}
export function calcBodyFatFromMuscle(){
  // 골격근량 입력 → 체지방률 계산
  const w=parseFloat(document.getElementById('wt-inp')?.value);
  const m=parseFloat(document.getElementById('wt-muscle')?.value);
  if(isNaN(w)||isNaN(m)||w<=0||m<=0)return;
  // 체지방량 = 체중 - 제지방량, 제지방량 ≈ 골격근량 / 0.45 (근육이 제지방의 약 45%)
  const leanMass=m/0.45;
  const fatMass=Math.max(0,w-leanMass);
  const fatPct=Math.round((fatMass/w)*1000)/10;
  const inp=document.getElementById('wt-fatpct');
  if(inp&&inp.value.trim()===''){
    inp.value=fatPct.toFixed(1);
    showCalcResult(`골격근량 ${m}kg → 체지방률 자동계산: ${fatPct.toFixed(1)}%`);
  }
}
export function calcBodyFatFromPct(){
  // 체지방률 입력 → 골격근량 계산
  const w=parseFloat(document.getElementById('wt-inp')?.value);
  const pct=parseFloat(document.getElementById('wt-fatpct')?.value);
  if(isNaN(w)||isNaN(pct)||w<=0||pct<=0)return;
  const fatMass=w*(pct/100);
  const leanMass=w-fatMass;
  const muscleMass=Math.round(leanMass*0.45*10)/10;
  const inp=document.getElementById('wt-muscle');
  if(inp&&inp.value.trim()===''){
    inp.value=muscleMass.toFixed(1);
    showCalcResult(`체지방률 ${pct}% → 골격근량 자동계산: ${muscleMass.toFixed(1)}kg`);
  }
}
export function showCalcResult(msg){
  const el=document.getElementById('wt-calc-result');
  const txt=document.getElementById('wt-calc-text');
  if(el&&txt){el.style.display='block';txt.textContent='🤖 '+msg;}
}

export async function saveWeight(){
  const v=parseFloat(document.getElementById('wt-inp').value);
  if(isNaN(v)||v<=0){showToast('체중을 입력해주세요');return;}

  // 목표 체중 처리
  const gi=document.getElementById('wt-goal-inp');
  if(gi&&gi.value.trim()!==''){
    const gv=parseFloat(gi.value);
    if(!isNaN(gv)&&gv>0) await saveWeightGoal(gv);
  } else if(gi&&gi.value.trim()===''){
    await saveWeightGoal(null);
  }
  const prev=window.log.weight;
  window.log.weight=v;
  closeModal('weight-modal');

  renderWeight();
  // 1일 1회 weight_record 제한
  const todayPtsLog=(window.logCache[window.selectedKey]||log)._ptsLog||[];
  const alreadyRecorded=todayPtsLog.some(e=>e.type==='weight_record');
  if(!alreadyRecorded){setTimeout(()=>showWin('weight',SCORE_EVENTS.weight_record.pts,'체중 기록 성공!'),200);addScore('weight_record');}
  const alreadyLoss=todayPtsLog.some(e=>e.type==='weight_loss');
  if(!alreadyLoss&&prev!==null&&prev!==undefined&&v<prev){addScore('weight_loss');setTimeout(()=>showWin('weight_loss',SCORE_EVENTS.weight_loss.pts,'감량 성공!'),500);}
  const goal=getWeightGoal();
  if(goal&&v<=goal&&(prev===null||prev>goal)){addScore('weight_goal');setTimeout(()=>showWin('weight_goal',SCORE_EVENTS.weight_goal.pts,'목표 체중 달성!'),800);}
  saveNow();
}
