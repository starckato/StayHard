// Stay Hard · stats feature
// Migration phase: 3.1 — extracted verbatim from index.html 2nd <script> block.
//
// Uses ESM imports for bundle-local things (sb, dkey, SCORE_EVENTS, etc.)
// and reaches out to window.* for state held in index.html inline scripts
// (window.logCache, window.CP, window.CU, window.selectedKey). Exports all st* functions; main.js
// assigns them onto window for inline-onclick compatibility.

import { sb } from '../../lib/supabase.js';
import { dkey } from '../../lib/date.js';
import { SCORE_EVENTS } from '../../data/score-events.js';
import { TIERS, getTier } from '../../lib/tier.js';

// ══════════════════════════════════════════════
// STATS / GRAPHS
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// STATS 탭 — 전체 구현
// ══════════════════════════════════════════════════════
export let statsPeriod=30;
export let stPeriod=7;  // stats 탭 전용 — 기본 1주
export let statsCharts={weight:null,vol:null,routine:null,score:null};
export let stCharts={weight:null,vol:null,routine:null,score:null};
export let _stData=null;  // 캐시

// ── 기존 weekly 탭 stats (하위 호환) ──
export function setStatsPeriod(days,btn){
  statsPeriod=days;
  document.querySelectorAll('.stats-period-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadAndRenderStats();
}

export async function loadAndRenderStats(){
  if(!window.CU)return;
  // noop — weekly 뷰에서 stats-section 제거됨
}

export function destroyChart(key){
  if(statsCharts[key]){statsCharts[key].destroy();statsCharts[key]=null;}
  if(stCharts[key]){stCharts[key].destroy();stCharts[key]=null;}
}

export function getChartColors(){
  return{grid:'rgba(255,255,255,0.05)',text:'#6b6b78',accent:'#ff4d4d',green:'#34d399',amber:'#f59e0b',red:'#ff4d4d',blue:'#38bdf8'};
}

// ── stats 탭 기간 선택 ──
export function stSetPeriod(days, btn){
  stPeriod=days;
  document.querySelectorAll('#st-period-btns .stats-period-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  if(_stData)stRenderAll(_stData);
  else loadStatsTab();
}

// ── stats 탭 데이터 로드 ──
export async function loadStatsTab(){
  if(!window.CU)return;

  // 로딩 표시
  const loadEl=document.getElementById('st-loading');
  if(loadEl)loadEl.style.display='block';
  // hero/empty 는 일시적으로 숨기고, sec-nav (분석 카테고리 탭) 는 유지.
  ['st-hero','st-empty'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });

  try{
    // 캐시가 있으면 재사용
    if(!_stData){
      const from=new Date(now);from.setDate(from.getDate()-364);
      const fromKey=dkey(from);
      const{data,error}=await sb.from('daily_logs')
        .select('log_date,weight,muscle_mass,body_fat_pct,water_cups,meals,workouts,mandatory,targets,points_log')
        .eq('user_id',window.CU.id)
        .gte('log_date',fromKey)
        .order('log_date',{ascending:true});

      if(error)throw error;
      _stData=(data||[]).map(d=>({...d,_key:normKey(d.log_date)}));
    }
  }catch(e){
    console.warn('[loadStatsTab] fetch error:', e.message);
    if(loadEl)loadEl.style.display='none';
    const emptyEl=document.getElementById('st-empty');
    if(emptyEl){emptyEl.style.display='block';emptyEl.innerHTML='<div style="font-size:40px;margin-bottom:12px;">⚠️</div><div style="font-size:14px;font-weight:600;color:var(--text2);margin-bottom:4px;">데이터를 불러올 수 없어요</div><div style="font-size:12px;color:var(--text3);">네트워크 상태를 확인해주세요</div>';}
    return;
  }

  if(loadEl)loadEl.style.display='none';

  if(!_stData||_stData.length===0){
    const emptyEl=document.getElementById('st-empty');
    if(emptyEl)emptyEl.style.display='block';
    return;
  }

  stRenderAll(_stData);
}

// ── 기간 필터 ──
export function stFilterRows(rows){
  if(!stPeriod)return rows;  // 0 = 전체
  const cutoff=new Date(now);cutoff.setDate(cutoff.getDate()-(stPeriod-1));
  const cutoffKey=dkey(cutoff);
  const filtered=rows.filter(r=>r._key>=cutoffKey);
  return filtered.length>0?filtered:rows;  // 해당 기간 데이터 없으면 전체 반환
}

// ── 메인 렌더 ──
export function stRenderAll(rows){
  if(!rows||!rows.length)return;
  const filtered=stFilterRows(rows);
  const hero=document.getElementById('st-hero');
  const nav=document.getElementById('st-sec-nav');
  const panels=['st-sec-overview','st-sec-training','st-sec-nutrition','st-sec-habits'];
  if(!filtered.length){
    document.getElementById('st-empty').style.display='block';
    if(hero)hero.style.display='none';
    if(nav)nav.style.display='none';
    panels.forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('hidden');});
    return;
  }
  document.getElementById('st-empty').style.display='none';
  // Hero stays retired; but the category pill nav needs to be explicitly
  // shown because stLoadStats used to hide it during loading.
  if(nav)nav.style.display='';

  try{stRenderHero(filtered);}catch(e){console.warn('stRenderHero error:',e);}
  try{stRenderKPI(filtered);}catch(e){console.warn('stRenderKPI error:',e);}
  try{stRenderInsights(filtered);}catch(e){console.warn('stRenderInsights error:',e);}
  try{stRenderScoreSources();}catch(e){console.warn('stRenderScoreSources error:',e);}
  try{stRenderReportCard(filtered);}catch(e){console.warn('stRenderReportCard error:',e);}
  // stRenderPtsBreakdown 은 이제 오늘의 요약 모달에서 담당 — 분석 탭에서 호출 X
  try{stRenderMealQuality(filtered);}catch(e){console.warn('stRenderMealQuality error:',e);}
  try{stRenderWeightChart(filtered);}catch(e){console.warn('stRenderWeightChart error:',e);}
  try{stRenderVolChart(filtered);}catch(e){console.warn('stRenderVolChart error:',e);}
  try{stRenderExerciseList(filtered);}catch(e){console.warn('stRenderExerciseList error:',e);}
  try{stRenderMuscleDist(filtered);}catch(e){console.warn('stRenderMuscleDist error:',e);}
  try{stRenderPRDashboard(filtered);}catch(e){console.warn('stRenderPRDashboard error:',e);}
  try{stRenderRoutineChart(filtered);}catch(e){console.warn('stRenderRoutineChart error:',e);}
  try{stRenderBodyComp(filtered);}catch(e){console.warn('stRenderBodyComp error:',e);}
  try{stRenderRoutineBreakdown(filtered);}catch(e){console.warn('stRenderRoutineBreakdown error:',e);}
  try{stRenderMealHeatmap(filtered);}catch(e){console.warn('stRenderMealHeatmap error:',e);}
  try{stRenderScoreChart(filtered);}catch(e){console.warn('stRenderScoreChart error:',e);}

  // Apply stored active section (default: 체중). 옛 'overview' 저장값은
  // 새 탭 구조의 루틴 탭과 의미가 달라서 habits 로 리셋.
  let saved=localStorage.getItem('stats_section')||'habits';
  if(!['habits','training','nutrition','overview'].includes(saved))saved='habits';
  statsSetSection(saved, true);
}

// ── 섹션 전환 ──
// 분석 탭은 체중 / 운동 / 식단 / 루틴 4개 카테고리로 필터링. 선택된
// 섹션만 보이고 나머지는 .hidden. Pill 하이라이트도 같이 스왑.
export function statsSetSection(key,skipSave){
  const valid=['overview','training','nutrition','habits'];
  if(!valid.includes(key))key='habits';
  if(!skipSave){try{localStorage.setItem('stats_section',key);}catch(e){}}
  document.querySelectorAll('#st-sec-nav .stats-sec-pill').forEach(b=>{
    b.classList.toggle('active',b.dataset.sec===key);
  });
  valid.forEach(k=>{
    const el=document.getElementById('st-sec-'+k);
    if(el)el.classList.toggle('hidden',k!==key);
  });
  // Resize charts in the newly-visible section so Chart.js doesn't paint at 0
  setTimeout(()=>{
    const chartMap={
      overview:['score','routine'],
      training:['vol','mealquality'],
      nutrition:['mealquality'],
      habits:['weight','bodycomp'],
    };
    (chartMap[key]||[]).forEach(k=>{if(stCharts[k]){try{stCharts[k].resize();}catch(_){}}});
  },40);
}

// Stats accordion toggle — independent (not exclusive) so users can
// compare multiple charts. Resize the embedded chart after the DOM
// settles so Chart.js doesn't draw at height:0.
export function toggleStatsCard(key){
  const card=document.querySelector('.stats-card.accordion[data-acc="'+key+'"]');
  if(!card)return;
  card.classList.toggle('expanded');
  if(card.classList.contains('expanded')){
    const map={
      score:'score',vol:'vol','meal-quality':'mealquality',
      weight:'weight',routine:'routine',bodycomp:'bodycomp',
    };
    const cKey=map[key];
    if(cKey){
      setTimeout(()=>{
        try{stCharts[cKey]&&stCharts[cKey].resize();}catch(_){}
      },120);
    }
  }
}

// ── 기간 종합 성적 계산 (히어로 + 성적표 카드 공통) ──
export function stCalcOverallGrade(rows){
  if(!rows||!rows.length)return{grade:'—',color:'var(--text3)',avgScore:null,sub:'데이터 없음'};
  const calcPct=(arr,fn)=>{let d=0,t=0;arr.forEach(r=>{const a=fn(r);t+=a.total;d+=a.done;});return t>0?Math.round(d/t*100):null;};
  const routinePct=calcPct(rows,r=>{const m=r.mandatory||[];return{total:m.length,done:m.filter(x=>x.done).length};});
  const targetPct=calcPct(rows,r=>{const t=r.targets||[];return{total:t.length,done:t.filter(x=>x.st==='done').length};});
  const mealRows=rows.flatMap(r=>(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type));
  const cleanPct=mealRows.length?Math.round(mealRows.filter(m=>m.type==='green').length/mealRows.length*100):null;
  let woCnt=0;rows.forEach(r=>{woCnt+=(r.workouts||[]).filter(w=>w.status==='done').length;});
  const woPerWeek=rows.length>=7?(woCnt/(rows.length/7)):woCnt;
  const g2s={A:4,B:3,C:2,D:1,F:0};
  const woGrade=woPerWeek>=3?'A':woPerWeek>=2?'B':woPerWeek>=1?'C':'D';
  const cleanG=cleanPct===null?null:(cleanPct>=70?'A':cleanPct>=50?'B':cleanPct>=30?'C':'D');
  const routG=routinePct===null?null:(routinePct>=90?'A':routinePct>=70?'B':routinePct>=50?'C':'D');
  const tgtG=targetPct===null?null:(targetPct>=80?'A':targetPct>=60?'B':targetPct>=40?'C':'D');
  const cats=[woGrade,cleanG,routG,tgtG].filter(Boolean);
  if(!cats.length)return{grade:'—',color:'var(--text3)',avgScore:null,sub:'데이터 없음'};
  const avgScore=Math.round(cats.reduce((a,g)=>a+g2s[g],0)/cats.length*25);
  const grade=avgScore>=90?'A':avgScore>=70?'B':avgScore>=50?'C':avgScore>=30?'D':'F';
  const color=avgScore>=90?'var(--green)':avgScore>=70?'var(--blue)':avgScore>=50?'var(--amber)':'var(--red)';
  return{grade,color,avgScore,sub:rows.length+'일 기준',woPerWeek,cleanPct,routinePct,targetPct};
}

