'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const {assertPromptHasNoSecrets} = require('./privacy-guard');
const locks = new Map();

function createLocalMemory(root, owner) {
  const directory = path.join(root,crypto.createHash('sha256').update(String(owner)).digest('hex'));
  const file = path.join(directory,'documents.json');
  async function read() {
    try {
      if ((await fs.stat(file)).size > 8*1024*1024) throw new Error('Local memory limit exceeded');
      const documents = JSON.parse(await fs.readFile(file,'utf8'));
      if (!Array.isArray(documents) || documents.length > 128) throw new Error('Invalid local memory');
      return documents;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function update(change) {
    const previous = locks.get(file) || Promise.resolve();
    const current = previous.catch(()=>{}).then(async()=>{
      const documents = await read(); const result = change(documents);
      const json = JSON.stringify(documents);
      if (documents.length > 128 || Buffer.byteLength(json) > 8*1024*1024) throw new Error('Local memory is full; remove documents first');
      await fs.mkdir(directory,{recursive:true});
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temp,json,{mode:0o600,flag:'wx'}); await fs.rename(temp,file); }
      finally { await fs.rm(temp,{force:true}); }
      return result;
    });
    locks.set(file,current);
    try { return await current; } finally { if (locks.get(file) === current) locks.delete(file); }
  }
  return {
    add(source, text) {
      assertPromptHasNoSecrets(text);
      if (typeof text !== 'string' || text.length > 60000) throw new Error('Memory text exceeds limit');
      const id = crypto.createHash('sha256').update(source).digest('hex');
      return update(documents=>{
        const existing = documents.findIndex(doc=>doc.id === id);
        const document = {id,name:path.basename(source),text,updatedAt:new Date().toISOString()};
        if (existing < 0) documents.push(document); else documents[existing] = document;
        return {id,name:document.name,updatedAt:document.updatedAt};
      });
    },
    async search(query) {
      await locks.get(file)?.catch(()=>{});
      const documents = await read();
      if (!documents.length) return [];
      return new Promise((resolve,reject)=>{
        const worker = new Worker(path.join(__dirname,'agent-memory-search.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), {
          workerData:{documents,query:String(query).slice(0,500)},resourceLimits:{maxOldGenerationSizeMb:128}
        });
        let done = false;
        const finish = (error,result)=>{
          if (done) return; done=true; clearTimeout(timer);
          worker.terminate().then(()=>error ? reject(error) : resolve(result),reject);
        };
        const timer = setTimeout(()=>finish(new Error('Local search timed out')),10000);
        worker.once('message',result=>finish(null,result));
        worker.once('error',error=>finish(error));
        worker.once('exit',()=>finish(new Error('Local search stopped')));
      });
    },
    async list() {
      await locks.get(file)?.catch(()=>{});
      return (await read()).map(({id,name,updatedAt})=>({id,name,updatedAt}));
    },
    remove(id) { return update(documents=>{const index=documents.findIndex(doc=>doc.id === id);if(index>=0)documents.splice(index,1);return {removed:index>=0};}); }
  };
}
module.exports = {createLocalMemory};
