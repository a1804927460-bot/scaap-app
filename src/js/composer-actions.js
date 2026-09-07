'use strict';
async function chatWithAgentEstimate(pending, request) {
  let finished=false;
  request = { ...request, workRequestId: request.workRequestId || crypto.randomUUID() };
  const unsubscribe = window.messsAPI.onAiChatDelta?.(event => {
    if (finished || !pending.isConnected || event?.requestId !== request.workRequestId || typeof event.text !== 'string') return;
    const body = pending.querySelector('.ai-assistant-message-body') || pending;
    const scroller = pending.closest('.ai-assistant-messages, .board-agent-messages');
    const follow = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64;
    pending.dataset.streaming = 'true';
    pending.classList.add('is-streaming');
    body.textContent = event.text;
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  });
  const unsubscribeWork = window.messsAPI.onAiWorkProgress?.(event => {
    if (finished || !pending.isConnected || event?.requestId !== request.workRequestId) return;
    const status = {
      approval: t('Waiting for execution approval...', '等待执行确认...'),
      executing: t('Executing file task...', '正在执行文件任务...'),
      saving: t('Saving generated files...', '正在保存生成文件...')
    }[event.phase];
    if (!status) return;
    pending.dataset.streaming = 'true';
    (pending.querySelector('.ai-assistant-message-body') || pending).textContent = status;
  });
  const estimate=document.createElement('span');estimate.className='agent-task-credit-range';
  estimate.textContent=t('Estimating credits...', '正在估算积分...');
  pending.dataset.creditEstimate=estimate.textContent;
  Promise.resolve().then(()=>window.messsAPI.estimateAgentCredits?.(request)).then(quote=>{
    if(finished || !pending.isConnected)return;
    estimate.textContent=quote?.available
      ? t(`Estimated ${quote.min.toFixed(2)} - ${quote.max.toFixed(2)} credits`, `预计 ${quote.min.toFixed(2)} - ${quote.max.toFixed(2)} 积分`)
      : t('Estimate unavailable','暂无法估算积分');
    pending.dataset.creditEstimate=estimate.textContent;
  }).catch(()=>{if(!finished && pending.isConnected)pending.dataset.creditEstimate=t('Estimate unavailable','暂无法估算积分');});
  try {return await window.messsAPI.chatWithAi(request);}
  finally {
    finished=true;
    unsubscribe?.();
    unsubscribeWork?.();
    delete pending.dataset.creditEstimate;
    delete pending.dataset.streaming;
    pending.classList.remove('is-streaming');
    pending.removeAttribute('title');
  }
}

