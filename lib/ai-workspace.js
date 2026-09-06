'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const PptxGenJS = require('pptxgenjs');
const TEXT_EXTENSIONS = new Set(['.txt','.md','.csv','.json','.html','.svg','.js','.ts','.py','.css','.xml','.yaml','.yml']);
const WORK_INSTRUCTION = [
  'Messs can execute isolated JavaScript after user approval and persist downloadable files.',
  'For calculations, processing uploaded text, or creating PPTX, emit exactly one <messs-work> JavaScript function body </messs-work>.',
  'The code has uploads = [{name, content}] for the current user message only. No require, process, network, filesystem, DOM or asynchronous APIs.',
  'Return {files:[...]} with at most 6 files. Text file: {name:"report.md",content:"..."}.',
  'PPTX file: {name:"deck.pptx",type:"pptx",slides:[{title:"Title",body:"Text or bullet points"}]}. Maximum 30 slides; editable wide-format slides.',
  'Do not encode PPTX as text or base64. Host generates the real binary PPTX from the slides.',
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
    if (file.type === 'pptx' && path.extname(name).toLowerCase() === '.pptx') {
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
