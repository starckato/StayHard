// QROK · meal photo utilities
//
// Helpers for the private `meal-photos` bucket. Keeps signed URLs in an
// in-memory TTL cache to avoid re-signing between renders. Exposes three
// functions:
//   - _mealPhotoPath(stored): extract storage path from legacy URL or pass through
//   - _hydrateMealPhotos(): populate <img data-meal-photo="..."> with signed URLs
//   - compressImage(file, maxPx, quality): canvas-based JPEG downscale for uploads
//
// Pure + async (no reliance on window state beyond the DOM it hydrates).

import { sb } from './supabase.js';

export const _mealPhotoSignedCache={};
export function _mealPhotoPath(stored){
  if(!stored||typeof stored!=='string')return null;
  if(stored.startsWith('data:'))return null; // base64 preview, handled elsewhere
  if(stored.includes('://')){
    // Legacy public URL or old signed URL with full origin
    const m=stored.match(/\/meal-photos\/(.+?)(?:\?|$)/);
    return m?m[1]:null;
  }
  return stored; // already a path
}
export async function _hydrateMealPhotos(){
  const imgs=document.querySelectorAll('img[data-meal-photo]:not([data-hydrated])');
  if(!imgs.length)return;
  const now=Date.now();
  // Collect unique paths still needing signing
  const uniquePaths=new Set();
  imgs.forEach(img=>{
    const p=img.getAttribute('data-meal-photo');
    if(!p)return;
    const cached=_mealPhotoSignedCache[p];
    if(!cached||cached.expires<now+60000)uniquePaths.add(p);
  });
  // Batch sign
  await Promise.all([...uniquePaths].map(async p=>{
    try{
      const{data,error}=await sb.storage.from('meal-photos').createSignedUrl(p,3600);
      if(!error&&data&&data.signedUrl){
        _mealPhotoSignedCache[p]={url:data.signedUrl,expires:now+3600000};
      }
    }catch(e){}
  }));
  // Populate src
  imgs.forEach(img=>{
    const p=img.getAttribute('data-meal-photo');
    const cached=p?_mealPhotoSignedCache[p]:null;
    if(cached){
      img.src=cached.url;
      img.style.opacity='1';
    }
    img.setAttribute('data-hydrated','1');
  });
}
export function compressImage(file,maxPx,quality){
  return new Promise((resolve)=>{
    const img=new Image();const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.width,h=img.height;
      if(w>maxPx||h>maxPx){if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;}}
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      canvas.toBlob(blob=>resolve(blob),'image/jpeg',quality);
    };
    img.onerror=()=>resolve(file);img.src=url;
  });
}