// ── 약점 카테고리 → 다음 주 집중 포인트 문장 (Goggins voice) ──
// 입력: stCalcOverallGrade 결과 g, rows — 출력: {text, tag, borderColor} or null
export function _stFocusSentence(g, rows){
  if(!g||!rows||!rows.length)return null;
  if(g.grade==='—')return null;
  // 전체 A면 축하 + 유지 메시지
  if(g.grade==='A'){
    return {tag:'이번 주', text:'완벽에 가까워. 다음 주도 그대로 가.', borderColor:'rgba(52,211,153,.3)'};
  }
  // 카테고리 점수 맵 (stCalcOverallGrade에서 계산된 값 재사용)
  const scores={
    훈련:g.woPerWeek>=3?90:g.woPerWeek>=2?70:g.woPerWeek>=1?50:20,
    식단:g.cleanPct,
    루틴:g.routinePct,
    할일:g.targetPct
  };
  // 가장 낮은 점수 카테고리 선택 (null은 제외)
  let worst=null,worstScore=Infinity;
  Object.entries(scores).forEach(([k,v])=>{if(v!==null&&v!==undefined&&v<worstScore){worst=k;worstScore=v;}});
  if(!worst)return null;
  // 카테고리별 Goggins voice 템플릿
  const templates={
    훈련:[
      '훈련이 약해. 다음 주 1회만 더.',
      '체육관이 너를 기다린다. 주 3회부터.',
      '볼륨이 부족해. 몸에 기억시켜.'
    ],
    식단:[
      '클린식이 무너졌어. 한 끼만 클린으로 바꿔.',
      '입으로 들어가는 걸 통제해. 한 끼씩.',
      '식단이 약점이야. 아침 하나만 정리해.'
    ],
    루틴:[
      '루틴이 흔들려. 가장 작은 것부터 지켜.',
      '매일의 약속을 깨지 마. 하나라도.',
      '루틴을 줄이고 완주율을 올려.'
    ],
    할일:[
      '할일이 밀리고 있어. 목록을 3개로 줄여.',
      '끝내지 못할 할일은 쓰지 마.',
      '할일 완료율을 올려. 적게, 확실하게.'
    ]
  };
  const pool=templates[worst]||[];
  if(!pool.length)return null;
  // 기간 키로 안정적인 랜덤 (동일 주에는 같은 문장)
  const seed=(rows[0]?._key||'').split('-').join('')|0;
  const pick=pool[seed%pool.length];
  return {tag:'다음 주', text:pick, borderColor:'rgba(255,77,77,.22)'};
}

// ── 히어로 렌더 ──
export function stRenderHero(rows){
  try{
    const streak=(typeof calcStreak==='function')?calcStreak():0;
    document.getElementById('st-hero-streak').textContent=streak;
    const todayLog=(typeof window.logCache!=='undefined'&&typeof TODAY!=='undefined')?window.logCache[TODAY]:null;
    const todayPts=todayLog?(todayLog._ptsLog||[]).reduce((a,p)=>a+(p.pts||0),0):0;
    document.getElementById('st-hero-today').textContent=(todayPts>=0?'+':'')+todayPts;

    // Grade (period-based overall report) — replaces redundant 티어 셀
    const g=stCalcOverallGrade(rows);
    const gradeEl=document.getElementById('st-hero-grade');
    const gradeSub=document.getElementById('st-hero-grade-sub');
    if(gradeEl){gradeEl.textContent=g.grade;gradeEl.style.color=g.color;}
    if(gradeSub)gradeSub.textContent=g.sub;

    // Sprint D1: 약점 카테고리 → 한 줄 집중 포인트 (Goggins 톤)
    const focusEl=document.getElementById('st-hero-focus');
    const focusMsg=document.getElementById('st-hero-focus-msg');
    const focusTag=document.getElementById('st-hero-focus-tag');
    if(focusEl&&focusMsg){
      const msg=_stFocusSentence(g,rows);
      if(msg){
        focusMsg.textContent=msg.text;
        if(focusTag)focusTag.textContent=msg.tag;
        focusEl.style.display='flex';
        focusEl.style.borderColor=msg.borderColor||'rgba(255,77,77,.22)';
      } else {
        focusEl.style.display='none';
      }
    }

    // Tier progress bar below — cumulative profile tier (여전히 유용한 컨텍스트)
    const total=+(window.CP?.total_score)||0;
    if(typeof getTier==='function'){
      const t=getTier(total);
      const tiers=(typeof TIERS!=='undefined')?TIERS:null;
      const next=tiers?tiers.find(x=>x.min>total):null;
      const from=t.min||0, to=next?next.min:(t.max||(total+1));
      const pct=Math.max(0,Math.min(100,(total-from)/Math.max(1,to-from)*100));
      document.getElementById('st-hero-tier-fill').style.width=pct+'%';
      document.getElementById('st-hero-tier-from').textContent=(t.icon||'')+' '+(t.name||'')+' · '+total+'점';
      document.getElementById('st-hero-tier-to').textContent=next?('다음 '+next.name+' '+(next.min-total)+'pt'):'최고 티어';
    }
  }catch(e){console.warn('stRenderHero inner:',e);}
}

// ── KPI 카드 ──
export function stRenderKPI(rows){
  const c=getChartColors();

  // 루틴 완료율
  let mandDone=0,mandTotal=0;
  rows.forEach(r=>{
    const m=r.mandatory||[];
    mandTotal+=m.length;
    mandDone+=m.filter(x=>x.done).length;
  });
  const routinePct=mandTotal>0?Math.round(mandDone/mandTotal*100):0;
  document.getElementById('st-kpi-routine').textContent=routinePct+'%';
  document.getElementById('st-kpi-routine').style.color=routinePct>=80?'var(--green)':routinePct>=50?'var(--amber)':'var(--red)';
  document.getElementById('st-kpi-routine-sub').textContent=mandDone+'/'+mandTotal+'개 완료';

  // 할일 완료율
  let tgtDone=0,tgtTotal=0;
  rows.forEach(r=>{
    const t=r.targets||[];
    tgtTotal+=t.length;
    tgtDone+=t.filter(x=>x.st==='done').length;
  });
  const tgtPct=tgtTotal>0?Math.round(tgtDone/tgtTotal*100):0;
  document.getElementById('st-kpi-target').textContent=tgtPct+'%';
  document.getElementById('st-kpi-target').style.color=tgtPct>=70?'var(--green)':tgtPct>=40?'var(--amber)':'var(--red)';
  document.getElementById('st-kpi-target-sub').textContent=tgtDone+'/'+tgtTotal+'개 완료';

  // 클린식 비율
  let mealClean=0,mealAll=0;
  rows.forEach(r=>{
    const ms=(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type);
    mealAll+=ms.length;
    mealClean+=ms.filter(m=>m.type==='green').length;
  });
  const cleanPct=mealAll>0?Math.round(mealClean/mealAll*100):0;
  document.getElementById('st-kpi-clean').textContent=cleanPct+'%';
  document.getElementById('st-kpi-clean').style.color=cleanPct>=50?'var(--green)':cleanPct>=30?'var(--amber)':'var(--red)';
  document.getElementById('st-kpi-clean-sub').textContent=mealClean+'/'+mealAll+'끼 클린';

  // 운동 횟수
  let woCnt=0;
  rows.forEach(r=>{woCnt+=(r.workouts||[]).filter(w=>w.status==='done').length;});
  const periodDays=stPeriod||rows.length;
  const woPerWeek=(woCnt/(periodDays/7)).toFixed(1);
  document.getElementById('st-kpi-workout').textContent=woCnt+'회';
  document.getElementById('st-kpi-workout').style.color='var(--accent)';
  document.getElementById('st-kpi-workout-sub').textContent='주 평균 '+woPerWeek+'회';

  // 수분 섭취
  const waterGoal=+(window.CP?.water_goal)||8;
  let waterTotal=0,waterDays=0,waterGoalDays=0;
  rows.forEach(r=>{const w=r.water_cups||0;if(w>0){waterTotal+=w;waterDays++;if(w>=waterGoal)waterGoalDays++;}});
  const waterAvg=waterDays>0?(waterTotal/waterDays).toFixed(1):'0';
  const waterGoalPct=waterDays>0?Math.round(waterGoalDays/waterDays*100):0;
  document.getElementById('st-kpi-water').textContent=waterAvg+'잔';
  document.getElementById('st-kpi-water').style.color='var(--blue)';
  document.getElementById('st-kpi-water-sub').textContent='목표 달성 '+waterGoalPct+'% ('+waterGoalDays+'/'+waterDays+'일)';

  // ── 스파크라인 ──
  const routineDaily=rows.map(r=>{const m=r.mandatory||[];return m.length?Math.round(m.filter(x=>x.done).length/m.length*100):0;});
  const targetDaily=rows.map(r=>{const t=r.targets||[];return t.length?Math.round(t.filter(x=>x.st==='done').length/t.length*100):0;});
  const cleanDaily=rows.map(r=>{const ms=(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type);return ms.length?Math.round(ms.filter(m=>m.type==='green').length/ms.length*100):0;});
  const workoutDaily=rows.map(r=>(r.workouts||[]).filter(w=>w.status==='done').length);
  renderSparkline('st-spark-routine','spark_routine',routineDaily,'52,211,153');
  renderSparkline('st-spark-target','spark_target',targetDaily,'245,158,11');
  renderSparkline('st-spark-clean','spark_clean',cleanDaily,'52,211,153');
  renderSparkline('st-spark-workout','spark_workout',workoutDaily,'255,77,77');
  const waterDaily=rows.map(r=>r.water_cups||0);
  renderSparkline('st-spark-water','spark_water',waterDaily,'56,189,248');

  // ── Bento 2×2 (Phase 1) — 체중 / 운동 / 클린식 / 루틴 ──
  stRenderBento(rows,{mandDone,mandTotal,routinePct,mealClean,mealAll,cleanPct,woCnt});

  // ── Focus card (Phase 2) — 약점 탐지 + 구체 행동 제안 ──
  stRenderFocus(rows,{routinePct,cleanPct,woCnt});
}

// ── Focus card (Phase 2) ──────────────────────────────────────────────
// Rule-based weakness detection: checks several patterns and picks the
// single most actionable insight. Returns null when everything looks good
// OR when there isn't enough data to judge (avoid shouting at new users).
const DAY_KR = ['월','화','수','목','금','토','일'];

