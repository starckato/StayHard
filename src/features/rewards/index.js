// Stay Hard · rewards / penalty animations
//
// DOM-coupled animations triggered by scoring events:
//   - showWin / _showNextWin / _renderWinBody : winning pill cascade
//   - showRage : penalty rage modal
//   - showChaekpipty : rule-based cardio sentence (enqueues activity)
//   - closeRage : dismiss rage modal
//   - showSystemNotice : admin-pushed notice
//   - launchConfetti : 90-particle burst (1.2s lock)
//
// Data (RAGE_MSGS / WIN_MSGS / CHAEK_SENTENCES / RAGE_HEAVY) imported from
// src/data/reward-messages.js. Inline deps: renderWorkouts, queueSave,
// showToast — resolved via window.* at call time.

import { RAGE_MSGS, RAGE_HEAVY, WIN_MSGS, CHAEK_SENTENCES } from '../../data/reward-messages.js';
import { showToast } from '../../ui/toast.js';

export function showChaekpipty(mealName) {
  // Cube mode: 식단 금지 음식은 crimson cube 팝오버로 이미 전달. legacy rage /
  // chaek(형량) 모달 중복 표시 안 함.
  if(typeof window!=='undefined'&&window.CUBE_UI_MODE===true)return;
  // 오늘 이미 형량이 집행 중이면 중복 추가 방지
  const curLog=window.logCache[window.selectedKey]||log;
  if((curLog.workouts||[]).some(w=>w._isChaek&&w.status==='planned')){
    showToast('⚖️ 이미 형량이 집행 중입니다');
    return;
  }
  // rage 먼저 표시
  showRage();
  const pick = CHAEK_SENTENCES[Math.floor(Math.random() * CHAEK_SENTENCES.length)];
  // rage 얼굴/메시지 교체
  const faceEl = document.getElementById('rage-face');
  const msgEl = document.getElementById('rage-msg');
  if(faceEl) faceEl.textContent = '⚖️';
  if(msgEl) msgEl.textContent = pick.sentence;
  // 버튼: 형량 수락
  const closeBtn = document.querySelector('#goggins-rage .rage-close');
  if(closeBtn){
    closeBtn.textContent = '💀 형량 수락 — 운동 추가';
    closeBtn.onclick = () => {
      if(!window.logCache[window.selectedKey]) window.logCache[window.selectedKey] = log;
      window.log = window.logCache[window.selectedKey];
      window.log.workouts.push({type:'activity', icon:pick.icon, name:pick.name, cat:pick.cat, meta:pick.meta, status:'planned', _isChaek:true});
      renderWorkouts();
      queueSave();
      closeRage();
      showToast('⚖️ '+pick.name+' 형량이 추가됐어요');
    };
    // 도망 버튼
    let escBtn = document.getElementById('chaek-escape-btn');
    if(!escBtn){
      escBtn = document.createElement('button');
      escBtn.id = 'chaek-escape-btn';
      escBtn.className = 'rage-close';
      escBtn.style.cssText = 'margin-top:8px;background:transparent;color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.2);font-size:13px;padding:10px 28px;';
      closeBtn.after(escBtn);
    }
    escBtn.textContent = '도망갈게요 (형량 거부)';
    escBtn.onclick = () => {
      // 금지식단 로그 시점에 이미 -30 차감됨. 도망은 추가 페널티 없이 그 -30 유지만.
      // (형량 수락 후 완료하면 +30 회복, 거부하면 -30 그대로)
      closeRage();
      showToast('형량 거부 — -30점 유지');
    };
    escBtn.style.display = 'block';
  }
}

export function closeRage(){
  document.getElementById('goggins-rage').style.display='none';
  // 버튼 원복
  const closeBtn=document.querySelector('#goggins-rage .rage-close');
  if(closeBtn){closeBtn.textContent='알겠어, 다시 일어선다';closeBtn.onclick=closeRage;}
  const escBtn=document.getElementById('chaek-escape-btn');
  if(escBtn)escBtn.style.display='none';
}

export function showRage(){
  // Cube mode: 패널티 rage 모달 제거. crimson cube 팝오버가 담당.
  if(typeof window!=='undefined'&&window.CUBE_UI_MODE===true)return;
  // 20% 기존, 80% 강력 메시지
  let r;
  if(Math.random()<0.8){
    r=RAGE_HEAVY[Math.floor(Math.random()*RAGE_HEAVY.length)];
  } else {
    r=RAGE_MSGS[Math.floor(Math.random()*RAGE_MSGS.length)];
  }
  document.getElementById('rage-face').textContent=r.face;
  document.getElementById('rage-msg').textContent=r.msg;
  const el=document.getElementById('goggins-rage');
  el.style.display='flex';
  if(navigator.vibrate)navigator.vibrate([100,50,100,50,200]);
}

