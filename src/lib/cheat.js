// QROK · cheat/alcohol quota helpers
//
// Reads window.CP for current profile state (cheat_used / alcohol_used).
// Pure helpers — no DOM, no side effects except persistence on cheat-use flow.

import { sb } from './supabase.js';
import { dkey } from './date.js';

export function getCheatQuota(){return 2;}
export function getCheatUsed(){return window.CP?.cheat_used||0;}
export function getCheatRemaining(){return Math.max(0,getCheatQuota()-getCheatUsed());}

// ── 음주 전용 쿼터 (주 1회) — window.CP 메모리 기반, 식사 치팅과 별도 카운트 ──
export function getAlcoholQuota(){return 1;}
export function getAlcoholUsed(){return window.CP?.alcohol_used||0;}
export function getAlcoholRemaining(){return Math.max(0,getAlcoholQuota()-getAlcoholUsed());}

// 음주 치팅 토글 상태 (모달 열려있는 동안만 유효)
let _alcoholCheatOn=false;

export async function alcoholCheatUse(){
  if(getAlcoholRemaining()<=0)return false;
  if(!window.CP)return false;
  window.CP.alcohol_used=(window.CP.alcohol_used||0)+1;
  try{
    const weekKey=getCheatWeekKey();
    localStorage.setItem('alcohol_used_'+weekKey+'_'+(window.CU?.id||''), String(window.CP.alcohol_used));
    // 당일 치팅 사용 기록 — 같은 날 추가 술/안주 자동 치팅 적용용
    localStorage.setItem('alcohol_cheat_day_'+(window.CU?.id||''), window.TODAY);
  }catch(e){}
  return true;
}

export async function alcoholCheatReturn(){
  if(!window.CP||!window.CP.alcohol_used)return;
  window.CP.alcohol_used=Math.max(0,(window.CP.alcohol_used||0)-1);
  try{
    const weekKey=getCheatWeekKey();
    localStorage.setItem('alcohol_used_'+weekKey+'_'+(window.CU?.id||''), String(window.CP.alcohol_used));
    // 당일 치팅 기록도 취소 (모든 음주 삭제 시)
    const todayAlcohol=(window.log.meals||[]).filter(m=>m.category==='alcohol'&&m._alcoholCheat).length;
    if(todayAlcohol<=0)localStorage.removeItem('alcohol_cheat_day_'+(window.CU?.id||''));
  }catch(e){}
}

// 오늘 이미 음주 치팅을 사용했는지 확인
export function isTodayAlcoholCheatUsed(){
  try{
    return localStorage.getItem('alcohol_cheat_day_'+(window.CU?.id||''))===window.TODAY;
  }catch(e){return false;}
}

// 앱 로드 시 음주 쿼터 localStorage 복원
export function restoreAlcoholQuota(){
  if(!window.CP||!window.CU)return;
  const weekKey=getCheatWeekKey();
  const stored=localStorage.getItem('alcohol_used_'+weekKey+'_'+window.CU.id);
  if(stored!==null){window.CP.alcohol_used=parseInt(stored)||0;}
  else{window.CP.alcohol_used=0;}
}

export function getCheatWeekKey(d=new Date()){
  const date=new Date(d);
  date.setHours(0,0,0,0);
  date.setDate(date.getDate()+3-(date.getDay()+6)%7);
  const week1=new Date(date.getFullYear(),0,4);
  const weekNum=1+Math.round(((date-week1)/86400000-3+(week1.getDay()+6)%7)/7);
  return date.getFullYear()+'-W'+String(weekNum).padStart(2,'0');
}