function _pickFocus(rows, ctx){
  if(!rows||rows.length<4)return null;

  // A · 전체 성적이 A면 응원 메시지 (부드러운 톤)
  if(ctx.routinePct>=85&&ctx.cleanPct>=70&&ctx.woCnt>=Math.max(3,Math.floor((stPeriod||rows.length)/7)*2)){
    return {
      tone:'good',
      kind:'유지',
      msg:'지금 페이스 그대로. 흔들리지만 않으면 돼.',
      evidence:[`루틴 ${ctx.routinePct}%`,`클린식 ${ctx.cleanPct}%`,`운동 ${ctx.woCnt}회`],
    };
  }

  // B · 주말 클린식 무너짐 (토/일 vs 월-금)
  const mealsByDay=rows.map(r=>{
    const ms=(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type);
    const clean=ms.filter(m=>m.type==='green').length;
    const d=new Date(r._key);
    return {dow:(d.getDay()+6)%7, total:ms.length, clean};
  }).filter(x=>x.total>0);
  if(mealsByDay.length>=6){
    const wkEnd=mealsByDay.filter(x=>x.dow>=5);
    const wkDay=mealsByDay.filter(x=>x.dow<5);
    const endClean=wkEnd.reduce((a,x)=>a+x.clean,0);
    const endTotal=wkEnd.reduce((a,x)=>a+x.total,0);
    const dayClean=wkDay.reduce((a,x)=>a+x.clean,0);
    const dayTotal=wkDay.reduce((a,x)=>a+x.total,0);
    if(endTotal>=4&&dayTotal>=4){
      const endPct=Math.round(endClean/endTotal*100);
      const dayPct=Math.round(dayClean/dayTotal*100);
      if(dayPct-endPct>=20&&endPct<60){
        return {
          tone:'warn',
          kind:'주말 약점',
          msg:`주말에 무너져. 토요일 저녁 한 끼만 클린으로 바꿔.`,
          evidence:[`평일 <b>${dayPct}%</b>`,`주말 <b>${endPct}%</b>`],
        };
      }
    }
  }

  // C · 루틴 요일 패턴 — 특정 요일 N주 연속 미완료
  const mandByDay={};
  rows.forEach(r=>{
    const d=new Date(r._key);
    const dow=(d.getDay()+6)%7;
    const items=(r.mandatory||[]).filter(m=>!m.days||m.days.includes(dow));
    if(!items.length)return;
    const done=items.filter(m=>m.done).length;
    const pct=items.length?done/items.length:1;
    if(!mandByDay[dow])mandByDay[dow]={n:0,sum:0};
    mandByDay[dow].n++;
    mandByDay[dow].sum+=pct;
  });
  let worstDow=null,worstAvg=1;
  Object.entries(mandByDay).forEach(([k,v])=>{
    if(v.n<2)return;
    const avg=v.sum/v.n;
    if(avg<worstAvg){worstAvg=avg;worstDow=+k;}
  });
  if(worstDow!=null&&worstAvg<0.5){
    return {
      tone:'warn',
      kind:'요일 약점',
      msg:`${DAY_KR[worstDow]}요일이 약점이야. 다음 주 ${DAY_KR[worstDow]} 아침 하나만 해내.`,
      evidence:[`${DAY_KR[worstDow]} 평균 <b>${Math.round(worstAvg*100)}%</b>`,`관찰 ${mandByDay[worstDow].n}회`],
    };
  }

  // D · 가장 낮은 카테고리 + 구체 권장
  const scores={
    훈련:ctx.woCnt>=6?90:ctx.woCnt>=4?70:ctx.woCnt>=2?50:20,
    식단:ctx.cleanPct,
    루틴:ctx.routinePct,
  };
  let worstCat=null,worstScore=Infinity;
  Object.entries(scores).forEach(([k,v])=>{if(v!=null&&v<worstScore){worstCat=k;worstScore=v;}});
  if(worstCat&&worstScore<60){
    const lines={
      훈련:`운동이 부족해. 다음 주 주 3회만 채워.`,
      식단:`클린식 ${ctx.cleanPct}%. 아침 한 끼만 단백질로 시작해.`,
      루틴:`루틴 ${ctx.routinePct}%. 매일 하는 하나만 지켜. 나머지는 버려.`,
    };
    return {
      tone:'warn',
      kind:worstCat+' 개선',
      msg:lines[worstCat],
      evidence:worstCat==='훈련'?[`이번 기간 ${ctx.woCnt}회`]:[`${worstCat} <b>${worstScore}%</b>`],
    };
  }

  // E · 기본: 모든 지표가 중간 이상 → 격려
  return {
    tone:'good',
    kind:'한 걸음 더',
    msg:'다 괜찮아. 그래도 가장 약한 거 하나 더 조여.',
    evidence:[`루틴 ${ctx.routinePct}%`,`클린식 ${ctx.cleanPct}%`,`운동 ${ctx.woCnt}회`],
  };
}

export function stRenderFocus(rows, ctx){
  const card=document.getElementById('st-focus-card');
  const tag=document.getElementById('st-focus-tag');
  const kind=document.getElementById('st-focus-kind');
  const msg=document.getElementById('st-focus-msg');
  const ev=document.getElementById('st-focus-evidence');
  if(!card)return;
  const focus=_pickFocus(rows||[],ctx||{});
  if(!focus){card.style.display='none';return;}
  card.style.display='block';
  card.className='stats-focus '+(focus.tone==='good'?'tone-good':focus.tone==='warn'?'tone-warn':'');
  if(tag)tag.textContent=focus.tone==='good'?'잘 가고 있음':'다음 주';
  if(kind)kind.textContent=focus.kind;
  if(msg)msg.textContent=focus.msg;
  if(ev)ev.innerHTML=(focus.evidence||[]).map(e=>`<span>${e}</span>`).join('');
}

// Previous-period rows for delta calc. Returns null when we don't have
// enough history (e.g. brand-new user or 전체 view) so callers can hide
// the delta fragment.
function _stPrevRows(){
  if(!_stData||!stPeriod)return null;
  const endPrev=new Date(now);endPrev.setDate(endPrev.getDate()-stPeriod);
  const startPrev=new Date(endPrev);startPrev.setDate(endPrev.getDate()-(stPeriod-1));
  const sK=dkey(startPrev),eK=dkey(endPrev);
  const prev=_stData.filter(r=>r._key>=sK&&r._key<=eK);
  if(prev.length<Math.max(3,Math.floor(stPeriod/4)))return null;
  return prev;
}

// Apply a signed-delta fragment to one of the bento cards. `kind` decides
// the color mapping: 'loss-good' means down is a win (weight, fail count),
// 'gain-good' means up is a win (clean %, routine %, volume).
function _setBentoDelta(elId,delta,kind,unit){
  const el=document.getElementById(elId);
  if(!el)return;
  if(delta==null||!isFinite(delta)){el.textContent='';el.className='bento-delta';return;}
  const rounded=unit==='kg'?Number(delta.toFixed(1)):Math.round(delta);
  if(Math.abs(rounded)<(unit==='kg'?0.1:1)){el.textContent='→ ±0';el.className='bento-delta flat';return;}
  const arrow=rounded>0?'▲':'▼';
  const sign=rounded>0?'+':'';
  let cls='flat';
  if(kind==='gain-good')cls=rounded>0?'good-up':'down';
  else if(kind==='loss-good')cls=rounded<0?'down':'up';
  el.textContent=`${arrow} ${sign}${rounded}${unit==='kg'?'':unit||''}`;
  el.className='bento-delta '+cls;
}

export function stRenderBento(rows,ctx){
  const prev=_stPrevRows();

  // ── 체중 — 기간 내 순 변화 (마지막 - 첫 기록) ──
  const wEntries=rows.map(r=>r.weight!=null?parseFloat(r.weight):null).filter(v=>v!=null&&isFinite(v));
  const wVal=document.getElementById('st-bento-weight');
  const wUnit=document.getElementById('st-bento-weight-unit');
  const wSub=document.getElementById('st-bento-weight-sub');
  const wDeltaEl=document.getElementById('st-bento-weight-delta');
  if(wEntries.length<2){
    wVal.textContent=wEntries.length?wEntries[0].toFixed(1):'—';
    wUnit.textContent='kg';
    wSub.textContent=wEntries.length?'기록 1회 — 추이 계산 불가':'기록 없음';
    wDeltaEl.textContent='';wDeltaEl.className='bento-delta';
  }else{
    const first=wEntries[0],last=wEntries[wEntries.length-1];
    const diff=last-first;
    wVal.textContent=(diff>=0?'+':'')+diff.toFixed(1);
    wUnit.textContent='kg';
    wSub.textContent=`${first.toFixed(1)} → ${last.toFixed(1)}kg · 기록 ${wEntries.length}회`;
    wDeltaEl.textContent='';wDeltaEl.className='bento-delta';
    // Tint the value directly since the sign IS the story
    wVal.style.color=Math.abs(diff)<0.1?'var(--text3)':(diff<0?'var(--green)':'var(--accent)');
  }

  // ── 운동 — 기간 총 볼륨 (1t 이상이면 t, 아니면 회) ──
  const totalVol=rows.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((b,w)=>b+(w.totalVolume||0),0),0);
  const totalGymSessions=rows.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').length,0);
  const useTons=totalVol>=1000;
  document.getElementById('st-bento-workout').textContent=useTons?(totalVol/1000).toFixed(1):(ctx.woCnt||totalGymSessions||0);
  document.getElementById('st-bento-workout-unit').textContent=useTons?'t':'회';
  const periodDays=stPeriod||rows.length;
  const woPerWeek=((ctx.woCnt||0)/(periodDays/7)).toFixed(1);
  document.getElementById('st-bento-workout-sub').textContent=useTons
    ? `${totalGymSessions}회 · 주 ${woPerWeek}`
    : `주 평균 ${woPerWeek}회`;
  if(prev){
    const prevVol=prev.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((b,w)=>b+(w.totalVolume||0),0),0);
    const prevCnt=prev.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.status==='done').length,0);
    if(useTons&&prevVol>0){
      _setBentoDelta('st-bento-workout-delta',((totalVol-prevVol)/1000),'gain-good','t');
    } else if(prevCnt>0){
      _setBentoDelta('st-bento-workout-delta',(ctx.woCnt||0)-prevCnt,'gain-good','회');
    } else { document.getElementById('st-bento-workout-delta').textContent=''; }
  } else { document.getElementById('st-bento-workout-delta').textContent=''; }

  // ── 클린식 — 비율 % ──
  document.getElementById('st-bento-clean').textContent=ctx.cleanPct;
  document.getElementById('st-bento-clean-sub').textContent=`${ctx.mealClean}/${ctx.mealAll}끼 클린`;
  if(prev){
    const pms=prev.flatMap(r=>(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type));
    const pClean=pms.length?Math.round(pms.filter(m=>m.type==='green').length/pms.length*100):null;
    if(pClean!=null){
      _setBentoDelta('st-bento-clean-delta',ctx.cleanPct-pClean,'gain-good','%');
    } else { document.getElementById('st-bento-clean-delta').textContent=''; }
  } else { document.getElementById('st-bento-clean-delta').textContent=''; }

  // ── 루틴 — 완료 비율 % ──
  document.getElementById('st-bento-routine').textContent=ctx.routinePct;
  document.getElementById('st-bento-routine-sub').textContent=`${ctx.mandDone}/${ctx.mandTotal}개 완료`;
  if(prev){
    let pd=0,pt=0;prev.forEach(r=>{const m=r.mandatory||[];pt+=m.length;pd+=m.filter(x=>x.done).length;});
    const pRoutine=pt>0?Math.round(pd/pt*100):null;
    if(pRoutine!=null){
      _setBentoDelta('st-bento-routine-delta',ctx.routinePct-pRoutine,'gain-good','%');
    } else { document.getElementById('st-bento-routine-delta').textContent=''; }
  } else { document.getElementById('st-bento-routine-delta').textContent=''; }
}

// ── 스파크라인 (mini) ──
export function renderSparkline(canvasId,key,data,rgb){
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  if(stCharts[key]){try{stCharts[key].destroy();}catch(_){}stCharts[key]=null;}
  if(!data||!data.length||data.every(v=>v===0))return;
  stCharts[key]=new window.Chart(canvas,{
    type:'line',
    data:{labels:data.map((_,i)=>i),datasets:[{
      data:data,borderColor:'rgb('+rgb+')',borderWidth:1.8,
      backgroundColor:ctx=>stGradient(ctx.chart.ctx,rgb,[[0,0.35],[1,0.0]]),
      pointRadius:0,fill:true,tension:0.4
    }]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:400},
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales:{x:{display:false},y:{display:false,min:0}},
      elements:{line:{borderJoinStyle:'round'}}
    }
  });
}

