// Stay Hard · weekly view (주간 탭)
//
// Grid-based calendar of last N weeks with per-category cells (weight/meal/
// workout/routine/tasks). Tap cells to open wv-mini-modal for quick edits.
//
// State: module-local (wvOffset, wvLogs, wvLoadedOffsets, etc.).
// Inline deps via window.*: window.logCache, log, window.CU, window.selectedKey, window.now, renderRoutine,
// updateGogginsHeader, queueSave, saveLog, addScore, applyMealScore,
// renderMandatory, closeModal, track, etc.

import { sb } from '../../lib/supabase.js';
import { dkey } from '../../lib/date.js';
import { ico } from '../../lib/icons.js';
import { showToast } from '../../ui/toast.js';

// Module-local state (moved from inline index.html around line 4678 / ~12031)
let wvOffset = 0;
let wvLogs = {};
let wvMmContext = null;

const MKEYS=['weight','breakfast','lunch','dinner','workout','mandatory'];
const MLABELS=['체중 (kg)','아침','점심','저녁','운동','필수'];
export function wvWeekDates(offset){const d=new Date(window.now);d.setDate(d.getDate()-((d.getDay()+6)%7)+offset*7);d.setHours(0,0,0,0);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return x;});}

const WV_CATS=[
  {key:'weight', ico:ico('scale',13),      lbl:'체중'},
  {key:'meal',   ico:ico('leaf',13),       lbl:'식단'},
  {key:'workout',ico:ico('dumbbell',13),   lbl:'운동'},
  {key:'routine',ico:ico('checkCircle',13),lbl:'루틴'},
  {key:'tasks',  ico:ico('target',13),     lbl:'할일'},
];
let wvLoadedOffsets=new Set();
let wvLoadingMore=false;
let wvMaxLoadedOffset=0;
let wvAllDates=[];

export function wvCellClass(dl,cat,isFuture){
  if(isFuture)return'future';
  if(!dl)return'empty';
  if(cat==='weight')return dl.weight?'pass':'fail';
  if(cat==='workout'){const wos=dl.workouts||[];return wos.some(w=>w.status==='done')?'pass':'fail';}
  if(cat==='meal'){const meals=dl.meals||[];if(!meals.length)return'fail';const bad=meals.filter(m=>m.type==='red').length;const good=meals.filter(m=>m.type==='green'||m.type==='normal').length;return bad>0&&good>0?'partial':bad>0?'fail':'pass';}
  if(cat==='routine'){const mand=dl.mandatory||[];if(!mand.length)return'empty';const done=mand.filter(m=>m.done).length;return done===mand.length?'pass':done===0?'fail':'partial';}
  if(cat==='tasks'){const tgts=dl.targets||[];if(!tgts.length)return'empty';const done=tgts.filter(t=>t.st==='done').length;return done===tgts.length?'pass':done===0?'fail':'partial';}
  return'empty';
}
export function wvCellLabel(dl,cat,isFuture){
  if(isFuture||!dl)return'';
  if(cat==='weight')return dl.weight?parseFloat(dl.weight).toFixed(1):'—';
  if(cat==='workout'){const wos=(dl.workouts||[]).filter(w=>w.status==='done');if(!wos.length)return'✕';const vol=wos.filter(w=>w.type==='gym').reduce((a,w)=>a+(w.totalVolume||0),0);return vol>=1000?(vol/1000).toFixed(1)+'t':vol>0?vol+'kg':'✓';}
  if(cat==='meal'){const meals=dl.meals||[];return meals.length?meals.length+'끼':'—';}
  if(cat==='routine'){const mand=dl.mandatory||[];if(!mand.length)return'—';return mand.filter(m=>m.done).length+'/'+mand.length;}
  if(cat==='tasks'){const tgts=dl.targets||[];if(!tgts.length)return'—';return tgts.filter(t=>t.st==='done').length+'/'+tgts.length;}
  return'—';
}

const WV_LABEL_W=52;
const WV_DAY_W=46;
const WV_GAP=3;