window.MesssComposerActions = (() => {
  let session = crypto.randomUUID(), mode = 'ask', initialized = false;
  let addMenu, permissionMenu, permissionButton, dialog;
  const label = (en,zh) => t(en,zh);
  function setMenuLabel(button, name, text) {
    if (!button) return;
    const icon = document.createElement('img');
    icon.src = `assets/icons/lucide/${name}.svg`;
    icon.alt = '';
    icon.className = 'messs-composer-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.textContent = text;
    button.replaceChildren(icon, caption);
  }
  function permissionLabel(button, value, text) {
    const icon = document.createElement('img');
    icon.src = `assets/icons/lucide/${value === 'full' ? 'shield-check' : 'lock-keyhole'}.svg`;
    icon.alt = '';
    icon.className = `messs-permission-icon is-${value}`;
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.textContent = text;
    button.replaceChildren(icon, caption);
  }
  function closeMenus() {
    for (const [menu,button] of [[addMenu,document.getElementById('ai-assistant-upload')],[permissionMenu,permissionButton]]) {
      if (menu) { window.MesssUiMotion?.stop(menu); menu.hidden = true; }
      button?.setAttribute('aria-expanded','false');
    }
  }
  function openMenu(menu,button) {
    const opening = menu.hidden; closeMenus();
    if (!opening) return;
    menu.hidden=false;button.setAttribute('aria-expanded','true');
    const r=button.getBoundingClientRect();
    menu.style.left=`${Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))}px`;
    menu.style.bottom=`${Math.max(8,innerHeight-r.top+8)}px`;
    menu.style.maxHeight=`${Math.max(80,r.top-16)}px`;
    menu.querySelector('button')?.focus();
    window.MesssUiMotion?.enter(menu);
  }
  function confirmTask(title,detail) {
    if (dialog) return Promise.resolve(false);
    return new Promise(resolve => {
      dialog=document.createElement('dialog');dialog.className='messs-permission-dialog';
      const heading=document.createElement('h3');heading.textContent=title;
      const text=document.createElement('p');text.textContent=detail;
      const actions=document.createElement('footer');
      const cancel=document.createElement('button'),allow=document.createElement('button');
      cancel.textContent=label('Cancel','取消');allow.textContent=label('Allow','允许');allow.className='permission-allow';
      const finish=value=>{const el=dialog;dialog=null;el.close();el.remove();resolve(value);};
      cancel.onclick=()=>finish(false);allow.onclick=()=>finish(true);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      dialog._deny=()=>finish(false);
      actions.append(cancel,allow);dialog.append(heading,text,actions);document.body.append(dialog);
      dialog.showModal();cancel.focus();
    });
  }
  async function resetPermissions() {
    dialog?._deny();mode='ask';session=crypto.randomUUID();refresh();
    await window.messsAPI?.setAiPermissionMode?.({session,mode});
  }
  function refresh() {
    if (!initialized) return;
    document.getElementById('ai-assistant-upload').title=label('Add','添加');
    setMenuLabel(document.getElementById('ai-assistant-add-local'), 'folder-open', label('Add local files','添加本地文件'));
    setMenuLabel(document.querySelector('[data-assistant-kind="chat"]'), 'message-circle', label('Chat','对话'));
    setMenuLabel(document.querySelector('[data-assistant-kind="image"]'), 'image', label('Image','图片'));
    setMenuLabel(document.querySelector('[data-assistant-kind="video"]'), 'video', label('Video','视频'));
    permissionLabel(permissionButton, mode, mode==='full'?label('Full access','完全访问'):label('Ask permission','请求批准'));
    permissionButton.title=label('Messs permissions','Messs 权限');
    permissionMenu.querySelector('strong').textContent=label('Messs permissions','Messs 权限');
    const buttons=permissionMenu.querySelectorAll('button');
    permissionLabel(buttons[0], 'ask', label('Ask for each host operation','逐次请求批准'));
    permissionLabel(buttons[1], 'full', label('Full access for this session','本次会话完全访问'));
    buttons.forEach((b,i)=>b.setAttribute('aria-checked',String((i===1)===(mode==='full'))));
  }
  function init() {
    if (initialized) return;initialized=true;
    const trigger=document.getElementById('ai-assistant-upload');
    const addIcon = document.createElement('img');
    addIcon.src = 'assets/icons/lucide/plus.svg'; addIcon.alt = ''; addIcon.setAttribute('aria-hidden', 'true');
    trigger.replaceChildren(addIcon);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    addMenu=document.createElement('div');addMenu.id='ai-assistant-add-menu';addMenu.className='messs-composer-menu';addMenu.hidden=true;addMenu.setAttribute('role','menu');
    const local=document.createElement('button');local.id='ai-assistant-add-local';local.type='button';local.setAttribute('role','menuitem');addMenu.append(local);
    document.querySelectorAll('.ai-assistant-mode [data-assistant-kind]').forEach(button=>{button.setAttribute('role','menuitem');addMenu.append(button);});
    // Keep the existing delegated mode handler and upload workflow.
    document.querySelector('.ai-assistant-mode').append(addMenu);
    trigger.addEventListener('click',event=>{event.stopPropagation();openMenu(addMenu,trigger);});
    addMenu.addEventListener('click',event=>{if(event.target.closest('button'))closeMenus();});
    permissionButton=document.createElement('button');permissionButton.id='ai-assistant-permissions';permissionButton.type='button';permissionButton.setAttribute('aria-haspopup','menu');
    document.querySelector('.ai-assistant-model-picker').after(permissionButton);
    permissionMenu=document.createElement('div');permissionMenu.className='messs-composer-menu';permissionMenu.id='messs-permission-menu';permissionMenu.hidden=true;permissionMenu.setAttribute('role','menu');
    permissionMenu.append(document.createElement('strong'));
    for(const value of ['ask','full']) {
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitemradio');
      button.onclick=async()=>{
        closeMenus();const current=session;
        if(value==='full' && !await confirmTask(label('Allow Messs for this session?','允许 Messs 在本次会话中执行？'),label('System commands, internet access and local files. Commands may modify or delete files. Results are sent to the selected model. You can revoke access at any time.','可执行系统命令、联网和访问本地文件；命令可能修改或删除文件。结果会发送给当前模型，可随时撤销。')))return;
        if(current!==session)return;
        const result=await window.messsAPI.setAiPermissionMode({session,mode:value});mode=result.mode;refresh();
      };permissionMenu.append(button);
    }
    document.querySelector('.ai-assistant-tools').append(permissionMenu);
    permissionButton.onclick=event=>{event.stopPropagation();openMenu(permissionMenu,permissionButton);};
    document.addEventListener('click',event=>{if(!event.target.closest('.messs-composer-menu'))closeMenus();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();});
    window.addEventListener('resize',closeMenus);
    window.messsAPI?.onAiPermissionRequest?.(async request=>{
      const allowed=request.session===session && await confirmTask(label('Allow this Messs task?','是否允许本次 Messs 任务？'),`${({read:label('Read file','读取文件'),memory:label('Remember file locally','将文件加入本地知识库'),network:label('Access website','访问网站'),command:label('Run command','执行命令')})[request.type]}\n${request.target}\n${request.type === 'memory' ? label('Retrieved excerpts may be sent to the selected model.','检索到的片段可能会发送给当前模型。') : label('Results are sent to the selected model.','结果会发送给当前模型。')}`);
      await window.messsAPI.replyAiPermission({id:request.id,allow:!!allowed && request.session===session});
    });
    window.messsAPI?.onCloudSessionChanged?.(()=>void resetPermissions());
    refresh();
  }
  return {init,refresh,setMenuLabel,resetPermissions,get session(){return session;}};
})();