// ── Sprint D2: 기간 대비 변화 인사이트 (delta-first) ──
// rows vs _stData 전체에서 이전 기간을 분리해 주요 지표의 변화 추출
export function _stPeriodDeltaInsights(rows){
  const out=[];
  if(!_stData||!rows||!rows.length||!stPeriod)return out;
  // rows는 filtered 현재 기간. 이전 기간은 _stData 전체에서 시간 창만 바꿔 필터
  const endPrev=new Date(now);endPrev.setDate(endPrev.getDate()-stPeriod);
  const startPrev=new Date(endPrev);startPrev.setDate(endPrev.getDate()-(stPeriod-1));
  const sK=dkey(startPrev),eK=dkey(endPrev);
  const prev=_stData.filter(r=>r._key>=sK&&r._key<=eK);
  if(prev.length<Math.max(3,Math.floor(stPeriod/4)))return out; // 비교군 너무 적으면 skip

  const calcClean=arr=>{
    const ms=arr.flatMap(r=>(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type));
    return ms.length?Math.round(ms.filter(m=>m.type==='green').length/ms.length*100):null;
  };
  const calcRoutine=arr=>{let d=0,t=0;arr.forEach(r=>{const m=r.mandatory||[];t+=m.length;d+=m.filter(x=>x.done).length;});return t>0?Math.round(d/t*100):null;};
  const calcVol=arr=>arr.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((b,w)=>b+(w.totalVolume||0),0),0);
  const calcWoCnt=arr=>arr.reduce((a,r)=>a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').length,0);

  // 클린식 변화
  const cur1=calcClean(rows),prev1=calcClean(prev);
  if(cur1!==null&&prev1!==null&&Math.abs(cur1-prev1)>=8){
    const d=cur1-prev1;
    out.push(d>0
      ?{icon:'▲',text:`클린식 비율 +${d}% (${prev1}% → ${cur1}%). 잘 가고 있어.`,color:'var(--green)'}
      :{icon:'▼',text:`클린식 비율 ${d}% (${prev1}% → ${cur1}%). 무너지는 중.`,color:'var(--red)'});
  }

  // 루틴 완료율 변화
  const cur2=calcRoutine(rows),prev2=calcRoutine(prev);
  if(cur2!==null&&prev2!==null&&Math.abs(cur2-prev2)>=10){
    const d=cur2-prev2;
    out.push(d>0
      ?{icon:'▲',text:`루틴 완료율 +${d}% (${prev2}% → ${cur2}%). 꾸준함이 이긴다.`,color:'var(--green)'}
      :{icon:'▼',text:`루틴 완료율 ${d}% (${prev2}% → ${cur2}%). 약속을 지켜.`,color:'var(--red)'});
  }

  // 운동 볼륨 변화
  const cur3=calcVol(rows),prev3=calcVol(prev);
  if(prev3>0&&cur3>0){
    const pct=Math.round((cur3-prev3)/prev3*100);
    if(Math.abs(pct)>=15){
      out.push(pct>0
        ?{icon:'▲',text:`운동 볼륨 +${pct}% vs 지난 기간. 더 들어.`,color:'var(--green)'}
        :{icon:'▼',text:`운동 볼륨 ${pct}% vs 지난 기간. 회복하고 돌아와.`,color:'var(--red)'});
    }
  }

  // 운동 빈도 변화 (볼륨과 구분)
  const cur4=calcWoCnt(rows),prev4=calcWoCnt(prev);
  if(Math.abs(cur4-prev4)>=2){
    const d=cur4-prev4;
    out.push(d>0
      ?{icon:'▲',text:`운동 횟수 +${d}회 vs 지난 기간. 관성을 유지해.`,color:'var(--green)'}
      :{icon:'▼',text:`운동 횟수 ${d}회 vs 지난 기간. 체육관 한 번 더.`,color:'var(--red)'});
  }

  return out;
}

// ── 인사이트 엔진 ──
export function stRenderInsights(rows){
  const insights=[];
  const c=getChartColors();

  // Sprint D2: 기간 대비 변화가 먼저 보이도록 맨 앞에 삽입 (최대 2개)
  const deltas=_stPeriodDeltaInsights(rows);
  deltas.slice(0,2).forEach(d=>insights.push(d));

  // 스트릭
  const streak=calcStreak();
  if(streak>=30)insights.push({icon:'🔥',text:'스트릭 '+streak+'일 달성! 완벽한 습관이 만들어지고 있어요.',color:'var(--green)'});
  else if(streak>=7)insights.push({icon:'🔥',text:'스트릭 '+streak+'일 진행 중. 30일까지 도전해보세요!',color:'var(--amber)'});

  // 볼륨 증감
  if(rows.length>=14){
    const half=Math.floor(rows.length/2);
    const v1=rows.slice(0,half).reduce((a,r)=>{
      return a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((b,w)=>b+(w.totalVolume||0),0);
    },0);
    const v2=rows.slice(half).reduce((a,r)=>{
      return a+(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((b,w)=>b+(w.totalVolume||0),0);
    },0);
    if(v1>0&&v2>0){
      const pct=Math.round((v2-v1)/v1*100);
      if(pct>=20)insights.push({icon:'💪',text:'운동 볼륨이 전반기 대비 +'+pct+'% 증가했어요. PR 경신 가능!',color:'var(--green)'});
      else if(pct<=-20)insights.push({icon:'⚠️',text:'운동 볼륨이 전반기 대비 '+pct+'% 감소했어요. 꾸준함을 유지해보세요.',color:'var(--amber)'});
    }
  }

  // 클린식 비율
  let mealClean=0,mealAll=0;
  rows.forEach(r=>{
    const ms=(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type);
    mealAll+=ms.length;mealClean+=ms.filter(m=>m.type==='green').length;
  });
  const cleanPct=mealAll>0?Math.round(mealClean/mealAll*100):0;
  if(cleanPct>=60)insights.push({icon:'🥗',text:'클린식 비율 '+cleanPct+'%! 식단 관리가 정말 잘 되고 있어요.',color:'var(--green)'});
  else if(mealAll>5&&cleanPct<30)insights.push({icon:'🥗',text:'클린식 비율이 '+cleanPct+'%예요. 한 끼씩 클린하게 바꿔보세요.',color:'var(--red)'});

  // 특정 요일 치팅 패턴
  const dayCheat={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  rows.forEach(r=>{
    const d=new Date(r._key+'T00:00:00');
    const cheatCnt=(r.meals||[]).filter(m=>m.type==='cheat'||m.type==='alcohol').length;
    if(cheatCnt>0)dayCheat[d.getDay()]+=cheatCnt;
  });
  const dayNames=['일','월','화','수','목','금','토'];
  const maxDay=Object.entries(dayCheat).sort((a,b)=>b[1]-a[1])[0];
  if(maxDay[1]>=3)insights.push({icon:'🎉',text:dayNames[maxDay[0]]+'요일에 치팅이 집중돼요 ('+maxDay[1]+'회). 미리 계획을 세워보세요.',color:'var(--amber)'});

  // 할일 완료율 저조
  let tgtDone=0,tgtTotal=0;
  rows.forEach(r=>{const t=r.targets||[];tgtTotal+=t.length;tgtDone+=t.filter(x=>x.st==='done').length;});
  const tgtPct=tgtTotal>5?Math.round(tgtDone/tgtTotal*100):null;
  if(tgtPct!==null&&tgtPct<40)insights.push({icon:'📋',text:'할일 완료율이 '+tgtPct+'%예요. 할일 수를 줄이거나 우선순위를 조정해보세요.',color:'var(--amber)'});

  // 체중 추이
  const wPts=rows.filter(r=>r.weight!=null).map(r=>parseFloat(r.weight));
  if(wPts.length>=7){
    const diff=wPts[wPts.length-1]-wPts[0];
    if(diff<=-1)insights.push({icon:'⬇️',text:'체중이 '+Math.abs(diff).toFixed(1)+'kg 감량됐어요. 꾸준히 유지해요!',color:'var(--green)'});
    else if(diff>=2)insights.push({icon:'⬆️',text:'체중이 '+diff.toFixed(1)+'kg 증가했어요. 식단을 점검해보세요.',color:'var(--red)'});
  }

  // 음주
  let alcCnt=0;
  rows.forEach(r=>{alcCnt+=(r.meals||[]).filter(m=>m.category==='alcohol').length;});
  const alcPerWeek=(alcCnt/((stPeriod||rows.length)/7)).toFixed(1);
  if(alcCnt>=3)insights.push({icon:'🍺',text:'기간 내 음주 '+alcCnt+'회 (주 평균 '+alcPerWeek+'회). 회복 식단을 챙기세요.',color:'var(--red)'});

  // 루틴 마스터
  let mandDone2=0,mandTotal2=0;
  rows.forEach(r=>{const m=r.mandatory||[];mandTotal2+=m.length;mandDone2+=m.filter(x=>x.done).length;});
  const routinePct2=mandTotal2>0?Math.round(mandDone2/mandTotal2*100):0;
  if(routinePct2>=90&&mandTotal2>10)insights.push({icon:'🏆',text:'루틴 완료율 '+routinePct2+'%! 난이도를 올릴 때가 됐어요.',color:'var(--green)'});

  const list=document.getElementById('st-insights-list');
  if(!insights.length){
    list.innerHTML='<div style="font-size:12px;color:var(--text3);padding:10px 0;">기록이 더 쌓이면 인사이트가 생성됩니다.</div>';
    return;
  }
  list.innerHTML=insights.slice(0,5).map(ins=>`
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--surface2);border-radius:10px;margin-bottom:6px;border-left:3px solid ${ins.color};">
      <span style="font-size:16px;flex-shrink:0;">${ins.icon}</span>
      <span style="font-size:12px;color:var(--text);line-height:1.6;">${ins.text}</span>
    </div>`).join('');
}

// ── 차트들 ──
export function stDestroyChart(key){
  if(stCharts[key]){stCharts[key].destroy();stCharts[key]=null;}
}
export const stChartCfg={responsive:true,maintainAspectRatio:false,animation:{duration:300},plugins:{legend:{display:false}}};

// ── Dashboard-grade chart helpers ──
export function stGradient(ctx,color,stops){
  // color: e.g. '255,77,77'; stops: [[0,0.35],[1,0.02]]
  const g=ctx.createLinearGradient(0,0,0,ctx.canvas.height||200);
  (stops||[[0,0.35],[1,0.02]]).forEach(([p,a])=>g.addColorStop(p,'rgba('+color+','+a+')'));
  return g;
}
export function stDashCfg(opts){
  opts=opts||{};
  const c=getChartColors();
  return{
    responsive:true,maintainAspectRatio:false,
    animation:{duration:450,easing:'easeOutCubic'},
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{display:false},
      tooltip:{
        enabled:true,
        backgroundColor:'rgba(20,20,26,0.95)',
        borderColor:'rgba(255,255,255,0.08)',borderWidth:1,
        titleColor:'#fff',titleFont:{size:11,weight:'600',family:'DM Sans'},
        bodyColor:'#cbd5e1',bodyFont:{size:11,family:'DM Mono'},
        padding:10,displayColors:false,cornerRadius:8,
        callbacks:opts.tooltip||{}
      }
    },
    scales:{
      x:{ticks:{color:c.text,font:{size:9,family:'DM Mono'},maxTicksLimit:opts.xTicks||6,maxRotation:0},grid:{display:false},border:{display:false}},
      y:{ticks:{color:c.text,font:{size:9,family:'DM Mono'},callback:opts.yCallback||null,maxTicksLimit:5},grid:{color:'rgba(255,255,255,0.04)',drawTicks:false},border:{display:false},...(opts.yScale||{})}
    }
  };
}
export function stDelta(curr,prev,opts){
  opts=opts||{};
  if(prev==null||isNaN(prev)||prev===0){
    if(curr>0)return '<span class="stats-delta up">new</span>';
    return '<span class="stats-delta flat">—</span>';
  }
  const diff=curr-prev;
  const pct=Math.round(diff/Math.abs(prev)*100);
  const arrow=diff>0?'↑':(diff<0?'↓':'·');
  const inverse=opts.inverse||false; // inverse=true means down is good (e.g., weight loss goal)
  const good=inverse?diff<0:diff>0;
  const neutral=diff===0;
  const cls=neutral?'flat':(good?'up':'down');
  return '<span class="stats-delta '+cls+'">'+arrow+' '+Math.abs(pct)+'%</span>';
}
export function stPrevRows(rows){
  if(!stPeriod)return [];
  const period=stPeriod;
  const end=new Date(now);end.setDate(end.getDate()-period);
  const start=new Date(end);start.setDate(end.getDate()-(period-1));
  const endK=dkey(end),startK=dkey(start);
  return rows.filter(r=>r._key>=startK&&r._key<=endK);
}
export function stHeadline(containerId,cells){
  const el=document.getElementById(containerId);if(!el)return;
  el.innerHTML='<div class="stats-headline">'+cells.map(c=>`
    <div class="stats-headline-cell">
      <div class="stats-headline-label">${c.label}</div>
      <div class="stats-headline-val">${c.value}${c.unit?`<span class="stats-headline-unit">${c.unit}</span>`:''}</div>
      ${c.delta||''}
    </div>`).join('')+'</div>';
}
// Plugin: draw dashed horizontal target line
export const stTargetLinePlugin={
  id:'stTargetLine',
  afterDatasetsDraw(chart,args,opts){
    if(opts==null||opts.value==null)return;
    const{ctx,chartArea:{left,right},scales:{y}}=chart;
    const yp=y.getPixelForValue(opts.value);
    if(isNaN(yp))return;
    ctx.save();
    ctx.strokeStyle=opts.color||'rgba(245,158,11,0.5)';
    ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(left,yp);ctx.lineTo(right,yp);ctx.stroke();
    if(opts.label){
      ctx.setLineDash([]);ctx.fillStyle=opts.color||'rgba(245,158,11,0.8)';
      ctx.font='10px DM Mono';ctx.textAlign='right';
      ctx.fillText(opts.label,right-4,yp-4);
    }
    ctx.restore();
  }
};
if(window.Chart&&window.Chart.register)window.Chart.register(stTargetLinePlugin);

export function stRenderWeightChart(rows){
  const pts=rows.filter(r=>r.weight!=null).map(r=>({x:r._key,y:parseFloat(r.weight)}));
  const empty=document.getElementById('st-weight-empty');
  const canvas=document.getElementById('st-chart-weight');
  const metaEl=document.getElementById('st-weight-meta');
  if(!pts.length){empty.style.display='block';canvas.style.display='none';if(metaEl)metaEl.innerHTML='';return;}
  empty.style.display='none';canvas.style.display='block';
  const vals=pts.map(p=>p.y);
  const start=vals[0], current=vals[vals.length-1];
  const diff=current-start;
  const prevPts=stPrevRows(rows).filter(r=>r.weight!=null).map(r=>parseFloat(r.weight));
  const prevCurrent=prevPts.length?prevPts[prevPts.length-1]:null;
  const goal=(typeof window.CP!=='undefined'&&window.CP&&window.CP.weight_goal)?parseFloat(window.CP.weight_goal):null;
  stHeadline('st-weight-meta',[
    {label:'현재',value:current.toFixed(1),unit:'kg'},
    {label:'시작 대비',value:(diff>0?'+':'')+diff.toFixed(1),unit:'kg'},
    {label:'목표까지',value:goal?(Math.abs(current-goal).toFixed(1)):'—',unit:goal?'kg':'',delta:goal?stDelta(current,prevCurrent,{inverse:goal<start}):''}
  ]);
  // Inline subtitle — tells the user what the red bars mean since they
  // sit on a separate right axis.
  const metaElHint=document.getElementById('st-weight-meta');
  if(metaElHint){
    const subtitle=document.createElement('div');
    subtitle.style.cssText='font-size:10px;color:var(--text3);margin-top:8px;letter-spacing:-.005em;line-height:1.4;';
    subtitle.textContent='파란 라인은 체중(kg). 빨간 bar 는 같은 날 운동 볼륨.';
    metaElHint.appendChild(subtitle);
  }

  // ── 체중 + 운동 볼륨 overlay ─────────────────────────────────────
  // 루틴·클린식 라인은 체중 맥락에서 와닿지 않아 제거. 우축은 운동 볼륨
  // (kg/t) 실제 단위로 표시. 운동은 bar, 체중은 filled line.
  const labels=pts.map(p=>p.x.slice(5).replace('-','/'));
  const keyByLabel=pts.map(p=>p.x);
  const rowByKey=Object.fromEntries(rows.map(r=>[r._key,r]));
  const volKg=keyByLabel.map(k=>{
    const r=rowByKey[k];
    if(!r)return null;
    const vol=(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((a,w)=>a+(w.totalVolume||0),0);
    return vol>0?vol:null;
  });
  const maxVol=Math.max(0,...volKg.filter(v=>v!=null));
  const volUseTon=maxVol>=1000;
  const volTickFmt=v=>{
    if(volUseTon)return (v/1000).toFixed(v>=1000?1:1)+'t';
    return v>=1000?(v/1000).toFixed(1)+'t':Math.round(v)+'kg';
  };

  stDestroyChart('weight');
  stCharts.weight=new window.Chart(canvas,{
    type:'line',
    data:{
      labels,
      datasets:[
        // Weight — primary line, filled, left axis (kg)
        {
          label:'체중',yAxisID:'y',data:vals,
          borderColor:'#38bdf8',borderWidth:2.5,
          backgroundColor:ctx=>stGradient(ctx.chart.ctx,'96,165,250',[[0,0.32],[1,0.0]]),
          pointRadius:0,pointHoverRadius:6,pointHoverBorderWidth:2,
          pointHoverBackgroundColor:'#38bdf8',pointHoverBorderColor:'#fff',
          fill:true,tension:0.4,order:1,
        },
        // Workout volume — bars on days with a gym session, right axis (kg/t)
        {
          label:'운동 볼륨',yAxisID:'yVol',type:'bar',data:volKg,
          backgroundColor:'rgba(255,77,77,0.32)',
          borderColor:'rgba(255,77,77,0.55)',borderWidth:1,
          barThickness:6,order:2,
        },
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:'var(--text3)',font:{size:10},boxWidth:10,boxHeight:6,padding:8}},
        tooltip:{enabled:true,backgroundColor:'rgba(20,20,24,0.95)',borderColor:'rgba(255,255,255,0.08)',borderWidth:1,titleColor:'#eaeaea',bodyColor:'#eaeaea',padding:8,callbacks:{
          label:ctx=>{
            const v=ctx.parsed.y;
            if(ctx.dataset.label==='체중')return `체중 ${v.toFixed(1)} kg`;
            if(ctx.dataset.label==='운동 볼륨')return `볼륨 ${v>=1000?(v/1000).toFixed(1)+'t':Math.round(v)+'kg'}`;
            return v;
          }
        }},
        stTargetLine:goal?{value:goal,color:'rgba(245,158,11,0.7)',label:'목표 '+goal+'kg'}:null,
      },
      scales:{
        x:{grid:{display:false},ticks:{color:'rgba(255,255,255,0.35)',font:{size:10},maxRotation:0}},
        y:{position:'left',grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'rgba(255,255,255,0.55)',font:{size:10},callback:v=>v+'kg'},
          min:Math.floor(Math.min(...vals,goal||Infinity)-1),max:Math.ceil(Math.max(...vals,goal||-Infinity)+1)},
        yVol:{position:'right',display:true,min:0,beginAtZero:true,grid:{display:false},
          ticks:{color:'rgba(255,77,77,0.55)',font:{size:9},callback:v=>volTickFmt(v)}},
      },
    }
  });
}

