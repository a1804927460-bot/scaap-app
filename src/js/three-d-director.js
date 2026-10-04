'use strict';
// The vendored editor has its own origin and no Messs preload access.
const ThreeDDirector = {overlay:null,frame:null,token:null,pending:new Map(),ready:false,canvasId:null,returnFocus:null,loadTimer:null};
function directorRequest(action) {
  if (!ThreeDDirector.ready) return Promise.reject(new Error('场景仍在加载，请稍候。'));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ThreeDDirector.pending.delete(id);reject(new Error('3D 导演台响应超时，请重试。'));},15000);
    ThreeDDirector.pending.set(id,{resolve,reject,timer});
    ThreeDDirector.frame.contentWindow.postMessage({token:ThreeDDirector.token,id,action},'messs-director://app');
  });
}
window.addEventListener('message',event=>{
  if(event.origin!=='messs-director://app'||event.source!==ThreeDDirector.frame?.contentWindow||event.data?.type!=='messs-director'||event.data.token!==ThreeDDirector.token)return;
  if(event.data.ready){
    clearTimeout(ThreeDDirector.loadTimer);
    ThreeDDirector.ready=true;
    ThreeDDirector.overlay.querySelector('.three-d-director-status').textContent='';
    ThreeDDirector.overlay.querySelectorAll('[data-director-action]').forEach(b=>b.disabled=false);return;
  }
  const pending=ThreeDDirector.pending.get(event.data.id);
  if(!pending)return;
  clearTimeout(pending.timer);ThreeDDirector.pending.delete(event.data.id);
  event.data.ok?pending.resolve(event.data):pending.reject(new Error('无法捕获场景，请等待模型加载完成后重试。'));
});
new MutationObserver(()=>{
  ThreeDDirector.frame?.contentWindow?.postMessage({token:ThreeDDirector.token,action:'theme',theme:document.documentElement.dataset.theme},'messs-director://app');
}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
function ensureThreeDDirectorUi(){
  if(ThreeDDirector.overlay)return ThreeDDirector.overlay;
  const overlay=document.createElement('div');
  overlay.id='three-d-director-overlay';overlay.className='three-d-director-overlay';overlay.hidden=true;
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','three-d-director-title');
  overlay.innerHTML='<section class="three-d-director-shell"><header class="three-d-director-header"><div><strong id="three-d-director-title">3D 导演台</strong></div><span class="three-d-director-status" role="status"></span><button class="three-d-director-close" type="button" aria-label="关闭">×</button></header><div class="three-d-director-viewport"></div><footer class="three-d-director-footer"><span>调整场景与镜头，完成后放到画布</span><button data-director-action="snapshot">放到画布</button><button data-director-action="download">保存图片</button><button data-director-action="image">用于生图</button><button data-director-action="video">用于视频</button></footer></section>';
  document.body.append(overlay);ThreeDDirector.overlay=overlay;
  overlay.querySelector('.three-d-director-close').addEventListener('click',()=>void closeThreeDDirector());
  overlay.querySelectorAll('[data-director-action]').forEach(b=>b.addEventListener('click',()=>void directorAction(b.dataset.directorAction)));
  return overlay;
}
async function openThreeDDirector(){
  const overlay=ensureThreeDDirectorUi();if(!overlay.hidden)return;
  ThreeDDirector.returnFocus=document.activeElement;
  ThreeDDirector.canvasId=typeof activeCanvasId==='function'?activeCanvasId():null;
  ThreeDDirector.token=crypto.randomUUID();ThreeDDirector.ready=false;
  overlay.hidden=false;document.body.classList.add('is-three-d-director-open');
  overlay.querySelector('.three-d-director-status').textContent='正在加载场景…';
  overlay.querySelectorAll('[data-director-action]').forEach(b=>b.disabled=true);
  const frame=document.createElement('iframe');frame.title='Messs 3D 导演台';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-pointer-lock');
  frame.src='messs-director://app/index.html#'+new URLSearchParams({token:ThreeDDirector.token,canvas:ThreeDDirector.canvasId||'default',theme:document.documentElement.dataset.theme||'dark',language:document.documentElement.dataset.language||'zh'});
  ThreeDDirector.frame=frame;overlay.querySelector('.three-d-director-viewport').replaceChildren(frame);
  ThreeDDirector.loadTimer=setTimeout(()=>{if(!ThreeDDirector.ready&&!overlay.hidden)overlay.querySelector('.three-d-director-status').textContent='加载未完成，请关闭后重试。';},30000);
  overlay.querySelector('.three-d-director-close').focus({preventScroll:true});
}
async function closeThreeDDirector(){
  if(!ThreeDDirector.overlay||ThreeDDirector.overlay.hidden)return;
  try{if(ThreeDDirector.ready)await directorRequest('save');}
  catch{if(!window.confirm('场景缓存未能保存。建议先使用导演台的“保存”导出工程，避免修改丢失。仍要关闭吗？'))return false;}
  ThreeDDirector.overlay.hidden=true;ThreeDDirector.ready=false;
  clearTimeout(ThreeDDirector.loadTimer);
  ThreeDDirector.frame?.remove();ThreeDDirector.frame=null;
  ThreeDDirector.pending.forEach(p=>{clearTimeout(p.timer);p.reject(new Error('导演台已关闭'));});ThreeDDirector.pending.clear();
  document.body.classList.remove('is-three-d-director-open');ThreeDDirector.returnFocus?.focus?.({preventScroll:true});
}
async function directorSnapshotDataUrl(){
  const result=await directorRequest('capture');
  if(typeof result.dataUrl!=='string'||!result.dataUrl.startsWith('data:image/png;base64,')||result.dataUrl.length>40*1024*1024)throw new Error('镜头图片无效或过大');
  return result.dataUrl;
}
async function saveDirectorSnapshot(dataUrl){
  if(ThreeDDirector.canvasId!==activeCanvasId())throw new Error('画布已切换，请重新打开导演台。');
  const result=await window.messsAPI.importCroppedImage({canvasId:ThreeDDirector.canvasId,folderId:AppState.activeFolderId||null,dataUrl});
  if(!result?.ok||!result.file)throw new Error('镜头保存失败，请重试。');
  const file=result.file;AppState.files=[file,...AppState.files.filter(f=>f.id!==file.id)];
  const point=boardViewportCenterCoords();await addFilesToBoard([file.id],point.x,point.y,{selectAdded:true});
  if(typeof renderFileList==='function')renderFileList(currentFileListScope());
  return file;
}
async function directorAction(action){
  const buttons=ThreeDDirector.overlay.querySelectorAll('[data-director-action]');buttons.forEach(b=>b.disabled=true);
  try{
    const dataUrl=await directorSnapshotDataUrl();
    if(action==='download'){const a=document.createElement('a');a.href=dataUrl;a.download='Messs-3D-shot.png';a.click();return;}
    const file=await saveDirectorSnapshot(dataUrl);
    if(action==='image'||action==='video'){
      if(await closeThreeDDirector()===false)return;
      await showAiImagePopover(action);
      for(let attempt=0;attempt<40;attempt++){
        const composer=document.getElementById('ai-image-popover');
        if(composer&&!composer.classList.contains('ai-composer-loading')&&typeof composer._toggleBoardReference==='function'){await composer._toggleBoardReference(file.id);return;}
        await new Promise(resolve=>setTimeout(resolve,80));
      }
      throw new Error('镜头已保存到画布，请在生成框中选择该图片。');
    }
    if(typeof showToast==='function')showToast('镜头已放到画布。','3D');
  }catch(error){if(typeof showToast==='function')showToast(error.message,'3D');}
  finally{buttons.forEach(b=>b.disabled=!ThreeDDirector.ready);}
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&ThreeDDirector.overlay&&!ThreeDDirector.overlay.hidden){event.preventDefault();void closeThreeDDirector();}
},true);
window.MesssThreeDDirector=Object.freeze({open:openThreeDDirector,close:closeThreeDDirector,snapshot:directorSnapshotDataUrl});
