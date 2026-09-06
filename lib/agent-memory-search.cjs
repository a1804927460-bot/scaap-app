'use strict';
const {parentPort,workerData} = require('node:worker_threads');
const MiniSearch = require('minisearch');
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
const index = new MiniSearch({fields:['name','text'],storeFields:['documentId','name','text'],
  tokenize:text=>[...segmenter.segment(text)].filter(part=>part.isWordLike).map(part=>part.segment.toLowerCase())});
for (const doc of workerData.documents) {
  for(let start=0;start<doc.text.length;start+=800) index.add({id:`${doc.id}:${start}`,documentId:doc.id,name:doc.name,text:doc.text.slice(start,start+1000)});
}
parentPort.postMessage(index.search(workerData.query,{boost:{name:2}}).slice(0,4)
  .map(({documentId,name,text})=>({id:documentId,name,text})));