export function stRenderVolChart(rows){
  const buildWeekly=(rs)=>{
    const map={};
    rs.forEach(r=>{
      const d=new Date(r._key+'T00:00:00');
      const mon=new Date(d);mon.setDate(d.getDate()-((d.getDay()+6)%7));
      const wk=(mon.getMonth()+1)+'/'+mon.getDate();
      const vol=(r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').reduce((a,w)=>a+(w.totalVolume||0),0);
      if(!map[wk])map[wk]=0;
      map[wk]+=vol;
    });
    return map;
  };
  const weekMap=buildWeekly(rows);
  const labels=Object.keys(weekMap),vals=Object.values(weekMap);
  const empty=document.getElementById('st-vol-empty');
  const canvas=document.getElementById('st-chart-vol');
  const metaEl=document.getElementById('st-vol-meta');
  if(!vals.some(v=>v>0)){empty.style.display='block';canvas.style.display='none';if(metaEl)metaEl.innerHTML='';return;}
  empty.style.display='none';canvas.style.display='block';
  const total=vals.reduce((a,v)=>a+v,0);
  const nonZero=vals.filter(v=>v>0);
  const avg=total/nonZero.length;
  const peak=Math.max(...vals);
  const prevMap=buildWeekly(stPrevRows(rows));
  const prevTotal=Object.values(prevMap).reduce((a,v)=>a+v,0);
  const fmt=v=>v>=1000?(v/1000).toFixed(1)+'t':Math.round(v).toLocaleString()+'kg';
  stHeadline('st-vol-meta',[
    {label:'총 볼륨',value:total>=1000?(total/1000).toFixed(1):Math.round(total).toLocaleString(),unit:total>=1000?'t':'kg',delta:stDelta(total,prevTotal)},
    {label:'주 평균',value:avg>=1000?(avg/1000).toFixed(1):Math.round(avg).toLocaleString(),unit:avg>=1000?'t':'kg'},
    {label:'최고주',value:peak>=1000?(peak/1000).toFixed(1):Math.round(peak).toLocaleString(),unit:peak>=1000?'t':'kg'}
  ]);
  stDestroyChart('vol');
  stCharts.vol=new window.Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[{
      data:vals.map(v=>v>=1000?(v/1000):v),
      backgroundColor:ctx=>{
        const v=ctx.raw;if(!v)return 'rgba(255,77,77,.12)';
        return stGradient(ctx.chart.ctx,'255,77,77',[[0,0.95],[1,0.25]]);
      },
      borderRadius:{topLeft:6,topRight:6,bottomLeft:0,bottomRight:0},
      borderSkipped:false,
      maxBarThickness:44
    }]},
    options:{...stDashCfg({
      yCallback:v=>v>=1?v+'t':Math.round(v*1000)+'kg',
      tooltip:{label:ctx=>{const v=ctx.parsed.y;return v>=1?v.toFixed(1)+'t':Math.round(v*1000).toLocaleString()+'kg';}}
    }),plugins:{...stDashCfg().plugins,stTargetLine:nonZero.length>1?{value:avg>=1000?avg/1000:avg,color:'rgba(245,158,11,0.5)',label:'평균'}:null}}
  });
}

// ── 운동별 집계 ──
// Returns map: { name -> { kind:'gym'|'activity', icon, sessions:[{date, ...}], totalVol, sessionCount } }
export function buildExerciseIndex(rows){
  const idx={};
  rows.forEach(r=>{
    const date=r._key;
    (r.workouts||[]).forEach(w=>{
      if(w.status&&w.status!=='done')return;
      if(w.type==='gym'){
        (w.exercises||[]).forEach(ex=>{
          const name=ex.name;if(!name)return;
          const doneSets=(ex.sets||[]).filter(s=>s.done);
          if(!doneSets.length)return;
          const isStr=ex.isStrength!==false&&doneSets.some(s=>s.kg!=null&&s.kg!=='');
          let volume=0,topKg=0,topReps=0,bestE1=0,totalReps=0;
          doneSets.forEach(s=>{
            const kg=parseFloat(s.kg)||0;
            const reps=parseInt(s.reps)||0;
            totalReps+=reps;
            if(isStr){
              volume+=kg*reps;
              if(kg>topKg||(kg===topKg&&reps>topReps)){topKg=kg;topReps=reps;}
              const e1=reps>0?kg*(1+reps/30):0;
              if(e1>bestE1)bestE1=e1;
            }
          });
          if(!idx[name])idx[name]={kind:'gym',icon:ex.icon||'💪',isStr,sessions:[],totalVol:0,sessionCount:0};
          idx[name].sessions.push({date,setCount:doneSets.length,volume,topKg,topReps,bestE1,totalReps,sets:doneSets.map(s=>({kg:parseFloat(s.kg)||0,reps:parseInt(s.reps)||0}))});
          idx[name].totalVol+=volume;
          idx[name].sessionCount++;
        });
      } else if(w.type==='activity'){
        const name=w.name;if(!name)return;
        const dist=parseFloat(w.distance)||0;
        const time=parseFloat(w.time)||0;
        if(!dist&&!time)return;
        if(!idx[name])idx[name]={kind:'activity',icon:w.icon||'🏃',sessions:[],totalVol:0,sessionCount:0};
        idx[name].sessions.push({date,distance:dist,time,pace:w.pace||null});
        idx[name].totalVol+=(dist||time);
        idx[name].sessionCount++;
      }
    });
  });
  Object.values(idx).forEach(e=>e.sessions.sort((a,b)=>a.date.localeCompare(b.date)));
  return idx;
}