export function wvBuildGrid(){
  const grid=document.getElementById('wv-grid');
  if(!grid)return;
  const DAY_NAMES=['월','화','수','목','금','토','일'];
  const labelBase='display:table-cell;vertical-align:middle;position:sticky;left:0;z-index:2;background:var(--bg);width:'+WV_LABEL_W+'px;min-width:'+WV_LABEL_W+'px;';
  const dayBase='display:table-cell;vertical-align:middle;width:'+WV_DAY_W+'px;min-width:'+WV_DAY_W+'px;padding:'+(WV_GAP/2)+'px '+(WV_GAP/2)+'px;';

  // ROW 1: day names
  let r1='<div style="display:table-row;">';
  r1+='<div style="'+labelBase+'padding:0 4px 2px;border-bottom:1px solid rgba(255,255,255,0.07);"></div>';
  wvAllDates.forEach((d,i)=>{
    const k=dkey(d);const isT=k===window.TODAY;
    const dayIdx=(d.getDay()+6)%7;const isMon=dayIdx===0&&i>0;
    r1+='<div style="'+dayBase+'text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);'+(isMon?'border-left:1px solid rgba(255,255,255,0.1);':'')+'">'+
      '<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:'+(isT?'var(--accent)':'var(--text2)')+';">'+DAY_NAMES[dayIdx]+'</div></div>';
  });
  r1+='</div>';

  // ROW 2: date numbers
  let r2='<div style="display:table-row;">';
  r2+='<div style="'+labelBase+'padding:0 4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);"></div>';
  wvAllDates.forEach((d,i)=>{
    const k=dkey(d);const isT=k===window.TODAY;
    const dayIdx=(d.getDay()+6)%7;const isMon=dayIdx===0&&i>0;
    // show month label: first cell, every Monday, or any date=1
    const prevD=i>0?wvAllDates[i-1]:null;
    const showMonth=i===0||isMon||d.getDate()===1;
    // only show month text when month actually changes or at start
    const monthChanged=!prevD||prevD.getMonth()!==d.getMonth();
    const showMonthLabel=showMonth&&(i===0||monthChanged||isMon);
    r2+='<div style="'+dayBase+'text-align:center;border-bottom:1px solid rgba(255,255,255,0.12);'+(isMon?'border-left:1px solid rgba(255,255,255,0.1);':'')+'">'
      +(showMonthLabel?'<div style="font-size:9px;color:var(--accent);font-weight:700;margin-bottom:1px;opacity:.8;">'+(d.getMonth()+1)+'월</div>':'<div style="font-size:9px;margin-bottom:1px;opacity:0;">·</div>')
      +'<div style="width:24px;height:24px;border-radius:50%;background:'+(isT?'var(--accent)':'transparent')+';margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:'+(isT?'#fff':'var(--text2)')+';">'+d.getDate()+'</div></div>';
  });
  r2+='</div>';

  // ROW 3: dot strip
  let r3='<div style="display:table-row;">';
  r3+='<div style="'+labelBase+'padding:6px 4px 6px 6px;border-bottom:1px solid rgba(255,255,255,0.07);"><div style="font-size:8px;color:var(--text3);text-align:center;opacity:.5;">●</div></div>';
  wvAllDates.forEach((d,i)=>{
    const k=dkey(d);const dl=wvLogs[k];
    const isFuture=d>window.now&&k!==window.TODAY;
    const dayIdx=(d.getDay()+6)%7;const isMon=dayIdx===0&&i>0;
    const dots=WV_CATS.map(c=>{
      const cls=wvCellClass(dl,c.key,isFuture);
      const bg=isFuture?'rgba(255,255,255,0.05)':cls==='pass'?'#34d399':cls==='fail'?'#ff4d4d':cls==='partial'?'#f59e0b':'rgba(255,255,255,0.08)';
      return'<div style="height:4px;border-radius:2px;background:'+bg+';margin:2px 0;"></div>';
    }).join('');
    r3+='<div onclick="wvShowDetail(\''+k+'\','+d.getTime()+')" style="'+dayBase+'cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.07);'+(isMon?'border-left:1px solid rgba(255,255,255,0.1);':'')+
      '"><div style="padding:2px;">'+dots+'</div></div>';
  });
  r3+='</div>';

  // ROWS 4+: category rows
  const catRows=WV_CATS.map(cat=>{
    let row='<div style="display:table-row;">';
    row+='<div style="'+labelBase+'padding:3px 6px;border-bottom:1px solid rgba(255,255,255,0.05);">'+
      '<div style="display:flex;align-items:center;gap:5px;color:var(--text2);">'+cat.ico+
      '<span style="font-size:9px;color:var(--text3);font-weight:500;white-space:nowrap;">'+cat.lbl+'</span></div></div>';
    wvAllDates.forEach((d,i)=>{
      const k=dkey(d);const dl=wvLogs[k];
      const isFuture=d>window.now&&k!==window.TODAY;const isT=k===window.TODAY;
      const cls=wvCellClass(dl,cat.key,isFuture);
      const lbl=wvCellLabel(dl,cat.key,isFuture);
      const bg=isFuture?'rgba(255,255,255,0.02)':cls==='pass'?'rgba(52,211,153,0.12)':cls==='fail'?'rgba(255,77,77,.10)':cls==='partial'?'rgba(245,158,11,0.12)':'rgba(255,255,255,0.04)';
      const col=isFuture?'transparent':cls==='pass'?'#34d399':cls==='fail'?'#ff4d4d':cls==='partial'?'#f59e0b':'var(--text3)';
      const bd=isT?'var(--accent)':cls==='pass'?'rgba(52,211,153,0.3)':cls==='fail'?'rgba(255,77,77,0.28)':cls==='partial'?'rgba(245,158,11,0.28)':'rgba(255,255,255,0.07)';
      const dayIdx=(d.getDay()+6)%7;const isMon=dayIdx===0&&i>0;
      row+='<div onclick="wvShowDetail(\''+k+'\','+d.getTime()+')" style="'+dayBase+'border-bottom:1px solid rgba(255,255,255,0.05);'+(isMon?'border-left:1px solid rgba(255,255,255,0.1);':'')+'">'+
        '<div style="height:26px;border-radius:5px;background:'+bg+';border:1px solid '+bd+';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:'+col+';cursor:pointer;">'+lbl+'</div></div>';
    });
    row+='</div>';
    return row;
  }).join('');

  grid.innerHTML=r1+r2+r3+catRows;
}

