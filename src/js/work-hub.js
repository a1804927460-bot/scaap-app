'use strict';
window.MesssWorkHub = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const day = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => day(new Date());
  const addDays = (s, n) => { const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return day(d); };
  const difference = (a,b) => Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
  const statusNames = { planned:'待开始', active:'进行中', blocked:'受阻', done:'已交付' };
  let root, content, projects=[], resources=[], area='schedule', view='month', month=today().slice(0,7), selected=today(), query='', filter='all', archived=false, loadToken=0;
  const api = () => window.messsAPI;
  const action = (id,label,cls='') => `<button type="button" data-hub-action="${id}" class="${cls}">${label}</button>`;
  function notify(error) { const el=root?.querySelector('.hub-notice'); if(el){el.textContent=error.message || String(error);el.hidden=false;} }
  function ensureRoot() {
    if(root)return;
    root=document.createElement('dialog');root.className='work-hub';root.setAttribute('aria-label','工作管理');
    root.innerHTML=`<header class="hub-top"><div><span class="hub-wordmark">Messs.</span><span class="hub-local">本机工作管理</span></div><nav>${['schedule','files','assets','skills'].map((id,i)=>action(id,['日程','文件','素材库','技能'][i])).join('')}</nav>${action('close','×','hub-close')}</header><p class="hub-notice" role="alert" hidden></p><main class="hub-content"></main>`;
    document.body.append(root);content=root.querySelector('main');
    root.addEventListener('keydown',e=>e.stopPropagation());
    root.addEventListener('click',e=>{const button=e.target.closest('[data-hub-action]');if(button)void handle(button.dataset.hubAction,button).catch(notify);});
    root.addEventListener('cancel',()=>{++loadToken;});
    root.addEventListener('close',()=>{++loadToken;});
    window.addEventListener('focus',()=>{if(root.open&&!document.querySelector('.hub-editor[open]'))void reload().catch(notify);});
    let knownOwner;
    api().getCloudSession?.().then(session=>{knownOwner=session?.user?.id||'local';}).catch(()=>{});
    api().onCloudSessionChanged?.(session=>{
      const next=session?.user?.id||'local';
      if(next!==knownOwner){++loadToken;projects=[];resources=[];document.querySelectorAll('.hub-editor[open]').forEach(d=>d.close());if(root.open)root.close();}
      knownOwner=next;
    });
  }
  async function reload() {
    const token=++loadToken;
    const values=await Promise.all([api().listScheduleProjects(),api().listWorkspaceResources()]);
    if(token!==loadToken||!root.open)return;
    [projects,resources]=values;render();
  }
  async function open(next='schedule') {
    ensureRoot();area=next;query='';filter='all';root.querySelector('.hub-notice').hidden=true;
    if(!root.open)root.showModal();
    content.innerHTML='<div class="hub-empty">正在读取…</div>';
    try{await reload();}catch(error){content.innerHTML='<div class="hub-empty">暂时无法读取数据，请关闭后重试。</div>';notify(error);}
  }
  function heading(title, subtitle, buttons) { return `<div class="hub-heading"><div><p class="hub-eyebrow">WORKSPACE / ${area.toUpperCase()}</p><h1>${title}</h1><p>${subtitle}</p></div><div class="hub-actions">${buttons}</div></div>`; }
  function search() { return `<input class="hub-search" type="search" placeholder="搜索名称、负责人或标签…" aria-label="搜索" value="${esc(query)}">`; }
  function wireSearch() { const input=content.querySelector('.hub-search');if(input)input.addEventListener('input',()=>{query=input.value;const pos=input.selectionStart;render();const next=content.querySelector('.hub-search');next.focus();try{next.setSelectionRange(pos,pos);}catch{}}); }
  function render() {
    root.querySelectorAll('.hub-top nav button').forEach(b=>{b.classList.toggle('is-active',b.dataset.hubAction===area);b.setAttribute('aria-current',b.dataset.hubAction===area?'page':'false');});
    if(area==='schedule')renderSchedule();else if(area==='skills')renderSkills();else renderFiles();
    wireSearch();
  }
  function filteredProjects() {return projects.filter(p=>Boolean(p.deletedAt)===archived && (filter==='all'||p.status===filter) && `${p.title} ${p.owner}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.due.localeCompare(b.due));}
  function badge(p) {return `<span class="hub-status status-${p.status}">${p.status!=='done'&&p.due<today()?'已逾期 · ':''}${statusNames[p.status]}</span>`;}
  function card(p) {const remaining=difference(p.due,today());return `<button class="hub-project-card" data-hub-action="edit-project" data-id="${p.id}"><div>${badge(p)}<small>${p.progress}%</small></div><strong>${esc(p.title)}</strong><p>${esc(p.owner||'待指定负责人')} · ${p.due.slice(5)} 交付</p><progress max="100" value="${p.progress}" aria-label="项目进度"></progress><small>${p.status==='done'?'交付完成':remaining<0?`逾期 ${-remaining} 天`:remaining===0?'今天交付':`距交付 ${remaining} 天`}</small></button>`;}
  function renderSchedule() {
    const rows=filteredProjects(), active=projects.filter(p=>!p.deletedAt), late=active.filter(p=>p.status!=='done'&&p.due<today()), soon=active.filter(p=>p.status!=='done'&&p.due>=today()&&p.due<=addDays(today(),7));
    content.innerHTML=heading('项目日程','把每一次交付，放在清晰的时间线上。',action('export-calendar','导出日历')+action('new-project','＋ 新建项目','hub-primary'))+
      `<div class="hub-metrics"><div><small>进行中的项目</small><strong>${active.filter(p=>p.status==='active').length}<span> 项</span></strong></div><div><small>未来 7 天交付</small><strong>${soon.length}<span> 项</span></strong></div><div class="${late.length?'is-late':''}"><small>需要关注 · 逾期</small><strong>${late.length}<span> 项</span></strong></div><div><small>已交付</small><strong>${active.filter(p=>p.status==='done').length}<span> 项</span></strong></div></div>`+
      `<div class="hub-toolbar"><div class="hub-segment">${['month','timeline','list'].map((v,i)=>action('view-'+v,['月历','时间线','交付清单'][i],view===v?'is-active':'')).join('')}</div>${search()}<select class="hub-status-filter" aria-label="状态筛选"><option value="all">全部状态</option>${Object.entries(statusNames).map(([v,l])=>`<option value="${v}" ${filter===v?'selected':''}>${l}</option>`).join('')}</select>${action('archive-toggle',archived?'返回项目':'已归档',archived?'is-active':'')}</div>`+
      `<div class="hub-month-nav">${action('previous','‹')}<h2>${month.replace('-',' 年 ')} 月</h2>${action('next','›')}${action('today','今天')}<span>日期按本地日历显示 · 进度由项目负责人记录</span></div><div class="hub-schedule-body"></div>`;
    content.querySelector('.hub-status-filter').addEventListener('change',e=>{filter=e.target.value;render();});
    const body=content.querySelector('.hub-schedule-body');
    if(view==='month') {
      const first=new Date(month+'-01T12:00:00');const start=addDays(day(first),-(first.getDay()+6)%7);
      const days=Array.from({length:42},(_,i)=>addDays(start,i));
      body.innerHTML=`<div class="hub-calendar"><div class="hub-weekdays">${['一','二','三','四','五','六','日'].map(d=>`<span>周${d}</span>`).join('')}</div><div class="hub-days">${days.map(d=>{
        const events=rows.flatMap(p=>[{p,date:p.due,label:p.title,kind:'交付'},...p.milestones.map(m=>({p,date:m.date,label:m.title,kind:m.done?'✓':'◇'}))]).filter(e=>e.date===d);
        return `<div class="hub-day ${d.slice(0,7)!==month?'is-other':''} ${d===selected?'is-selected':''}"><button data-hub-action="day" data-date="${d}" class="hub-day-number ${d===today()?'is-today':''}" aria-label="${d}">${Number(d.slice(-2))}</button>${events.slice(0,3).map(e=>`<button class="hub-calendar-event status-${e.p.status}" data-hub-action="edit-project" data-id="${e.p.id}" title="${esc(e.label)}"><span>${e.kind}</span> ${esc(e.label)}</button>`).join('')}${events.length>3?`<button class="hub-more" data-hub-action="day" data-date="${d}">另 ${events.length-3} 项</button>`:''}</div>`;
      }).join('')}</div></div><aside class="hub-agenda"><div><h3>${selected.slice(5).replace('-','月')}日</h3>${action('new-on-day','＋ 添加')}</div><p>当天进行中的项目与交付</p>${rows.filter(p=>p.start<=selected&&p.due>=selected).map(card).join('')||'<div class="hub-empty">当天没有排期<br>可以从“新建项目”开始</div>'}</aside>`;
    } else if(view==='timeline') {
      const length=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();const start=month+'-01',end=month+'-'+length;
      const visible=rows.filter(p=>p.start<=end&&p.due>=start);
      body.innerHTML=`<div class="hub-timeline"><div class="hub-timeline-header"><strong>项目 / 负责人</strong><div class="hub-timeline-days" style="--days:${length}">${Array.from({length},(_,i)=>`<span>${i+1}</span>`).join('')}</div></div>${visible.map(p=>{const left=Math.max(0,difference(p.start,start))/length*100,width=(difference(p.due<end?p.due:end,p.start>start?p.start:start)+1)/length*100;return `<div class="hub-timeline-row"><button data-hub-action="edit-project" data-id="${p.id}"><strong>${esc(p.title)}</strong><small>${esc(p.owner||'待指定')} · ${p.progress}%</small></button><div class="hub-track" style="--days:${length}"><button class="hub-bar status-${p.status}" data-hub-action="edit-project" data-id="${p.id}" style="left:${left}%;width:${width}%" title="${esc(p.title)}：${p.start} 至 ${p.due}"><i style="width:${p.progress}%"></i><span>${p.progress}%</span></button>${p.milestones.filter(m=>m.date>=start&&m.date<=end).map(m=>`<span class="hub-diamond" style="left:${(difference(m.date,start)+.5)/length*100}%" title="${esc(m.title)} · ${m.date}">◇</span>`).join('')}</div></div>`;}).join('')||'<div class="hub-empty">本月没有项目排期</div>'}</div>`;
    } else body.innerHTML=`<div class="hub-project-grid">${rows.map(card).join('')||'<div class="hub-empty">还没有项目。创建一项排期，记录你的下一次交付。</div>'}</div>`;
  }
  function editor(title, html) {
    const dialog=document.createElement('dialog');dialog.className='hub-editor';dialog.setAttribute('aria-label',title);
    dialog.innerHTML=`<form><header><h2>${title}</h2><button type="button" data-close aria-label="关闭">×</button></header>${html}<p class="hub-editor-error" role="alert"></p><footer><button type="button" data-close>取消</button><button class="hub-primary" type="submit">保存</button></footer></form>`;
    document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;
  }
  function editProject(id, date=today()) {
    const p=projects.find(r=>r.id===id)||{title:'',owner:'',start:date,due:date,status:'planned',progress:0,notes:'',milestones:[]};
    const dialog=editor(p.id?'项目详情':'新建项目',`<label>项目名称<input name="title" required maxlength="160" value="${esc(p.title)}" placeholder="例如：品牌影片交付"></label><div class="hub-form-grid"><label>负责人<input name="owner" maxlength="100" value="${esc(p.owner)}" placeholder="姓名 / 团队"></label><label>关联画布<select name="canvasId"><option value="">不关联</option>${(AppState.canvases||[]).map(c=>`<option value="${esc(c.id)}" ${p.canvasId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>开始日期<input name="start" type="date" min="2000-01-01" max="2199-12-31" required value="${p.start}"></label><label>交付日期<input name="due" type="date" min="2000-01-01" max="2199-12-31" required value="${p.due}"></label><label>状态<select name="status">${Object.entries(statusNames).map(([v,l])=>`<option value="${v}" ${p.status===v?'selected':''}>${l}</option>`).join('')}</select></label><label>进度 %<input name="progress" type="number" min="0" max="100" step="1" required value="${p.progress}"></label></div><div class="hub-milestone-heading"><h3>里程碑</h3><button type="button" data-add-milestone>＋ 添加</button></div><div class="hub-milestones"></div><label>交付说明<textarea name="notes" rows="3" maxlength="6000" placeholder="交付物、验收要求、风险与备注">${esc(p.notes)}</textarea></label>${p.id?`<div class="hub-detail-actions"><button type="button" data-archive>${p.deletedAt?'恢复项目':'归档项目'}</button>${p.canvasId?'<button type="button" data-open-canvas>打开关联画布</button>':''}<small>最近更新 ${new Date(p.updatedAt).toLocaleString()}</small></div><details><summary>变更记录</summary>${(p.history||[]).slice().reverse().map(h=>`<p>${new Date(h.at).toLocaleString()} · ${esc(h.action)} · ${h.progress}% · 交付 ${h.due}</p>`).join('')}</details>`:''}`);
    const form=dialog.querySelector('form'), milestones=dialog.querySelector('.hub-milestones');
    const add=(m={title:'',date:p.due,done:false})=>{const row=document.createElement('div');row.className='hub-milestone';row.innerHTML=`<input type="checkbox" aria-label="里程碑已完成" ${m.done?'checked':''}><input type="text" placeholder="里程碑名称" aria-label="里程碑名称" maxlength="160" required value="${esc(m.title)}"><input type="date" aria-label="里程碑日期" required value="${m.date}"><button type="button" aria-label="移除里程碑">×</button>`;row.querySelector('button').onclick=()=>row.remove();milestones.append(row);};p.milestones.forEach(add);
    dialog.querySelector('[data-add-milestone]').onclick=()=>{if(milestones.children.length<50)add();};
    form.elements.status.onchange=()=>{if(form.elements.status.value==='done')form.elements.progress.value=100;};
    form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{const input=Object.fromEntries(new FormData(form));input.progress=Number(input.progress);input.id=p.id;input.revision=p.revision;input.milestones=[...milestones.children].map(row=>({title:row.children[1].value,date:row.children[2].value,done:row.children[0].checked}));await api().saveScheduleProject(input);dialog.close();await reload();}catch(error){dialog.querySelector('.hub-editor-error').textContent=error.message;}finally{submit.disabled=false;}};
    const archive=dialog.querySelector('[data-archive]');if(archive)archive.onclick=async()=>{archive.disabled=true;try{await api()[p.deletedAt?'restoreScheduleProject':'archiveScheduleProject'](p);dialog.close();await reload();}catch(e){dialog.querySelector('.hub-editor-error').textContent=e.message;archive.disabled=false;}};
    const canvas=dialog.querySelector('[data-open-canvas]');if(canvas)canvas.onclick=()=>{if(!AppState.canvases.some(c=>c.id===p.canvasId)){dialog.querySelector('.hub-editor-error').textContent='关联画布已不存在';return;}dialog.close();root.close();switchCanvas(p.canvasId,{enterWorkspace:true});};
  }
  function download(name, text, type='text/plain') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportCalendar() {
    const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,'\\$&');
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Messs//Project Schedule//ZH','CALSCALE:GREGORIAN'];
    filteredProjects().filter(p=>!p.deletedAt).forEach(p=>{[{title:p.title+' · 交付',date:p.due},...p.milestones].forEach((m,i)=>lines.push('BEGIN:VEVENT',`UID:${p.id}-${i}@messs.local`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${m.date.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(m.date,1).replaceAll('-','')}`,`SUMMARY:${escape(m.title)}`,`DESCRIPTION:${escape(p.owner+' · '+p.progress+'%\n'+p.notes)}`,'END:VEVENT'));});
    lines.push('END:VCALENDAR');
    // RFC 5545 folds at 75 octets without splitting a UTF-8 character.
    const encoder=new TextEncoder();
    const fold=line=>{let result='',width=0;for(const character of line){const size=encoder.encode(character).length;if(width+size>75){result+='\r\n ';width=1;}result+=character;width+=size;}return result;};
    download('Messs-项目日程.ics',lines.map(fold).join('\r\n')+'\r\n','text/calendar');
  }
  function renderFiles() {
    const assets=area==='assets';
    const records=resources.filter(r=>r.kind==='asset');
    const files=(AppState.files||[]).filter(f=>!assets||records.some(r=>r.fileId===f.id)).filter(f=>{const meta=records.find(r=>r.fileId===f.id);const type=/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.name)?'image':/\.(mp4|mov|webm|mkv)$/i.test(f.name)?'video':'other';return (filter==='all'||filter===type||(filter==='favorite'&&meta?.favorite))&&`${f.name} ${meta?.tags?.join(' ')||''}`.toLowerCase().includes(query.toLowerCase());});
    content.innerHTML=heading(assets?'素材库':'文件',assets?'收集自己的图片、视频与文档，让每次创作都有积累。':'本机文件，集中浏览与复用。',assets?action('add-existing','从文件添加')+action('upload','↑ 导入素材','hub-primary'):action('upload','↑ 导入文件','hub-primary'))+`<div class="hub-toolbar">${search()}<div class="hub-segment">${['all','image','video','other',...(assets?['favorite']:[])].map((v,i)=>action('filter-'+v,['全部','图片','视频','其他','收藏'][i],filter===v?'is-active':'')).join('')}</div><small>${files.length} 个文件</small></div><div class="hub-asset-grid">${files.slice(0,300).map(f=>{const meta=records.find(r=>r.fileId===f.id);return `<article class="hub-asset" data-file-id="${esc(f.id)}"><button class="hub-asset-preview" data-hub-action="preview" data-id="${esc(f.id)}" aria-label="预览 ${esc(f.name)}"></button><strong title="${esc(f.name)}">${esc(f.name)}</strong><small>${esc(meta?.tags?.join(' · ')||f.ext||'文件')}</small><div>${action('use-file','用于画布')}${assets?action('asset-edit','管理'):action('collect','加入素材库')}</div></article>`;}).join('')||'<div class="hub-empty">这里还没有素材<br>导入自己的文件，或从已有文件中添加。</div>'}</div>${files.length>300?'<p>仅显示前 300 项，请搜索缩小范围。</p>':''}`;
    content.querySelectorAll('.hub-asset').forEach(card=>{
      const f=files.find(f=>f.id===card.dataset.fileId);
      if(typeof appendFileThumbnail==='function')appendFileThumbnail(card.querySelector('.hub-asset-preview'),f);
      card.addEventListener('contextmenu', event=>{
        event.preventDefault();
        event.stopPropagation();
        const menu=buildAndShowSimpleMenu([
          {label:'在文件夹中显示',icon:'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',action:()=>api().revealFile(f.id)},
          {divider:true},
          {label:'删除文件',danger:true,icon:'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6',action:()=>deleteHubFile(f)}
        ],event.clientX,event.clientY,'hub-file-context-menu');
        root.append(menu);
      });
    });
  }
  async function deleteHubFile(file) {
    if(!file)return;
    const ok=await new Promise(resolve=>{
      const dialog=editor('删除文件', '<p>确定删除“'+esc(file.name)+'”吗？</p><p>这里删除后，本地磁盘中的文件也会一起永久删除，同时从 Messs 文件库移除，无法恢复。</p>');
      const submit=dialog.querySelector('[type=submit]');
      submit.textContent='同时删除本地文件';
      let confirmed=false;
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();confirmed=true;dialog.close();};
      dialog.addEventListener('close',()=>resolve(confirmed),{once:true});
      dialog.querySelector('[data-close]').focus();
    });
    if(!ok)return;
    try {
      const result=await api().deleteFilePermanently(file.id);
      if(!result?.ok)throw Error(result?.error||'删除文件失败');
      for(const resource of resources.filter(item=>item.fileId===file.id)) {
        try { await api().removeWorkspaceResource(resource); } catch {}
      }
      AppState.files=AppState.files.filter(item=>item.id!==file.id);
      if(typeof removeBoardItemsForFile==='function')removeBoardItemsForFile(file.id);
      if(AppState.activeFileId===file.id&&typeof clearPreview==='function')clearPreview();
      await reload();
      showToast('文件已从本地和 Messs 文件库永久删除');
    } catch(error) { notify(error); }
  }
  async function upload() {
    const paths=await api().pickFiles();if(!paths?.length)return;
    const result=await api().importFiles(paths,null,null);
    const imported=result?.imported||[];
    AppState.files=[...imported,...AppState.files.filter(f=>!imported.some(i=>i.id===f.id))];
    if(area==='assets')for(const f of imported)await api().saveWorkspaceResource({kind:'asset',fileId:f.id,tags:[],favorite:false});
    await reload();
    if(result?.failed?.length)notify(`已导入 ${imported.length} 个，${result.failed.length} 个未能导入，请检查文件权限后重试。`);
    if(typeof renderFileList==='function')renderFileList(currentFileListScope());
  }
  function assetEditor(id) {
    const record=resources.find(r=>r.kind==='asset'&&r.fileId===id),f=AppState.files.find(f=>f.id===id);if(!f)return;
    const dialog=editor('素材管理',`<p>${esc(f.name)}</p><label>标签（用逗号分隔）<input name="tags" value="${esc(record.tags.join(', '))}" maxlength="500"></label><label class="hub-check"><input name="favorite" type="checkbox" ${record.favorite?'checked':''}>收藏素材</label><button type="button" data-remove>从素材库移除（保留原文件）</button>`);
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await api().saveWorkspaceResource({...record,tags:e.target.elements.tags.value.split(/[,，]/),favorite:e.target.elements.favorite.checked});dialog.close();await reload();}catch(error){dialog.querySelector('.hub-editor-error').textContent=error.message;}};
    dialog.querySelector('[data-remove]').onclick=async()=>{try{await api().removeWorkspaceResource(record);dialog.close();await reload();}catch(error){dialog.querySelector('.hub-editor-error').textContent=error.message;}};
  }
  function renderSkills() {
    const rows=resources.filter(r=>r.kind==='skill'&&`${r.name} ${r.description}`.toLowerCase().includes(query.toLowerCase()));
    content.innerHTML=heading('技能','把专业方法写成可复用的工作流，交给 Agent 使用。',action('import-skill','导入 SKILL.md')+action('new-skill','＋ 编写技能','hub-primary'))+`<div class="hub-toolbar">${search()}<small>${rows.length} 项技能 · 按需调用</small></div><div class="hub-skill-grid">${rows.map(r=>`<article class="hub-skill" data-skill-id="${r.id}"><div class="hub-skill-mark">✧</div><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><small>修订 ${r.revision} · ${new Date(r.updatedAt).toLocaleDateString()}</small><div>${action('skill-edit','查看 / 编辑')}${action('skill-use','调用技能','hub-primary')}</div></article>`).join('')||'<div class="hub-empty">还没有技能<br>导入 SKILL.md，或编写你的第一份工作方法。</div>'}</div><p class="hub-footnote">当前支持 SKILL.md 指令型技能；脚本和附属文件尚不导入。调用前可检查内容，并选择主聊天或画布 Agent。</p>`;
  }
  const skillTemplate='---\nname: project-delivery-review\ndescription: 检查项目交付材料，整理缺项、风险与验收清单。\n---\n\n# 交付检查\n\n1. 先确认交付目标、日期和验收标准。\n2. 核对用户提供的材料，不虚构已完成事项。\n3. 列出缺项、风险、负责人和建议完成时间。\n4. 输出清晰的交付检查清单。';
  function skillEditor(record, markdown) {
    const dialog=editor(record?'编辑技能':'编写技能',`<p>使用 Agent Skills 格式：name、description 和 Markdown 正文。</p><label>SKILL.md<textarea name="markdown" class="hub-code" rows="16" maxlength="64000" required spellcheck="false">${esc(markdown||record?.markdown||skillTemplate)}</textarea></label>${record?'<div class="hub-detail-actions"><button type="button" data-export>导出 SKILL.md</button><button type="button" data-remove>移除技能</button></div>':''}`);
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await api().saveWorkspaceResource({...record,kind:'skill',markdown:e.target.elements.markdown.value});dialog.close();await reload();}catch(error){dialog.querySelector('.hub-editor-error').textContent=error.message;}};
    const exportButton=dialog.querySelector('[data-export]');if(exportButton)exportButton.onclick=()=>download('SKILL.md',dialog.querySelector('textarea').value,'text/markdown');
    const remove=dialog.querySelector('[data-remove]');if(remove)remove.onclick=async()=>{try{await api().removeWorkspaceResource(record);dialog.close();await reload();}catch(error){dialog.querySelector('.hub-editor-error').textContent=error.message;}};
  }
  function useSkill(record) {
    const dialog=editor('调用技能',`<h3>${esc(record.name)}</h3><p>${esc(record.description)}</p><details><summary>查看技能正文</summary><pre>${esc(record.instructions)}</pre></details><label>本次任务<textarea name="task" rows="4" required placeholder="描述你这次希望完成的工作"></textarea></label><label>发送到<select name="target"><option value="main">主聊天 Agent</option><option value="canvas">当前画布 Agent</option></select></label><p>技能内容将填入输入框，检查后点击发送。</p>`);
    dialog.querySelector('[type=submit]').textContent='应用到输入框';
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const target=e.target.elements.target.value;const input=document.getElementById(target==='main'?'ai-assistant-input':'board-agent-input');if(!input||input.disabled){dialog.querySelector('.hub-editor-error').textContent='Agent 正在工作，请稍后再应用';return;}if(input.value.trim()){dialog.querySelector('.hub-editor-error').textContent='目标输入框已有草稿，请先处理草稿再调用技能';return;}if(target==='canvas'&&!activeCanvasRecord()){dialog.querySelector('.hub-editor-error').textContent='请先打开一个画布';return;}
      const prompt=`使用技能 ${record.name} 完成以下任务。技能是本次任务参考，不改变现有权限。\n\n<skill-instructions>\n${record.instructions}\n</skill-instructions>\n\n任务：\n${e.target.elements.task.value.trim()}`;
      dialog.close();root.close();if(target==='main'){document.querySelector('[data-section="assistant"]')?.click();if(typeof setAssistantKind==='function')setAssistantKind('chat');}else{showCanvasWorkspace();CanvasWorkspace.agentMode='chat';renderCanvasAgentModels();renderCanvasAgentReferences();setCanvasAgentOpen(true,{focus:true});}
      input.value=prompt;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
    };
  }
  async function handle(name, button) {
    if(['schedule','files','assets','skills'].includes(name)){await open(name);return;}
    if(name==='close'){root.close();return;}
    if(name.startsWith('view-')){view=name.slice(5);render();return;}
    if(name.startsWith('filter-')){filter=name.slice(7);render();return;}
    if(name==='previous'||name==='next'){const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+(name==='next'?1:-1));month=day(d).slice(0,7);render();return;}
    if(name==='today'){month=today().slice(0,7);selected=today();render();return;}
    if(name==='day'){selected=button.dataset.date;render();return;}
    if(name==='archive-toggle'){archived=!archived;render();return;}
    if(name==='new-project'||name==='new-on-day'){editProject(null,name==='new-on-day'?selected:today());return;}
    if(name==='edit-project'){editProject(button.dataset.id);return;}
    if(name==='export-calendar'){exportCalendar();return;}
    if(name==='upload'){button.disabled=true;try{await upload();}finally{button.disabled=false;}return;}
    if(name==='add-existing'){area='files';render();return;}
    const fileId=button.dataset.id||button.closest('[data-file-id]')?.dataset.fileId;
    if(name==='preview'){const f=AppState.files.find(f=>f.id===fileId);if(f){root.close();if(isImageExt(f.ext)||isVideoExt(f.ext)){await openFileFullscreenPreview(f);}else{await selectFileForPreview(f.id);openFullscreenPreview();}}return;}
    if(name==='collect'){await api().saveWorkspaceResource({kind:'asset',fileId,tags:[],favorite:false});await reload();notify('已加入素材库');return;}
    if(name==='asset-edit'){assetEditor(fileId);return;}
    if(name==='use-file'){if(!activeCanvasRecord())throw Error('请先打开一个画布');const center=boardViewportCenterCoords();await addFilesToBoard([fileId],center.x,center.y);root.close();showCanvasWorkspace();return;}
    if(name==='new-skill'){skillEditor();return;}
    if(name==='import-skill'){const input=document.createElement('input');input.type='file';input.accept='.md';input.onchange=async()=>{try{const f=input.files[0];if(!f)return;if(f.size>64000)throw Error('SKILL.md 最大为 64 KB');const raw=await f.text();await api().parseWorkspaceSkill(raw);skillEditor(null,raw);}catch(e){notify(e);}};input.click();return;}
    const record=resources.find(r=>r.id===button.closest('[data-skill-id]')?.dataset.skillId);
    if(name==='skill-edit'&&record)skillEditor(record);
    if(name==='skill-use'&&record)useSkill(record);
  }
  async function previewSkill(markdown) {
    await api().parseWorkspaceSkill(markdown);
    await open('skills');
    if (!root.open) return;
    skillEditor(null, markdown);
  }
  return { open, previewSkill };
})();