export function stRenderExerciseList(rows){
  const idx=buildExerciseIndex(rows);
  const list=document.getElementById('st-exlist');
  const empty=document.getElementById('st-exlist-empty');
  const meta=document.getElementById('st-exlist-meta');
  const entries=Object.entries(idx).sort((a,b)=>b[1].sessionCount-a[1].sessionCount);
  if(!entries.length){list.innerHTML='';empty.style.display='block';meta.textContent='';return;}
  empty.style.display='none';
  meta.textContent=entries.length+'개 종목 · 탭하면 상세';
  list.innerHTML=entries.slice(0,20).map(([name,e])=>{
    const sub=e.kind==='gym'
      ?(e.sessionCount+'회 · 누적 '+Math.round(e.totalVol).toLocaleString()+'kg')
      :(e.sessionCount+'회 기록');
    const lastSess=e.sessions[e.sessions.length-1];
    const lastStr=e.kind==='gym'
      ?(lastSess.topKg>0?'최근 '+lastSess.topKg+'kg×'+lastSess.topReps:'최근 '+lastSess.setCount+'세트')
      :(lastSess.distance?'최근 '+lastSess.distance+'km':(lastSess.time?'최근 '+lastSess.time+'분':''));
    return `<div onclick="openExerciseDetail('${name.replace(/'/g,"\\'")}')"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:10px;cursor:pointer;touch-action:manipulation;">
      <div style="flex-shrink:0;">${exIcon(name,48)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${sub}</div>
      </div>
      <div style="font-size:10px;color:var(--text2);font-family:'DM Mono',monospace;text-align:right;flex-shrink:0;">${lastStr}</div>
      <div style="font-size:12px;color:var(--text3);flex-shrink:0;">›</div>
    </div>`;
  }).join('');
}

// ── 운동 상세 모달 ──
export let _edmState={name:null,period:30};
export function openExerciseDetail(name){
  _edmState.name=name;_edmState.period=30;
  document.querySelectorAll('#edm-period-btns .stats-period-btn').forEach((b,i)=>{b.classList.toggle('active',i===1);});
  const modal=document.getElementById('exercise-detail-modal');
  modal.style.display='flex';
  edmRender();
}
export function closeExerciseDetail(){
  const modal=document.getElementById('exercise-detail-modal');
  modal.style.display='none';
  if(window._edmChart){try{_edmChart.destroy();}catch(_){}_edmChart=null;}
}
export function edmSetPeriod(days,btn){
  _edmState.period=days;
  document.querySelectorAll('#edm-period-btns .stats-period-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  edmRender();
}
export function edmRender(){
  const name=_edmState.name;const days=_edmState.period;
  const keyed=(_stData||Object.keys(window.logCache).map(k=>({...logCache[k],_key:k}))).slice();
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days+1);
  const cutKey=cutoff.toISOString().slice(0,10);
  const filtered=keyed.filter(r=>r._key>=cutKey);
  const idx=buildExerciseIndex(filtered);
  const ex=idx[name];
  document.getElementById('edm-title').textContent=(ex?.icon||'💪')+' '+name;
  const prBox=document.getElementById('edm-prs');
  const sessBox=document.getElementById('edm-sessions');
  const chartLabel=document.getElementById('edm-chart-label');
  const sub=document.getElementById('edm-sub');
  if(!ex||!ex.sessions.length){
    sub.textContent='기록 없음';
    prBox.innerHTML='';
    sessBox.innerHTML='<div style="text-align:center;color:var(--text3);font-size:12px;padding:24px 0;">이 기간 기록이 없어요</div>';
    if(window._edmChart){try{_edmChart.destroy();}catch(_){}_edmChart=null;}
    return;
  }
  sub.textContent=ex.sessionCount+'회 기록';
  // PRs
  if(ex.kind==='gym'){
    const prKg=ex.sessions.reduce((m,s)=>s.topKg>m.topKg?s:m,{topKg:0,topReps:0});
    const prVol=ex.sessions.reduce((m,s)=>s.volume>m.volume?s:m,{volume:0});
    const prE1=ex.sessions.reduce((m,s)=>s.bestE1>m.bestE1?s:m,{bestE1:0});
    prBox.innerHTML=`
      <div style="flex:1;text-align:center;padding:14px 0;">
        <div style="font-size:18px;font-weight:800;color:var(--accent);">${prKg.topKg||0}<span style="font-size:11px;color:var(--text3);">kg</span></div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">🏆 최고 중량 ${prKg.topReps?'×'+prKg.topReps:''}</div>
      </div>
      <div style="flex:1;text-align:center;padding:14px 0;border-left:1px solid var(--border);">
        <div style="font-size:18px;font-weight:800;color:var(--green);">${Math.round(prE1.bestE1||0)}<span style="font-size:11px;color:var(--text3);">kg</span></div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">🏆 최고 e1RM</div>
      </div>
      <div style="flex:1;text-align:center;padding:14px 0;border-left:1px solid var(--border);">
        <div style="font-size:18px;font-weight:800;color:var(--text);">${Math.round(prVol.volume||0).toLocaleString()}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">🏆 최고 볼륨</div>
      </div>`;
    chartLabel.textContent='세션 볼륨 (kg) · 최고 세트';
  } else {
    const prDist=ex.sessions.reduce((m,s)=>s.distance>m.distance?s:m,{distance:0});
    const prTime=ex.sessions.reduce((m,s)=>s.time>m.time?s:m,{time:0});
    prBox.innerHTML=`
      <div style="flex:1;text-align:center;padding:14px 0;">
        <div style="font-size:18px;font-weight:800;color:var(--accent);">${prDist.distance||0}<span style="font-size:11px;color:var(--text3);">km</span></div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">🏆 최장 거리</div>
      </div>
      <div style="flex:1;text-align:center;padding:14px 0;border-left:1px solid var(--border);">
        <div style="font-size:18px;font-weight:800;color:var(--green);">${prTime.time||0}<span style="font-size:11px;color:var(--text3);">분</span></div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">🏆 최장 시간</div>
      </div>
      <div style="flex:1;text-align:center;padding:14px 0;border-left:1px solid var(--border);">
        <div style="font-size:18px;font-weight:800;color:var(--text);">${ex.sessionCount}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">총 횟수</div>
      </div>`;
    chartLabel.textContent=ex.kind==='activity'?(ex.sessions.some(s=>s.distance>0)?'거리 (km)':'시간 (분)'):'기록';
  }
  // Chart
  if(window._edmChart){try{_edmChart.destroy();}catch(_){}_edmChart=null;}
  const canvas=document.getElementById('edm-chart');
  const labels=ex.sessions.map(s=>s.date.slice(5));
  let primaryData,secondaryData=null,primaryLabel,secondaryLabel;
  if(ex.kind==='gym'){
    primaryData=ex.sessions.map(s=>Math.round(s.volume));
    secondaryData=ex.sessions.map(s=>s.topKg);
    primaryLabel='볼륨';secondaryLabel='최고 세트(kg)';
  } else {
    const useDist=ex.sessions.some(s=>s.distance>0);
    primaryData=ex.sessions.map(s=>useDist?s.distance:s.time);
    primaryLabel=useDist?'거리(km)':'시간(분)';
  }
  const c=getChartColors();
  const datasets=[{label:primaryLabel,data:primaryData,borderColor:'rgba(255,77,77,1)',backgroundColor:'rgba(255,77,77,.15)',tension:0.3,yAxisID:'y',fill:true,pointRadius:3}];
  if(secondaryData)datasets.push({label:secondaryLabel,data:secondaryData,borderColor:'rgba(255,77,77,1)',backgroundColor:'transparent',tension:0.3,yAxisID:'y1',pointRadius:3,borderDash:[4,4]});
  window._edmChart=new window.Chart(canvas,{
    type:'line',
    data:{labels,datasets},
    options:{...stChartCfg,scales:{
      x:{ticks:{color:c.text,font:{size:9}},grid:{display:false}},
      y:{position:'left',ticks:{color:c.text,font:{size:9}},grid:{color:c.grid}},
      ...(secondaryData?{y1:{position:'right',ticks:{color:c.text,font:{size:9}},grid:{display:false}}}:{})
    },plugins:{...stChartCfg.plugins,legend:{display:!!secondaryData,labels:{color:c.text,font:{size:10},boxWidth:10}}}}
  });
  // Sessions list (newest first)
  const prKg=ex.kind==='gym'?ex.sessions.reduce((a,b)=>b.topKg>a?b.topKg:a,0):0;
  const prVol=ex.kind==='gym'?ex.sessions.reduce((a,b)=>b.volume>a?b.volume:a,0):0;
  const prDist=ex.kind!=='gym'?ex.sessions.reduce((a,b)=>b.distance>a?b.distance:a,0):0;
  const prTime=ex.kind!=='gym'?ex.sessions.reduce((a,b)=>b.time>a?b.time:a,0):0;
  sessBox.innerHTML='<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">세션 기록</div>'+
    ex.sessions.slice().reverse().map(s=>{
      const isPr=ex.kind==='gym'
        ?(s.topKg===prKg&&prKg>0)||(s.volume===prVol&&prVol>0)
        :(s.distance===prDist&&prDist>0)||(s.time===prTime&&prTime>0);
      const mainLine=ex.kind==='gym'
        ?`${s.setCount}세트 · ${Math.round(s.volume).toLocaleString()}kg 볼륨`
        :`${s.distance?s.distance+'km':''}${s.distance&&s.time?' · ':''}${s.time?s.time+'분':''}${s.pace?' · '+s.pace+'/km':''}`;
      const detail=ex.kind==='gym'&&s.topKg>0?`최고 ${s.topKg}kg×${s.topReps} · e1RM ${Math.round(s.bestE1)}kg`:'';
      return `<div style="padding:10px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:10px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="font-size:12px;font-weight:600;color:var(--text);">${s.date}</div>
          ${isPr?'<div style="font-size:10px;padding:2px 6px;border-radius:10px;background:rgba(245,158,11,.2);color:#f59e0b;font-weight:700;">🏆 PR</div>':''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px;font-family:'DM Mono',monospace;">${mainLine}</div>
        ${detail?`<div style="font-size:10px;color:var(--text3);margin-top:2px;">${detail}</div>`:''}
      </div>`;
    }).join('');
}

export function stRenderRoutineChart(rows){
  const buildPts=(rs)=>rs.filter(r=>(r.mandatory||[]).length>0).map(r=>{
    const m=r.mandatory||[];
    return{x:r._key,y:Math.round(m.filter(x=>x.done).length/m.length*100)};
  });
  const pts=buildPts(rows);
  const empty=document.getElementById('st-routine-empty');
  const canvas=document.getElementById('st-chart-routine');
  const metaEl=document.getElementById('st-routine-meta');
  if(!pts.length){empty.style.display='block';canvas.style.display='none';if(metaEl)metaEl.innerHTML='';return;}
  empty.style.display='none';canvas.style.display='block';
  const avg=Math.round(pts.reduce((a,p)=>a+p.y,0)/pts.length);
  const perfect=pts.filter(p=>p.y===100).length;
  const prevPts=buildPts(stPrevRows(rows));
  const prevAvg=prevPts.length?Math.round(prevPts.reduce((a,p)=>a+p.y,0)/prevPts.length):null;
  stHeadline('st-routine-meta',[
    {label:'평균 완료율',value:avg,unit:'%',delta:stDelta(avg,prevAvg)},
    {label:'100% 달성일',value:perfect,unit:'일'},
    {label:'기록일',value:pts.length,unit:'일'}
  ]);
  stDestroyChart('routine');
  stCharts.routine=new window.Chart(canvas,{
    type:'line',
    data:{
      labels:pts.map(p=>p.x.slice(5).replace('-','/')),
      datasets:[{
        data:pts.map(p=>p.y),borderColor:'#34d399',borderWidth:2.5,
        backgroundColor:ctx=>stGradient(ctx.chart.ctx,'52,211,153',[[0,0.3],[1,0.0]]),
        pointRadius:0,pointHoverRadius:6,pointHoverBorderColor:'#fff',pointHoverBackgroundColor:'#34d399',
        fill:true,tension:0.4
      }]
    },
    options:{...stDashCfg({
      yCallback:v=>v+'%',
      yScale:{min:0,max:100},
      tooltip:{label:ctx=>ctx.parsed.y+'% 완료'}
    }),plugins:{...stDashCfg().plugins,stTargetLine:{value:80,color:'rgba(52,211,153,0.55)',label:'목표 80%'}}}
  });
}