// 팡파레 큐 — 연속 호출 시 순서대로 표시
export let _winQueue=[];
export function showSystemNotice(msg){
  const existing=document.getElementById('system-notice-modal');
  if(existing)existing.remove();
  const el=document.createElement('div');
  el.id='system-notice-modal';
  el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:24px;';
  el.innerHTML=`<div style="background:var(--card);border-radius:20px;padding:28px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.4);">
    <div style="margin-bottom:12px;display:flex;justify-content:center;"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent);"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
    <div style="font-size:16px;font-weight:700;color:var(--text1);margin-bottom:12px;">공지사항</div>
    <div style="font-size:14px;color:var(--text2);line-height:1.6;white-space:pre-wrap;margin-bottom:20px;">${msg}</div>
    <button onclick="document.getElementById('system-notice-modal').remove()" style="background:var(--accent);color:#fff;border:none;border-radius:12px;padding:12px 32px;font-size:15px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">확인</button>
  </div>`;
  document.body.appendChild(el);
}

export let _winShowing=false;

export function showWin(type, pts=null, title=null){
  // Cube mode: 기존 점수 win-pill / confetti 피드백은 완전 억제. 큐브 팝오버가
  // 유일한 시각 피드백. pts===100 (goggins 100점) 는 서사적으로 중요하므로 유지.
  // 다른 모든 이벤트는 early-return.
  if(typeof window!=='undefined'&&window.CUBE_UI_MODE===true&&pts!==100)return;
  try{console.log('[showWin]',{type,pts,title,_winShowing,qlen:_winQueue.length});}catch(e){}
  if(pts===100){
    const el=document.getElementById('goggins-100');
    el.style.display='flex';
    document.body.style.overflow='hidden';
    if(navigator.vibrate)navigator.vibrate([100,50,100,50,500]);
    for(let i=0;i<120;i++)setTimeout(()=>spawnConfetti(),Math.random()*3000);
    return;
  }
  _winQueue.push({type,pts,title});
  if(!_winShowing)_showNextWin();
}

export function _showNextWin(){
  if(!_winQueue.length){_winShowing=false;return;}
  _winShowing=true;
  const{type,pts,title}=_winQueue.shift();
  try{ _renderWinBody({type,pts,title}); }
  catch(e){
    // On failure, reset queue state so subsequent shows aren't blocked forever
    console.error('[showWin] render failed — resetting queue',e);
    _winShowing=false; _winQueue.length=0;
    const el=document.getElementById('goggins-win');
    if(el)el.style.display='none';
  }
}
export function _renderWinBody({type,pts,title}){
  const EMOJIS={
    weight:'⚖️', weight_loss:'⬇️', weight_goal:'🎯',
    diet:'🥗', diet_clean:'🟢', diet_junk:'🔴',
    workout:'💥', routine:'✅', task:'📋',
    cold_shower:'🚿', early_rise:'🌅', perfect:'🏆'
  };
  const emoji=EMOJIS[type]||'✅';

  const msgs=WIN_MSGS[type]||WIN_MSGS[type==='weight'||type==='weight_loss'||type==='weight_goal'?'routine':type]||WIN_MSGS.routine;
  const msg=msgs[Math.floor(Math.random()*msgs.length)];

  const el=document.getElementById('goggins-win');
  document.getElementById('win-emoji').textContent=emoji;

  // 제목
  const titleEl=document.getElementById('win-title');
  if(titleEl&&title){titleEl.textContent=title;titleEl.style.display='block';}
  else if(titleEl){titleEl.style.display='none';}

  document.getElementById('win-msg').textContent=msg;

  const ptsEl=document.getElementById('win-pts');
  if(ptsEl&&pts){
    ptsEl.textContent='+'+pts+'점';
    ptsEl.style.fontSize=pts>=10?'32px':pts>=5?'26px':'20px';
    ptsEl.style.display='block';
  } else if(ptsEl){ptsEl.style.display='none';}

  el.style.display='flex';
  if(navigator.vibrate)navigator.vibrate(50);

  const duration=type==='perfect'?5000:2500;
  setTimeout(()=>{
    el.style.display='none';
    setTimeout(_showNextWin, 300); // 다음 팡파레
  }, duration);
}

export let _confettiLock=false;
export function launchConfetti(){
  // Cube mode: confetti 제거. 큐브 팝오버가 유일한 피드백.
  if(typeof window!=='undefined'&&window.CUBE_UI_MODE===true)return;
  if(_confettiLock)return;
  _confettiLock=true;
  setTimeout(()=>_confettiLock=false,1200);
  const colors=['#ff4d4d','#34d399','#f59e0b','#38bdf8','#ff6b35','#f0f0f0'];
  for(let i=0;i<90;i++){
    const p=document.createElement('div');
    p.className='confetti-particle';
    p.style.left=Math.random()*100+'vw';
    p.style.top='-10px';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.width=(Math.random()*8+4)+'px';
    p.style.height=(Math.random()*8+4)+'px';
    p.style.animationDuration=(Math.random()*2+2.5)+'s';
    p.style.animationDelay=(Math.random()*.8)+'s';
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),6000);
  }
}
