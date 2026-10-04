const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'vendor/awplanet');
const output = path.join(root, 'src/vendor/awplanet');
(async () => {
  if (!fs.existsSync(path.join(upstream,'node_modules/vite/package.json'))) {
    require('node:child_process').execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d','/c','npm ci --ignore-scripts --no-audit --no-fund'] : ['ci','--ignore-scripts','--no-audit','--no-fund'], {cwd:upstream,stdio:'inherit'});
  }
  const { build } = await import(pathToFileURL(path.join(upstream, 'node_modules/vite/dist/node/index.js')));
  await build({
    configFile: false, root: upstream, base: '/', publicDir: path.join(upstream, 'public'), esbuild: {jsx:'automatic'},
    plugins: [{
      name: 'messs-host-adapter',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/EditorShell.jsx')) return code
          .replace('useState(true);\n  const [recentProject', 'useState(false);\n  const [recentProject')
          .replace('fetch("/__phone-pilot/recording-status", {', 'return; fetch("/__phone-pilot/recording-status", {')
          .replace('const pollRecordingCommand = async () => {', 'const pollRecordingCommand = async () => { return;');
        if(id.endsWith('/usePhonePilotReceiver.js'))return code.replace(/useEffect\(\(\) => \{/g,'useEffect(() => { return;');
        if(id.endsWith('/EnvironmentRenderer.jsx'))return code.replace('shadow-mapSize={[1024, 1024]}','shadow-mapSize={[2048, 2048]}');
        if (id.endsWith('/RuntimeCanvas.jsx')) {
          if (!code.includes('<RuntimeAssetPreloader includeOptional={!isPhoneProfile} />')) throw new Error('Director on-demand asset adapter no longer matches upstream');
          return 'import {MesssRenderQuality} from "../../../messs-render-quality.jsx";\n'+code
          .replace('preserveDrawingBuffer: false', 'preserveDrawingBuffer: true')
          .replace('antialias: false', 'antialias: true')
          .replace('[1, 1.2]', '[1, 2]')
          // Renderers already load the assets used by the current scene. Eagerly
          // warming the entire library competes with the first useful frame.
          .replace('<RuntimeAssetPreloader includeOptional={!isPhoneProfile} />', '<MesssRenderQuality />');
        }
      }
    }],
    build: { outDir: output, emptyOutDir: true, cssMinify:false, chunkSizeWarningLimit: 2500,
      rollupOptions: { input: path.join(upstream, 'index.html') } }
  });
  // Theme only UI CSS, never textures, materials or WebGL output.
  fs.cpSync(path.join(root,'src/assets/fonts/source-han-sans'),path.join(output,'fonts/source-han-sans'),{recursive:true});
  for (const name of fs.readdirSync(path.join(output,'assets')).filter(name=>name.endsWith('.css'))) {
    const file=path.join(output,'assets',name);
    let css=fs.readFileSync(file,'utf8');
    css=css.replace(/font-size:\s*([\d.]+)px/g,(rule,size)=>Number(size)>0&&Number(size)<14?'font-size: '+Math.max(12,Number(size)+1)+'px':rule)
      .replace(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/g,'rgba(var(--messs-fg-rgb),$1)')
      .replace(/rgba\(8,\s*12,\s*18,\s*([\d.]+)\)/g,'rgba(var(--messs-panel-rgb),$1)')
      .replace(/#0d1117\b/g,'var(--messs-panel)').replace(/#080b0f\b/g,'var(--messs-panel)');
    fs.writeFileSync(file,css);
  }
  for (const file of ['LICENSE.txt','NOTICE.md','COMMERCIAL-LICENSE.md','THIRD-PARTY-NOTICES.md','MESSS-INTEGRATION.md']) fs.copyFileSync(path.join(upstream,file),path.join(output,file));
  fs.cpSync(path.join(upstream,'third-party-licenses'),path.join(output,'third-party-licenses'),{recursive:true});
  const runtimeNotices = [];
  const packages=JSON.parse(fs.readFileSync(path.join(upstream,'package-lock.json'),'utf8')).packages;
  for(const [relative,meta] of Object.entries(packages)) {
    if(!relative.startsWith('node_modules/')||meta.dev)continue;
    const directory=path.join(upstream,relative);
    if(!fs.existsSync(directory))continue;
    runtimeNotices.push(relative+' @ '+meta.version+' — '+(meta.license||'See package license'));
    for(const name of fs.readdirSync(directory).filter(name=>/^(license|licence|copying|notice)([.-]|$)/i.test(name))) {
      const source=path.join(directory,name);
      if(!fs.statSync(source).isFile())continue;
      const target=path.join(output,'third-party-licenses',relative.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+name);
      fs.copyFileSync(source,target);
    }
  }
  fs.writeFileSync(path.join(output,'third-party-licenses','RUNTIME-DEPENDENCIES.txt'),runtimeNotices.join('\n'));
})().catch(error => { console.error(error); process.exitCode=1; });