export function stRenderReportCard(rows){
  const container=document.getElementById('st-report-card');
  if(!rows.length){container.innerHTML='';return;}
  const calcPct=(arr,fn)=>{let d=0,t=0;arr.forEach(r=>{const a=fn(r);t+=a.total;d+=a.done;});return t>0?Math.round(d/t*100):null;};
  const routinePct=calcPct(rows,r=>{const m=r.mandatory||[];return{total:m.length,done:m.filter(x=>x.done).length};});
  const targetPct=calcPct(rows,r=>{const t=r.targets||[];return{total:t.length,done:t.filter(x=>x.st==='done').length};});
  const mealRows=rows.flatMap(r=>(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type));
  const cleanPct=mealRows.length?Math.round(mealRows.filter(m=>m.type==='green').length/mealRows.length*100):null;
  let woCnt=0;rows.forEach(r=>{woCnt+=(r.workouts||[]).filter(w=>w.status==='done').length;});
  const woPerWeek=rows.length>=7?(woCnt/(rows.length/7)).toFixed(1):woCnt;
  const grade=(v,thresholds)=>{if(v===null)return{g:'-',c:'var(--text3)'};for(const[min,g,c]of thresholds)if(v>=min)return{g,c};return thresholds[thresholds.length-1]?{g:'F',c:'var(--red)'}:{g:'-',c:'var(--text3)'};};
  const cats=[
    {name:'훈련',icon:'🏋️',val:woPerWeek>=3?'A':woPerWeek>=2?'B':woPerWeek>=1?'C':'D',...grade(woPerWeek>=3?90:woPerWeek>=2?70:woPerWeek>=1?50:20,[[80,'A','var(--green)'],[60,'B','var(--blue)'],[40,'C','var(--amber)'],[0,'D','var(--red)']]),sub:'주 '+woPerWeek+'회'},
    {name:'식단',icon:'🥗',...grade(cleanPct,[[70,'A','var(--green)'],[50,'B','var(--blue)'],[30,'C','var(--amber)'],[0,'D','var(--red)']]),sub:cleanPct!==null?'클린 '+cleanPct+'%':'데이터 없음'},
    {name:'루틴',icon:'✅',...grade(routinePct,[[90,'A','var(--green)'],[70,'B','var(--blue)'],[50,'C','var(--amber)'],[0,'D','var(--red)']]),sub:routinePct!==null?'완료 '+routinePct+'%':'데이터 없음'},
    {name:'할일',icon:'🎯',...grade(targetPct,[[80,'A','var(--green)'],[60,'B','var(--blue)'],[40,'C','var(--amber)'],[0,'D','var(--red)']]),sub:targetPct!==null?'완료 '+targetPct+'%':'데이터 없음'},
  ];
  const overall=cats.filter(c=>c.g!=='-');
  const avgScore=overall.length?Math.round(overall.reduce((a,c)=>a+({A:4,B:3,C:2,D:1,F:0}[c.g]||0),0)/overall.length*25):0;
  const overallGrade=avgScore>=90?'A':avgScore>=70?'B':avgScore>=50?'C':avgScore>=30?'D':'F';
  const overallColor=avgScore>=90?'var(--green)':avgScore>=70?'var(--blue)':avgScore>=50?'var(--amber)':'var(--red)';
  container.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
      <div style="width:52px;height:52px;border-radius:14px;background:${overallColor};display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;color:#fff;font-family:'DM Mono',monospace;">${overallGrade}</div>
      <div><div style="font-size:14px;font-weight:700;">이번 기간 성적표</div><div style="font-size:11px;color:var(--text3);margin-top:2px;">${rows.length}일 기준 종합 평가</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${cats.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border-radius:8px;">
        <div style="font-size:14px;">${c.icon}</div>
        <div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;color:var(--text);">${c.name}</div><div style="font-size:9px;color:var(--text3);">${c.sub}</div></div>
        <div style="font-size:18px;font-weight:800;color:${c.c};font-family:'DM Mono',monospace;">${c.g}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

export function stRenderPtsBreakdown(rows){
  const card=document.getElementById('st-pts-breakdown-card');
  const container=document.getElementById('st-pts-breakdown');
  const catMap={};
  rows.forEach(r=>{
    (r.points_log||[]).forEach(p=>{
      const t=p.type||'other';
      let cat='기타';
      if(t.startsWith('workout')||t==='pushup_challenge')cat='운동';
      else if(t.startsWith('diet')||t.startsWith('cheat'))cat='식단';
      else if(t.startsWith('routine'))cat='루틴';
      else if(t.startsWith('target'))cat='할일';
      else if(t.startsWith('weight'))cat='체중';
      else if(t==='cold_shower'||t==='early_rise')cat='챌린지';
      catMap[cat]=(catMap[cat]||0)+(p.pts||0);
    });
  });
  const entries=Object.entries(catMap).filter(([,v])=>v!==0).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  if(!entries.length){card.style.display='none';return;}
  card.style.display='';
  const totalPos=entries.reduce((a,[,v])=>a+(v>0?v:0),0);
  const colors={'운동':'#ff4d4d','식단':'#34d399','루틴':'#38bdf8','할일':'#f59e0b','체중':'#a78bfa','챌린지':'#fb923c','기타':'#6b6b78'};
  let html='<div style="padding:12px 14px;">';
  html+='<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:14px;gap:1px;">';
  entries.filter(([,v])=>v>0).forEach(([name,v])=>{
    const pct=Math.max(2,Math.round(v/totalPos*100));
    html+=`<div style="width:${pct}%;background:${colors[name]||'#6b6b78'};"></div>`;
  });
  html+='</div><div style="display:flex;flex-direction:column;gap:6px;">';
  entries.forEach(([name,v])=>{
    const col=colors[name]||'#6b6b78';
    const sign=v>0?'+':'';
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:2px;background:${col};flex-shrink:0;"></div>
        <span style="font-size:12px;font-weight:600;color:var(--text);">${name}</span>
      </div>
      <span style="font-size:12px;font-weight:700;color:${v>=0?'var(--green)':'var(--red)'};font-family:'DM Mono',monospace;">${sign}${v}pt</span>
    </div>`;
  });
  html+='</div></div>';
  container.innerHTML=html;
}

export function stRenderMealQuality(rows){
  const card=document.getElementById('st-meal-quality-card');
  const canvas=document.getElementById('st-chart-meal-quality');
  const metaEl=document.getElementById('st-meal-quality-meta');
  const scoreMap={green:3,normal:2,cheat:1,red:0,alcohol:0};
  const pts=rows.map(r=>{
    const meals=(r.meals||[]).filter(m=>['아침','점심','저녁'].includes(m.time)&&m.type);
    if(!meals.length)return null;
    const avg=meals.reduce((a,m)=>a+(scoreMap[m.type]??1),0)/meals.length;
    return{x:r._key,y:Math.round(avg*100)/100};
  }).filter(Boolean);
  // Show the card even with little data so the primary insight per tab
  // stays visible. Empty state handled inline below.
  card.style.display='';
  if(!pts.length){
    if(canvas)canvas.style.display='none';
    if(metaEl)metaEl.innerHTML='<div style="font-size:12px;color:var(--text3);padding:16px 0;text-align:center;">아직 클린식 기록이 부족해요</div>';
    return;
  }
  if(canvas)canvas.style.display='block';
  const vals=pts.map(p=>p.y);
  const avg=(vals.reduce((a,v)=>a+v,0)/vals.length).toFixed(1);
  const recent7=vals.slice(-7);const recent7Avg=recent7.length?(recent7.reduce((a,v)=>a+v,0)/recent7.length).toFixed(1):'—';
  stHeadline('st-meal-quality-meta',[
    {label:'평균 품질',value:avg,unit:'/3'},
    {label:'최근 7일',value:recent7Avg,unit:'/3'},
    {label:'기록일',value:pts.length,unit:'일'}
  ]);
  stDestroyChart('mealquality');
  stCharts.mealquality=new window.Chart(canvas,{
    type:'line',
    data:{labels:pts.map(p=>p.x.slice(5).replace('-','/')),datasets:[{
      data:vals,borderColor:'#34d399',borderWidth:2.5,
      backgroundColor:ctx=>stGradient(ctx.chart.ctx,'52,211,153',[[0,0.25],[1,0.0]]),
      pointRadius:0,pointHoverRadius:6,pointHoverBorderColor:'#fff',pointHoverBackgroundColor:'#34d399',
      fill:true,tension:0.4
    }]},
    options:{...stDashCfg({
      yCallback:v=>v.toFixed(1),
      yScale:{min:0,max:3},
      tooltip:{label:ctx=>{const v=ctx.parsed.y;return v>=2.5?'클린 중심 ('+v.toFixed(1)+')':v>=1.5?'일반 수준 ('+v.toFixed(1)+')':'개선 필요 ('+v.toFixed(1)+')';}}
    }),plugins:{...stDashCfg().plugins,stTargetLine:{value:2.0,color:'rgba(52,211,153,0.4)',label:'목표 2.0'}}}
  });
}

export function stRenderMuscleDist(rows){
  const card=document.getElementById('st-muscle-dist-card');
  const container=document.getElementById('st-muscle-dist');
  const muscleVol={};
  rows.forEach(r=>{
    (r.workouts||[]).filter(w=>w.type==='gym'&&w.status==='done').forEach(w=>{
      (w.exercises||[]).forEach(ex=>{
        const muscle=ex.muscle||'기타';
        const vol=(ex.sets||[]).filter(s=>s.done).reduce((a,s)=>a+(parseFloat(s.kg)||0)*(parseInt(s.reps)||0),0);
        if(vol>0){muscleVol[muscle]=(muscleVol[muscle]||0)+vol;}
      });
    });
  });
  const entries=Object.entries(muscleVol).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){card.style.display='none';return;}
  card.style.display='';
  const total=entries.reduce((a,[,v])=>a+v,0);
  const colors={'가슴':'#ff4d4d','등':'#38bdf8','어깨':'#f59e0b','하체':'#34d399','팔':'#a78bfa','복근':'#fb923c','전신':'#6b6b78','유산소':'#22d3ee'};
  let html='<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px;">';
  entries.forEach(([name,vol])=>{
    const pct=Math.round(vol/total*100);
    const col=colors[name]||'var(--text2)';
    const fmt=vol>=1000?(vol/1000).toFixed(1)+'t':Math.round(vol).toLocaleString()+'kg';
    html+=`<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
        <span style="font-size:12px;font-weight:600;color:var(--text);">${name}</span>
        <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${fmt} · ${pct}%</span>
      </div>
      <div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .4s ease;"></div>
      </div>
    </div>`;
  });
  html+='</div>';
  container.innerHTML=html;
}

export function stRenderPRDashboard(rows){
  const card=document.getElementById('st-pr-card');
  const list=document.getElementById('st-pr-list');
  const meta=document.getElementById('st-pr-meta');
  const allRows=(_stData||rows).slice();
  const idx=buildExerciseIndex(allRows);
  const prs=[];
  Object.entries(idx).forEach(([name,ex])=>{
    if(ex.kind!=='gym'||!ex.isStr)return;
    let bestKg=0,bestE1=0,bestVol=0,bestDate='';
    ex.sessions.forEach(s=>{
      if(s.topKg>bestKg){bestKg=s.topKg;bestDate=s.date;}
      if(s.bestE1>bestE1)bestE1=s.bestE1;
      if(s.volume>bestVol)bestVol=s.volume;
    });
    if(bestKg>0)prs.push({name,icon:ex.icon,bestKg,bestE1,bestVol,bestDate,sessions:ex.sessionCount});
  });
  prs.sort((a,b)=>b.bestKg-a.bestKg);
  if(!prs.length){card.style.display='none';return;}
  card.style.display='';
  meta.textContent=prs.length+'개 종목 · 전체 기간 기준';
  list.innerHTML=prs.slice(0,15).map(pr=>{
    const e1Str=pr.bestE1>0?'e1RM '+Math.round(pr.bestE1)+'kg':'';
    return`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);">
      <div style="flex-shrink:0;">${exIcon(pr.name,44)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pr.name}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:1px;">${pr.sessions}회 수행${e1Str?' · '+e1Str:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:16px;font-weight:800;color:var(--accent);font-family:'DM Mono',monospace;">${pr.bestKg}kg</div>
        <div style="font-size:9px;color:var(--text3);font-family:'DM Mono',monospace;">${pr.bestDate.slice(5).replace('-','/')}</div>
      </div>
    </div>`;
  }).join('');
}

export function stRenderBodyComp(rows){
  const card=document.getElementById('st-bodycomp-card');
  const canvas=document.getElementById('st-chart-bodycomp');
  const metaEl=document.getElementById('st-bodycomp-meta');
  const musclePts=rows.filter(r=>r.muscle_mass!=null).map(r=>({x:r._key,y:parseFloat(r.muscle_mass)}));
  const fatPts=rows.filter(r=>r.body_fat_pct!=null).map(r=>({x:r._key,y:parseFloat(r.body_fat_pct)}));
  if(!musclePts.length&&!fatPts.length){card.style.display='none';return;}
  card.style.display='';
  const allDates=[...new Set([...musclePts.map(p=>p.x),...fatPts.map(p=>p.x)])].sort();
  const muscleMap=Object.fromEntries(musclePts.map(p=>[p.x,p.y]));
  const fatMap=Object.fromEntries(fatPts.map(p=>[p.x,p.y]));
  const labels=allDates.map(d=>d.slice(5).replace('-','/'));
  const muscleData=allDates.map(d=>muscleMap[d]??null);
  const fatData=allDates.map(d=>fatMap[d]??null);
  const parts=[];
  if(musclePts.length){const v=musclePts[musclePts.length-1].y;const d=v-musclePts[0].y;parts.push({label:'골격근',value:v.toFixed(1),unit:'kg',delta:d!==0?('<span class="stats-delta '+(d>0?'up':'down')+'">'+(d>0?'▲':'▼')+Math.abs(d).toFixed(1)+'</span>'):''});}
  if(fatPts.length){const v=fatPts[fatPts.length-1].y;const d=v-fatPts[0].y;parts.push({label:'체지방',value:v.toFixed(1),unit:'%',delta:d!==0?('<span class="stats-delta '+(d<0?'up':'down')+'">'+(d>0?'▲':'▼')+Math.abs(d).toFixed(1)+'</span>'):''});}
  stHeadline('st-bodycomp-meta',parts);
  stDestroyChart('bodycomp');
  const datasets=[];
  if(musclePts.length)datasets.push({label:'골격근 (kg)',data:muscleData,borderColor:'#38bdf8',borderWidth:2.5,backgroundColor:'transparent',pointRadius:3,pointBackgroundColor:'#38bdf8',tension:0.4,yAxisID:'y',spanGaps:true});
  if(fatPts.length)datasets.push({label:'체지방 (%)',data:fatData,borderColor:'#f59e0b',borderWidth:2,borderDash:[4,3],backgroundColor:'transparent',pointRadius:3,pointBackgroundColor:'#f59e0b',tension:0.4,yAxisID:'y1',spanGaps:true});
  const c=getChartColors();
  stCharts.bodycomp=new window.Chart(canvas,{
    type:'line',data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:400},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,position:'top',labels:{color:c.text,boxWidth:10,font:{size:11,family:"'DM Sans',sans-serif"}}},tooltip:{backgroundColor:'rgba(10,10,12,.9)',titleColor:'#eee',bodyColor:'#ccc',borderColor:c.grid,borderWidth:1,padding:10,bodyFont:{family:"'DM Sans',sans-serif"},titleFont:{family:"'DM Sans',sans-serif"}}},
      scales:{x:{ticks:{color:c.text,font:{size:9,family:"'DM Sans',sans-serif"},maxRotation:0,autoSkip:true,maxTicksLimit:8},grid:{display:false}},
        y:{position:'left',ticks:{color:'#38bdf8',font:{size:10},callback:v=>v+'kg'},grid:{color:c.grid}},
        y1:{position:'right',ticks:{color:'#f59e0b',font:{size:10},callback:v=>v+'%'},grid:{display:false}}
      }
    }
  });
}

export function stRenderRoutineBreakdown(rows){
  const card=document.getElementById('st-routine-breakdown-card');
  const container=document.getElementById('st-routine-breakdown');
  const itemMap={};
  const sortedDates=rows.map(r=>r._key).sort();
  rows.forEach(r=>{
    (r.mandatory||[]).forEach(m=>{
      if(!m.name)return;
      if(!itemMap[m.name])itemMap[m.name]={done:0,total:0,dates:{}};
      itemMap[m.name].total++;
      if(m.done){itemMap[m.name].done++;itemMap[m.name].dates[r._key]=true;}
    });
  });
  const items=Object.entries(itemMap).filter(([,v])=>v.total>=2).sort((a,b)=>b[1].total-a[1].total);
  if(!items.length){card.style.display='none';return;}
  card.style.display='';
  let html='<div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">';
  items.forEach(([name,data])=>{
    const pct=Math.round(data.done/data.total*100);
    const col=pct>=80?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
    let streak=0,maxStreak=0;
    sortedDates.forEach(d=>{
      const dayItems=rows.find(r=>r._key===d)?.mandatory||[];
      const item=dayItems.find(m=>m.name===name);
      if(item){if(item.done){streak++;maxStreak=Math.max(maxStreak,streak);}else{streak=0;}}
    });
    html+=`<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span style="font-size:11px;color:var(--text3);">🔥${maxStreak>0?maxStreak:'-'}일</span>
          <span style="font-size:12px;font-weight:700;color:${col};">${pct}%</span>
        </div>
      </div>
      <div style="height:5px;background:var(--surface3);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .4s ease;"></div>
      </div>
    </div>`;
  });
  html+='</div>';
  container.innerHTML=html;
}

export function stRenderMealHeatmap(rows){
  const slots=['아침','점심','저녁'];
  const dayNames=['월','화','수','목','금','토','일'];
  const colorMap={green:'rgba(52,211,153,0.75)',normal:'rgba(136,136,136,0.5)',cheat:'rgba(245,158,11,0.65)',red:'rgba(255,77,77,0.6)',alcohol:'rgba(255,77,77,0.6)',null:'rgba(42,42,50,0.8)'};

  const maxCells=Math.min(rows.length, stPeriod||21);
  const recent=rows.slice(-maxCells);
  const empty=document.getElementById('st-meal-empty');
  const container=document.getElementById('st-meal-heatmap');
  if(!recent.length){empty.style.display='block';container.innerHTML='';document.getElementById('st-meal-meta').textContent='';return;}
  empty.style.display='none';

  let totalMeals=0,cleanMeals=0,normalMeals=0,cheatMeals=0,badMeals=0;
  rows.forEach(r=>{
    const ms=(r.meals||[]).filter(m=>slots.includes(m.time)&&m.type);
    totalMeals+=ms.length;
    ms.forEach(m=>{
      if(m.type==='green')cleanMeals++;
      else if(m.type==='cheat')cheatMeals++;
      else if(m.type==='red'||m.type==='alcohol')badMeals++;
      else normalMeals++;
    });
  });
  const cleanPct=totalMeals>0?Math.round(cleanMeals/totalMeals*100):0;
  const metaEl=document.getElementById('st-meal-meta');
  if(metaEl)metaEl.innerHTML=`
    <div class="stats-headline">
      <div class="stats-headline-cell"><div class="stats-headline-label">클린</div><div class="stats-headline-val" style="color:#34d399;">${cleanMeals}<span class="stats-headline-unit">끼</span></div></div>
      <div class="stats-headline-cell"><div class="stats-headline-label">일반</div><div class="stats-headline-val" style="color:#888;">${normalMeals}<span class="stats-headline-unit">끼</span></div></div>
      <div class="stats-headline-cell"><div class="stats-headline-label">치팅</div><div class="stats-headline-val" style="color:#f59e0b;">${cheatMeals}<span class="stats-headline-unit">끼</span></div></div>
      <div class="stats-headline-cell"><div class="stats-headline-label">금지</div><div class="stats-headline-val" style="color:#ff4d4d;">${badMeals}<span class="stats-headline-unit">끼</span></div></div>
      <div class="stats-headline-cell"><div class="stats-headline-label">클린%</div><div class="stats-headline-val" style="color:#34d399;">${cleanPct}<span class="stats-headline-unit">%</span></div></div>
    </div>`;

  // 헤더
  let html='<div style="display:flex;gap:2px;margin-bottom:4px;">';
  html+='<div style="width:24px;flex-shrink:0;"></div>';
  slots.forEach(s=>html+=`<div style="flex:1;text-align:center;font-size:9px;color:var(--text3);font-weight:500;">${s}</div>`);
  html+='</div>';

  recent.forEach(r=>{
    const d=new Date(r._key+'T00:00:00');
    const dayLabel=dayNames[(d.getDay()+6)%7];
    const isToday=r._key===TODAY;
    html+=`<div style="display:flex;gap:2px;margin-bottom:2px;align-items:center;">`;
    html+=`<div style="width:24px;flex-shrink:0;font-size:9px;color:${isToday?'var(--accent)':'var(--text3)'};text-align:right;padding-right:4px;font-weight:${isToday?700:400};">${dayLabel}</div>`;
    slots.forEach(slot=>{
      const meal=(r.meals||[]).find(m=>m.time===slot&&m.type);
      const bg=meal?colorMap[meal.type]||colorMap.normal:colorMap.null;
      const border=meal?'none':'0.5px solid rgba(255,255,255,0.06)';
      html+=`<div style="flex:1;height:22px;border-radius:3px;background:${bg};border:${border};"></div>`;
    });
    html+='</div>';
  });

  container.innerHTML=html;
}

export function stRenderScoreChart(rows){
  const daily=rows.map(r=>({x:r._key,y:(r.points_log||[]).reduce((a,e)=>a+(e.pts||0),0)}));
  const activePts=daily.filter(p=>p.y!==0);
  const empty=document.getElementById('st-score-empty');
  const canvas=document.getElementById('st-chart-score');
  const metaEl=document.getElementById('st-score-meta');
  if(!activePts.length){empty.style.display='block';canvas.style.display='none';if(metaEl)metaEl.innerHTML='';return;}
  empty.style.display='none';canvas.style.display='block';
  let cum=0;
  const cumPts=daily.map(p=>{cum+=p.y;return{x:p.x,y:cum};});
  const total=cumPts[cumPts.length-1]?.y||0;
  const avg=activePts.length?Math.round(activePts.reduce((a,p)=>a+p.y,0)/activePts.length):0;
  const best=activePts.reduce((m,p)=>p.y>m.y?p:m,{y:-Infinity});
  const prevRows=stPrevRows(rows);
  const prevTotal=prevRows.reduce((a,r)=>a+(r.points_log||[]).reduce((b,e)=>b+(e.pts||0),0),0);
  stHeadline('st-score-meta',[
    {label:'누적',value:(total>=0?'+':'')+total,unit:'pt',delta:stDelta(total,prevTotal)},
    {label:'일평균',value:(avg>=0?'+':'')+avg,unit:'pt'},
    {label:'최고일',value:(best.y>=0?'+':'')+best.y,unit:'pt'}
  ]);
  stDestroyChart('score');
  stCharts.score=new window.Chart(canvas,{
    type:'line',
    data:{
      labels:cumPts.map(p=>p.x.slice(5).replace('-','/')),
      datasets:[{
        data:cumPts.map(p=>p.y),borderColor:'#ff4d4d',borderWidth:2.8,
        backgroundColor:ctx=>stGradient(ctx.chart.ctx,'255,77,77',[[0,0.45],[0.6,0.08],[1,0.0]]),
        pointRadius:0,pointHoverRadius:7,pointHoverBorderColor:'#fff',pointHoverBorderWidth:2,pointHoverBackgroundColor:'#ff4d4d',
        fill:true,tension:0.4
      }]
    },
    options:stDashCfg({
      yCallback:v=>v+'pt',
      tooltip:{label:ctx=>(ctx.parsed.y>=0?'+':'')+ctx.parsed.y+'pt (누적)'}
    })
  });
}