export async function fetchWeekLogs(dates){
  if(!dates||!dates.length)return;
  // 범위 쿼리: dates 배열이 몇 주 분량이든 단일 쿼리로 처리 (기존엔 주 단위 직렬 호출)
  const from=dkey(dates[0]),to=dkey(dates[dates.length-1]);
  // 필요한 컬럼만 select — 첫 페인트 지연 감소
  const{data}=await sb.from('daily_logs')
    .select('log_date,weight,muscle_mass,body_fat_pct,water_cups,meals,workouts,mandatory,targets,points_log')
    .eq('user_id',window.CU.id).gte('log_date',from).lte('log_date',to);
  if(data)data.forEach(d=>{
    const nk=normKey(d.log_date);
    if(window._dirtyKeys.has(nk)){if(window.logCache[nk])wvLogs[nk]=JSON.parse(JSON.stringify(window.logCache[nk]));return;}
    const existing=window.logCache[nk];
    const parsed={
      weight:d.weight!==null?parseFloat(d.weight):null,
      muscle_mass:d.muscle_mass!=null?parseFloat(d.muscle_mass):null,
      body_fat_pct:d.body_fat_pct!=null?parseFloat(d.body_fat_pct):null,
      water_cups:d.water_cups||0,
      meals:d.meals||[],
      workouts:d.workouts||[],
      mandatory:d.mandatory||[],
      targets:d.targets||[],
      _ptsLog:existing?._ptsLog||d.points_log||[]
    };
    window.logCache[nk]=parsed;
    wvLogs[nk]=JSON.parse(JSON.stringify(parsed));
  });
}

export async function renderWeeklyView(){
  clearTimeout(_saveTimer);await _flushSave();
  wvLogs={};wvLoadedOffsets=new Set();wvLoadingMore=false;wvAllDates=[];
  // 최근 4주(28일) 날짜 선계산 — 오래된 날짜가 왼쪽, 오늘/이번주가 오른쪽
  const allDates=[];
  for(let off=-3;off<=0;off++){
    const dates=wvWeekDates(off);
    allDates.push(...dates);
    wvLoadedOffsets.add(off);
  }
  wvAllDates=allDates;
  wvMaxLoadedOffset=-3;
  // 1) 캐시 우선 렌더: window.logCache에 이미 있는 날짜는 즉시 화면에 뿌림 (N+1 RTT 제거)
  let hasCached=false;
  allDates.forEach(d=>{
    const k=dkey(d);
    if(window.logCache[k]){wvLogs[k]=JSON.parse(JSON.stringify(window.logCache[k]));hasCached=true;}
  });
  wvBuildGrid();
  const outer=document.getElementById('wv-scroll-outer');
  if(outer){
    requestAnimationFrame(()=>{outer.scrollLeft=outer.scrollWidth;});
  }
  // 2) 백그라운드 갱신 (stale-while-revalidate) — 4주 전체를 단일 쿼리로
  try{
    await fetchWeekLogs(allDates);
    wvBuildGrid();
    if(outer&&!hasCached){
      requestAnimationFrame(()=>{outer.scrollLeft=outer.scrollWidth;});
    }
  }catch(e){console.warn('weekly fetch failed:',e);}
}

