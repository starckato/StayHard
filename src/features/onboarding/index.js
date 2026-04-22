// Stay Hard · onboarding feature
// Migration phase: 3.2 — first-run 4-step modal that captures goal,
// target weight, routines, and workout frequency. Extracted verbatim from
// index.html inline block. Reaches out to window.* for state/functions
// still held in inline code (window.CU, window.CP, _pkBindAll, _pkSync, renderMandatory).

import { sb } from '../../lib/supabase.js';
import { track } from '../../lib/analytics.js';

export let obSelectedRoutines=[]; // [{name, scoreType}]

// 목표별 추천 루틴 — 현실적·점진적 bodyweight 중심. 광기(찬물샤워/새벽기상) 보다 매일 이기는 쪽.
export const OB_GOAL_ROUTINES={
  diet:[
    {name:'💧 물 2L 마시기', scoreType:null},
    {name:'🚶 30분 걷기', scoreType:null},
    {name:'⚖️ 공복 체중 측정', scoreType:null},
    {name:'🌙 저녁 9시 이후 금식', scoreType:null},
    {name:'💪 팔굽혀펴기 10개', scoreType:null},
  ],
  muscle:[
    {name:'💪 팔굽혀펴기 10개', scoreType:null},
    {name:'🦵 맨몸 스쿼트 50개', scoreType:null},
    {name:'🔥 헬스 (주 4회)', scoreType:null, days:[1,2,4,5]}, // Mon/Tue/Thu/Fri 기본
    {name:'🥩 단백질 1g/체중 챙기기', scoreType:null},
    {name:'💧 물 2L 마시기', scoreType:null},
  ],
  habit:[
    {name:'💪 팔굽혀펴기 10개', scoreType:null},
    {name:'🚶 30분 걷기', scoreType:null},
    {name:'💧 물 2L 마시기', scoreType:null},
    {name:'🔥 운동 (주 3회)', scoreType:null, days:[1,3,5]}, // 월/수/금 기본
    {name:'😴 11시 전 취침', scoreType:null},
  ],
};
export let _obGoal=null;
export let _obWorkoutFreq=null; // 주 운동 횟수 override (사용자 선택 시 셋됨)
export const WFREQ_DAYS={2:[1,4],3:[1,3,5],4:[1,2,4,5],5:[1,2,3,4,5]}; // 요일 기본 분포

