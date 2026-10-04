import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {EngineProvider} from './src/engine/core/EngineProvider';
import {useEngine} from './src/engine/core/useEngine';
import {RuntimeCanvas} from './src/engine/runtime/RuntimeCanvas';
import {EditorShell} from './src/editor/EditorShell';
import './src/styles/index.scss';
import './messs-theme.css';

const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token');
const storageKey = 'messs.awplanet.' + (params.get('canvas') || 'default');
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
localStorage.setItem('awplanet.interface-language', params.get('language') === 'zh' ? 'zh' : 'en');
let initialState;
try { initialState = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || undefined; } catch {}
function Bridge() {
  const {engineState} = useEngine();
  const current = useRef(engineState);
  current.current = engineState;
  useEffect(() => {
    const save = () => sessionStorage.setItem(storageKey, JSON.stringify(current.current));
    const receive = event => {
      if (event.source !== parent || event.data?.token !== token) return;
      const {action,id,theme} = event.data;
      if (action === 'theme') { document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'; return; }
      if (!['capture','save'].includes(action)) return;
      try {
        save();
        const canvas = document.querySelector('.engine-viewport canvas');
        if (action === 'capture' && (!canvas || !canvas.width)) throw Error('场景尚未加载完成');
        const captured={};
        if(action==='capture')window.dispatchEvent(new CustomEvent('messs-capture-scene',{detail:captured}));
        if(action==='capture'&&(!captured.dataUrl||captured.error))throw Error('Capture unavailable');
        const dataUrl = captured.dataUrl;
        parent.postMessage({type:'messs-director',token,id,ok:true,dataUrl}, '*');
      } catch { parent.postMessage({type:'messs-director',token,id,ok:false}, '*'); }
    };
    window.addEventListener('message',receive);
    window.addEventListener('pagehide',save);
    const readyTimer = setInterval(() => {
      if (!document.body.dataset.runtimeCanvasCreated) return;
      clearInterval(readyTimer);
      parent.postMessage({type:'messs-director',token,ready:true}, '*');
    }, 100);
    return () => { clearInterval(readyTimer); try {save();}catch {} window.removeEventListener('message',receive); window.removeEventListener('pagehide',save); };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { try { sessionStorage.setItem(storageKey,JSON.stringify(engineState)); } catch {} }, 500);
    return () => clearTimeout(timer);
  }, [engineState]);
  return null;
}
createRoot(document.getElementById('root')).render(
  <EngineProvider initialState={initialState}><main className="canvas-wrapper engine-app">
    <section className="engine-viewport"><RuntimeCanvas /></section><EditorShell /><Bridge />
  </main></EngineProvider>
);