let _wvScrollTimer=null;
export function wvOnScroll(el){
  if(wvLoadingMore)return;
  // Older dates are on the LEFT → load more when the user scrolls near the left edge.
  if(el.scrollLeft>120)return;
  clearTimeout(_wvScrollTimer);
  _wvScrollTimer=setTimeout(()=>_wvLoadMore(el),200);
}
export async function _wvLoadMore(el){
  if(wvLoadingMore)return;
  if(el.scrollLeft>120)return;
  if(wvMaxLoadedOffset<=-52)return;
  wvLoadingMore=true;
  const prevScrollWidth=el.scrollWidth;
  const nextOff=wvMaxLoadedOffset-1;
  const dates=wvWeekDates(nextOff);
  // 1) 캐시 우선 즉시 렌더
  let allCached=true;
  dates.forEach(d=>{
    const k=dkey(d);
    if(window.logCache[k])wvLogs[k]=JSON.parse(JSON.stringify(window.logCache[k]));
    else allCached=false;
  });
  wvAllDates.unshift(...dates);
  wvLoadedOffsets.add(nextOff);wvMaxLoadedOffset=nextOff;
  wvBuildGrid();
  requestAnimationFrame(()=>{el.scrollLeft+=el.scrollWidth-prevScrollWidth;});
  // 2) 네트워크 갱신 (캐시 없는 날짜만 있어도 전체 주를 한 번에)
  if(!allCached){
    try{
      const w0=el.scrollWidth;
      await fetchWeekLogs(dates);
      wvBuildGrid();
      requestAnimationFrame(()=>{el.scrollLeft+=el.scrollWidth-w0;});
    }catch(e){console.warn('weekly load-more failed:',e);}
  }
  requestAnimationFrame(()=>{wvLoadingMore=false;});
}

export function shiftWVWeek(dir){wvOffset+=dir;renderWeeklyView();}

export function wvShowDetail(k,ts){
  const d=new Date(ts);
  jumpToDateFromWeekly(k,d.getFullYear(),d.getMonth(),d.getDate());
}


// ── COMPETITION ──

// ── Block B: weekly mini-modal + tap handlers ──
export function wvMmOpen(label,placeholder,currentVal,context,anchorEl){
  wvMmContext=context;
  document.getElementById('wv-mm-label').textContent=label;
  const inp=document.getElementById('wv-mm-inp');
  inp.placeholder=placeholder;
  inp.value=currentVal||'';
  inp.type=context.inputType||'text';
  // Show day pills for routine add
  const daysDiv=document.getElementById('wv-mm-days');
  if(context.type==='mand-add'){
    daysDiv.style.display='block';
    // Reset all to on
    document.querySelectorAll('.wv-day-pill').forEach(p=>p.classList.add('on'));
  } else {
    daysDiv.style.display='none';
  }
  const modal=document.getElementById('wv-mini-modal');
  modal.classList.add('open');
  const rect=anchorEl.getBoundingClientRect?anchorEl.getBoundingClientRect():{left:100,bottom:200};
  let left=rect.left+window.scrollX;
  let top=rect.bottom+window.scrollY+4;
  if(left+200>window.innerWidth)left=window.innerWidth-208;
  if(left<4)left=4;
  modal.style.left=left+'px';
  modal.style.top=top+'px';
  setTimeout(()=>inp.focus(),50);
}

export function wvMmClose(){
  const modal=document.getElementById('wv-mini-modal');
  if(modal)modal.classList.remove('open');
  wvMmContext=null;
}

export function wvToggleDay(el,idx){el.classList.toggle('on');}

export function wvGetSelectedDays(){
  const pills=document.querySelectorAll('.wv-day-pill');
  const days=[];
  pills.forEach((p,i)=>{if(p.classList.contains('on'))days.push(i);});
  return days.length>0?days:[0,1,2,3,4,5,6];
}

export async function wvMmSave(){
  if(!wvMmContext)return;
  const val=document.getElementById('wv-mm-inp').value.trim();
  if(!val){wvMmClose();return;}
  const k=wvMmContext.dateKey;
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  const dl=wvLogs[k];
  if(wvMmContext.type==='target-add'){
    dl.targets=dl.targets||[];
    dl.targets.push({text:val,st:''});
  } else if(wvMmContext.type==='weight'){
    dl.weight=parseFloat(val)||null;
  } else if(wvMmContext.type==='mand-add'){
    dl.mandatory=dl.mandatory||[];
    const days=wvGetSelectedDays();
    const newTask={name:val,done:false,days};
    if(!dl.mandatory.find(m=>m.name===val)){
      dl.mandatory.push(newTask);
    }
  }
  await saveWvDayLog(k,dl);
  // For routine additions, propagate to all days
  if(wvMmContext.type==='mand-add'&&dl.mandatory){
    await propagateMandatoryDefs(dl.mandatory);
  }
  wvMmClose();
  renderWeeklyView();
}

