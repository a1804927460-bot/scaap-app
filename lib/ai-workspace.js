'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const PptxGenJS = require('pptxgenjs');
const sharp = require('sharp');
const { exportModel } = require('./ai-model-export');
const TEXT_EXTENSIONS = new Set(['.txt','.md','.csv','.json','.html','.svg','.js','.ts','.py','.css','.xml','.yaml','.yml']);
const WORK_INSTRUCTION = [
  'Messs automatically executes bounded isolated JavaScript for the requested file task and persists downloadable files. Do not ask for a separate execution confirmation.',
  'For calculations, processing uploaded text, or creating PPTX, emit exactly one <messs-work> JavaScript function body </messs-work>.',
  'The code has uploads = [{name, content}] for the current user message only. No require, process, network, filesystem, DOM or asynchronous APIs.',
  'Return {files:[...]} with at most 6 files. Text file: {name:"report.md",content:"..."}.',
  'PPTX file: {name:"deck.pptx",type:"pptx",slides:[{title:"Title",body:"Text or bullet points"}]}. Maximum 30 slides; editable wide-format slides.',
  'Do not encode PPTX as text or base64. Host generates the real binary PPTX from the slides.',
  'Binary files of any extension can be returned as {name,base64} with valid base64 bytes. Never rename text to pretend it is a binary file.',
  'For a 3D model file, return {name:"model.obj",type:"model",parts:[{shape:"box",size:[1,2,0.2],position:[0,0,0],rotation:[0,0,0]}]}. Supported shapes: box, sphere, cylinder; size is XYZ dimensions, rotation is radians. Maximum 128 parts. Host exports real OBJ or binary STL (.stl), geometry only, without materials/textures. Use messs-work to construct the parts.',
  'A 3D file request requires an actual model artifact, not an HTML viewer or instructions to export later. If a requested format or modeling feature is unavailable, explain the limitation instead of claiming completion. Do not fabricate binary model bytes.',
  'For a simple text image return {name:"image.jpg",type:"image",width:1024,height:1024,text:"Your text",background:"#ffffff",color:"#000000"}. Host encodes real JPG/PNG/WebP. Do not claim JPG output is unsupported or substitute SVG when JPG was requested.',
  'Use uploaded content to do the requested work. Do not claim execution or file creation succeeded before the host runs it.',
  'For plain text files you may continue using messs-file. Never mix messs-file and messs-work in one reply.'
].join('\n');
function parseWork(text) {
  const matches = [...String(text).matchAll(/<messs-work>([\s\S]*?)<\/messs-work>/g)];
  if (!matches.length) return null;
  if (matches.length !== 1 || matches[0][1].length > 100000) throw new Error('执行代码数量或长度超出限制。');
  return { code: matches[0][1], text: String(text).replace(matches[0][0], '').trim() };
}
function executeWork(code, uploads = []) {
  if (typeof code !== 'string' || code.length > 100000 || JSON.stringify(uploads).length > 500000) return Promise.reject(new Error('执行输入超出限制。'));
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'ai-work-worker.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const worker = new Worker(workerPath, { workerData: { code, uploads }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
    let finished = false;
    const finish = (error, output) => {
      if (finished) return; finished = true; clearTimeout(timer);
      worker.terminate().then(() => error ? reject(error) : resolve(output), reject);
    };
    const timer = setTimeout(() => finish(new Error('执行超过时间限制，已停止。')), 8000);
    worker.once('message', result => finish(result.ok ? null : new Error(result.message), result.output));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!finished) finish(new Error(`执行器提前退出 (${code})。`)); });
  });
}
function safeName(value) {
  const name = String(value || 'output.txt');
  if (name.length > 140 || !/^[^<>:"/\\|?*\x00-\x1f]+$/.test(name) || /[. ]$/.test(name)) throw new Error('文件名称不合法。');
  return name;
}
async function materialize(output) {
  if (!output || !Array.isArray(output.files) || !output.files.length || output.files.length > 6) throw new Error('执行结果必须包含 1 至 6 个文件。');
  const files = [];
  for (const file of output.files) {
    const name = safeName(file.name);
    let data, mimeType;
    const ext = path.extname(name).toLowerCase();
    if (file.type === 'model') {
      ({data,mimeType} = await exportModel(file));
    } else if (file.type === 'image' && ['.jpg','.jpeg','.png','.webp'].includes(ext)) {
      const width = Math.min(4096,Math.max(64,Math.round(Number(file.width)||1024)));
      const height = Math.min(4096,Math.max(64,Math.round(Number(file.height)||1024)));
      const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
      const color = value => /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
      const text = escape(String(file.text || '').slice(0,2000));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color(file.background || '#ffffff')}"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Microsoft YaHei, sans-serif" font-size="${Math.min(96,Math.floor(width/12))}" fill="${color(file.color)}">${text}</text></svg>`;
      const format = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1);
      data = await sharp(Buffer.from(svg)).toFormat(format).toBuffer();mimeType=`image/${format}`;
    } else if (typeof file.base64 === 'string') {
      if (file.base64.length > 24*1024*1024 || /[^A-Za-z0-9+/=]/.test(file.base64)) throw new Error('Invalid binary encoding');
      data=Buffer.from(file.base64,'base64');
      if(data.toString('base64')!==file.base64)throw new Error('Invalid binary encoding');
      mimeType='application/octet-stream';
    } else if (file.type === 'pptx' && ext === '.pptx') {
      if (!Array.isArray(file.slides) || !file.slides.length || file.slides.length > 30) throw new Error('演示文稿必须包含 1 至 30 页。');
      const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'; deck.author = 'Messs';
      for (const entry of file.slides) {
        const title = String(entry.title || '').slice(0, 160), body = String(entry.body || '').slice(0, 6000);
        const slide = deck.addSlide(); slide.background = { color:'FFFFFF' };
        slide.addText(title, {x:0.7,y:0.55,w:11.9,h:1,fontSize:30,bold:true,color:'17191C',fontFace:'Microsoft YaHei',fit:'shrink',breakLine:false});
        slide.addText(body, {x:0.7,y:1.8,w:11.9,h:4.9,fontSize:20,color:'30353A',fontFace:'Microsoft YaHei',fit:'shrink',valign:'top'});
      }
      data = await deck.write({ outputType:'nodebuffer' });
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else {
      if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || typeof file.content !== 'string') throw new Error('此执行器不支持该文件类型。');
      data = Buffer.from(file.content, 'utf8'); mimeType = 'text/plain';
    }
    if (data.length > 16 * 1024 * 1024) throw new Error('生成文件超过 16MB 限制。');
    files.push({ name, mimeType, data });
  }
  return files;
}
function createArtifactStore(root, owner) {
  const directory = path.join(root, crypto.createHash('sha256').update(String(owner)).digest('hex'));
  return {
    async save(files) {
      await fs.mkdir(directory, {recursive:true});
      const existing = await fs.readdir(directory);
      let total = 0;
      for (const name of existing.filter(name => name.endsWith('.bin'))) total += (await fs.stat(path.join(directory,name))).size;
      const incoming = files.reduce((n,file)=>n+file.data.length,0);
      if (total + incoming > 256 * 1024 * 1024) throw new Error('生成文件存储已达 256MB 上限，请先整理文件。');
      const saved = [];
      for (const file of files) {
        const token = `work-${crypto.randomUUID()}`;
        const metadata = {token,name:safeName(file.name),mimeType:file.mimeType,sizeBytes:file.data.length};
        await fs.writeFile(path.join(directory,token+'.bin'),file.data,{flag:'wx'});
        await fs.writeFile(path.join(directory,token+'.json'),JSON.stringify(metadata),{flag:'wx'});
        saved.push(metadata);
      }
      return saved;
    },
    async read(token) {
      if (!/^work-[0-9a-f-]{36}$/.test(token)) throw new Error('文件标识无效。');
      const metadata = JSON.parse(await fs.readFile(path.join(directory,token+'.json'),'utf8'));
      return {...metadata,data:await fs.readFile(path.join(directory,token+'.bin'))};
    }
  };
}
module.exports = {WORK_INSTRUCTION,parseWork,executeWork,materialize,createArtifactStore};