export function obDismissForever(){
  document.getElementById('onboarding-modal').style.display='none';
  sb.from('profiles').update({onboarded:true}).eq('id',window.CU.id);
  if(window.CP)CP.onboarded=true;
  track('onboard_complete',{path:'dismiss_forever'});
}
export function obDismissWeek(){
  document.getElementById('onboarding-modal').style.display='none';
  const expires=Date.now()+(7*24*60*60*1000);
  try{localStorage.setItem('ob_hide_until_'+window.CU.id,expires);}catch(e){}
}
export function showOnboarding(name){
  const nameEl=document.getElementById('ob-name');
  const wrapEl=document.getElementById('ob-name-wrap');
  if(nameEl)nameEl.textContent=name||'';
  if(wrapEl)wrapEl.style.display=name?'inline':'none';
  obSelectedRoutines=[];
  _obGoal=null;
  ['ob-s1','ob-s2','ob-s3','ob-s4'].forEach((id,i)=>{
    const el=document.getElementById(id);if(el)el.style.display=i===0?'block':'none';
  });
  document.getElementById('onboarding-modal').style.display='flex';
  try{window._pkBindAll(document.getElementById('onboarding-modal'));window._pkSync('ob-weight-inp');}catch(e){}
  try{track('onboard_step_view',{step:1});}catch(e){}
}
export function obNext(step){
  ['ob-s1','ob-s2','ob-s3','ob-s4'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  const target=document.getElementById('ob-s'+step);
  if(target)target.style.display='block';
  if(step===3)obBuildRoutineChips();
  try{track('onboard_step_view',{step});}catch(e){}
}
export function obSelectGoal(goal){
  _obGoal=goal;
  // 선택 강조
  ['diet','muscle','habit'].forEach(g=>{
    const el=document.getElementById('ob-goal-'+g);
    if(el){
      el.style.borderColor=g===goal?'var(--accent)':'var(--border)';
      el.style.background=g===goal?'rgba(255,77,77,.10)':'var(--surface2)';
    }
  });
  // 다음 버튼 활성화
  const btn=document.getElementById('ob-goal-next');
  if(btn){btn.style.opacity='1';btn.style.pointerEvents='auto';}
  // profile 에 즉시 저장 — Status Band 등 다른 surface 에서 goal 기반 copy 사용 가능
  try{
    if(window.CU&&window.CU.id){
      sb.from('profiles').update({goal}).eq('id',window.CU.id).then(()=>{if(window.CP)CP.goal=goal;},(e)=>console.warn('[goal save]',e));
    }
  }catch(e){}
  try{track('onboard_goal_select',{goal});}catch(e){}
}
export function obBuildRoutineChips(){
  obSelectedRoutines=[];
  const routines=_obGoal?OB_GOAL_ROUTINES[_obGoal]:OB_GOAL_ROUTINES.habit;
  // 아이콘/타이틀 업데이트
  const icons={diet:'⚖️',muscle:'💪',habit:'🔥'};
  const titles={diet:'다이어트 추천 루틴',muscle:'근성장 추천 루틴',habit:'습관 형성 추천 루틴'};
  const descs={diet:'목표 체중을 설정하고 루틴을 골라보세요',muscle:'근성장을 위한 루틴을 골라보세요',habit:'매일 반복할 루틴을 골라보세요'};
  if(_obGoal){
    document.getElementById('ob-s3-icon').textContent=icons[_obGoal]||'✅';
    document.getElementById('ob-s3-title').textContent=titles[_obGoal]||'추천 루틴';
    document.getElementById('ob-s3-desc').textContent=descs[_obGoal]||'탭해서 추가할 루틴을 선택하세요';
  }
  // 다이어트면 목표 체중 입력 표시
  const wtSec=document.getElementById('ob-weight-section');
  if(wtSec)wtSec.style.display=_obGoal==='diet'||_obGoal==='muscle'?'block':'none';
  // muscle/habit 은 주 운동 빈도 선택기 노출 — default 를 고른 상태로 초기화
  const wfSec=document.getElementById('ob-wfreq-section');
  if(wfSec){
    const needWfreq=(_obGoal==='muscle'||_obGoal==='habit');
    wfSec.style.display=needWfreq?'block':'none';
    if(needWfreq){
      const def=_obGoal==='muscle'?4:3;
      _obWorkoutFreq=def;
      setTimeout(()=>obSelectWfreq(def,true),0);
    } else {
      _obWorkoutFreq=null;
    }
  }
  // 루틴 칩 생성 — index 를 토글러에 넘겨 OB_GOAL_ROUTINES 에서 원본(days 포함) 룩업
  document.getElementById('ob-routine-chips').innerHTML=routines.map((r,i)=>
    `<div onclick="obToggleRoutine(this,${i})" style="padding:8px 14px;border-radius:20px;border:1.5px solid var(--border2);background:var(--surface2);font-size:13px;cursor:pointer;color:var(--text2);touch-action:manipulation;">${r.name}</div>`
  ).join('');
  document.getElementById('ob-selected-routines').innerHTML='';
}
export function obSelectWfreq(n,silent){
  _obWorkoutFreq=n;
  document.querySelectorAll('.ob-wfreq-btn').forEach(btn=>{
    const f=parseInt(btn.getAttribute('data-freq'),10);
    const on=f===n;
    btn.style.background=on?'var(--accent)':'var(--surface)';
    btn.style.color=on?'#fff':'var(--text2)';
    btn.style.borderColor=on?'var(--accent)':'var(--border2)';
  });
  // obSelectedRoutines 안의 '운동'/'헬스' 항목 있으면 days 업데이트
  const newDays=(WFREQ_DAYS[n]||WFREQ_DAYS[3]).slice();
  obSelectedRoutines.forEach(r=>{
    if(/운동|헬스/.test(r.name||''))r.days=newDays.slice();
  });
  if(!silent){try{track('onboard_wfreq_select',{freq:n,goal:_obGoal});}catch(e){}}
}
export function obToggleRoutine(el,idx){
  const source=_obGoal?OB_GOAL_ROUTINES[_obGoal]:OB_GOAL_ROUTINES.habit;
  const r=source[idx];if(!r)return;
  const existingIdx=obSelectedRoutines.findIndex(x=>x.name===r.name);
  if(existingIdx>=0){
    obSelectedRoutines.splice(existingIdx,1);
    el.style.background='var(--surface2)';el.style.color='var(--text2)';el.style.borderColor='var(--border2)';
  } else {
    // 운동/헬스 루틴은 유저가 고른 주 빈도 반영 (WFREQ_DAYS)
    let days=Array.isArray(r.days)?r.days.slice():null;
    if(/운동|헬스/.test(r.name||'')&&_obWorkoutFreq&&WFREQ_DAYS[_obWorkoutFreq]){
      days=WFREQ_DAYS[_obWorkoutFreq].slice();
    }
    obSelectedRoutines.push({name:r.name,scoreType:r.scoreType||null,days});
    el.style.background='var(--accent)';el.style.color='#fff';el.style.borderColor='var(--accent)';
  }
  document.getElementById('ob-selected-routines').innerHTML=obSelectedRoutines.length>0
    ?`<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">선택된 루틴 ${obSelectedRoutines.length}개</div>`
    +obSelectedRoutines.map(r=>`<div style="font-size:13px;color:var(--text2);padding:3px 0;">✓ ${r.name}</div>`).join(''):'';
}
export async function obFinish(){
  document.getElementById('onboarding-modal').style.display='none';
  // 목표 체중 저장
  const wtInp=document.getElementById('ob-weight-inp');
  const wtVal=wtInp?parseFloat(wtInp.value):null;
  if(wtVal&&!isNaN(wtVal)){
    await saveWeightGoal(wtVal);
  }
  // 선택된 루틴 — 기존 루틴에 추가 (덮어쓰기 금지). days 지정 없으면 매일.
  if(obSelectedRoutines.length>0){
    const existing=log.mandatory||[];
    const existingNames=new Set(existing.map(r=>r.name));
    const newRoutines=obSelectedRoutines
      .filter(r=>!existingNames.has(r.name)) // 중복 제거
      .map(r=>({
        name:r.name,done:false,
        days:Array.isArray(r.days)&&r.days.length?r.days:[0,1,2,3,4,5,6],
        ...(r.scoreType?{_scoreType:r.scoreType}:{})
      }));
    if(newRoutines.length>0){
      log.mandatory=[...existing,...newRoutines];
      propagateMandatoryDefs(log.mandatory);
      window.renderMandatory();
    }
  }
  // 온보딩 완료 + goal 최종 저장
  const profileUpdate={onboarded:true};
  if(_obGoal)profileUpdate.goal=_obGoal;
  await sb.from('profiles').update(profileUpdate).eq('id',window.CU.id);
  if(window.CP){window.CP.onboarded=true;if(_obGoal)window.CP.goal=_obGoal;}
  // 첫 출발 보너스 +10pt — 첫 화면 점수 0 대신 10 으로 시작
  try{
    addScore('onboarding_bonus','온보딩 완료');
    setTimeout(()=>{try{showWin('bonus',10,'환영 🎉');}catch(e){}},300);
  }catch(e){console.warn('[ob] welcome bonus',e);}
  track('onboard_complete',{path:'full',goal:_obGoal,routines:obSelectedRoutines?.length||0});
  queueSave();
}


// ═══════════════════════════════════════════════
// MICRO-INTERACTION ENGINE
// ═══════════════════════════════════════════════