export async function saveWvDayLog(key,dl){
  if(!window.CU)return;
  const p={user_id:window.CU.id,log_date:key,weight:dl.weight,water_cups:dl.water_cups||0,
    meals:dl.meals||[],workouts:dl.workouts||[],mandatory:dl.mandatory||[],targets:dl.targets||[]};
  await sb.from('daily_logs').upsert(p,{onConflict:'user_id,log_date'});
  // Store a deep clone in window.logCache so wvLogs mutations don't affect 기록 tab state
  const clone=JSON.parse(JSON.stringify(dl));
  window.logCache[key]=clone;
  if(key===window.selectedKey){
    log=clone;
    renderTargets();
    renderMandatory();
    renderWater();
  }
}

export async function wvTapTarget(k,ti,el){
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  const dl=wvLogs[k];
  dl.targets=dl.targets||[];
  if(ti===999||ti>=dl.targets.length||!dl.targets[ti]||!dl.targets[ti].text){
    wvMmOpen('할일 추가','오늘 할 일을 입력하세요','',{type:'target-add',dateKey:k},el);
    return;
  }
  const t=dl.targets[ti];
  const cycle={'':'done','done':'fail','fail':''};
  t.st=cycle[t.st]||'';
  await saveWvDayLog(k,dl);
  renderWeeklyView();
}

export async function wvTapMand(k,mname,el){
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  const dl=wvLogs[k];
  dl.mandatory=dl.mandatory||[];
  const task=dl.mandatory.find(m=>m.name===mname);
  if(!task){return;} // task not scheduled for this day — do nothing
  task.done=!task.done;
  await saveWvDayLog(k,dl);
  renderWeeklyView();
}

export function wvTapWeight(k,currentVal,el){
  wvMmOpen('체중 기록 (kg)','예: 74.0',currentVal||'',{type:'weight',dateKey:k,inputType:'number'},el);
}

export async function wvTapWater(k,el){
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  const dl=wvLogs[k];
  dl.water_cups=((dl.water_cups||0)+1)%13;
  await saveWvDayLog(k,dl);
  renderWeeklyView();
}

export function wvTapMeal(k,yr,mo,day){
  if(confirm('기록 탭으로 이동해서 식단을 기록할까요?')){
    jumpToDateFromWeekly(k,yr,mo,day);
  }
}

export function wvTapWorkout(k,yr,mo,day){
  if(confirm('기록 탭으로 이동해서 운동을 기록할까요?')){
    jumpToDateFromWeekly(k,yr,mo,day);
  }
}

export function wvAddTgtRow(){
  const dates=wvWeekDates(wvOffset);
  const todayInWeek=dates.find(d=>dkey(d)===window.TODAY)||dates[0];
  const k=dkey(todayInWeek);
  const headers=document.querySelectorAll('.section-hdr-row td');
  const anchor=headers[headers.length-1]||document.body;
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  wvMmOpen('할일 추가 ('+(todayInWeek.getMonth()+1)+'월 '+todayInWeek.getDate()+'일)','오늘 할 일을 입력하세요','',{type:'target-add',dateKey:k},anchor);
}

export function wvAddMandRow(){
  const dates=wvWeekDates(wvOffset);
  const todayInWeek=dates.find(d=>dkey(d)===window.TODAY)||dates[0];
  const k=dkey(todayInWeek);
  const headers=document.querySelectorAll('.section-hdr-row td');
  const anchor=headers[Math.max(0,headers.length-3)]||document.body;
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  wvMmOpen('루틴 추가','루틴 이름을 입력하세요','',{type:'mand-add',dateKey:k},anchor);
}
export function wvAddMandForDay(k,el){
  if(!wvLogs[k])wvLogs[k]={weight:null,water_cups:0,meals:[],workouts:[],mandatory:[],targets:[]};
  wvMmOpen('루틴 추가','루틴 이름을 입력하세요','',{type:'mand-add',dateKey:k},el);
}

// Close mini-modal on outside click
document.addEventListener('mousedown',function(e){
  const modal=document.getElementById('wv-mini-modal');
  if(modal&&modal.classList.contains('open')&&!modal.contains(e.target)){
    wvMmClose();
  }
});
