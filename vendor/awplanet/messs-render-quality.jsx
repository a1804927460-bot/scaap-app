import {useEffect} from 'react';
import {useThree} from '@react-three/fiber';

// Render the actual scene at export resolution, then restore the interactive
// buffer immediately. No image upscaling and no persistent high-DPI GPU cost.
export function MesssRenderQuality() {
  const {gl,scene,camera} = useThree();
  useEffect(()=>{
    const capture=event=>{
      const ratio=gl.getPixelRatio();
      const canvas=gl.domElement;
      const width=canvas.clientWidth,height=canvas.clientHeight;
      try {
        if(!width||!height||gl.getContext().isContextLost())throw Error('Renderer unavailable');
        const max=gl.capabilities.maxTextureSize;
        const exportRatio=Math.min(2560/Math.max(width,height),max/Math.max(width,height),Math.sqrt(8000000/(width*height)));
        gl.setPixelRatio(exportRatio);
        gl.render(scene,camera);
        event.detail.dataUrl=canvas.toDataURL('image/png');
      } catch { event.detail.error=true; }
      finally {gl.setPixelRatio(ratio);gl.render(scene,camera);}
    };
    window.addEventListener('messs-capture-scene',capture);
    return ()=>window.removeEventListener('messs-capture-scene',capture);
  },[gl,scene,camera]);
  return null;
}
