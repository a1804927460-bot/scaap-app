'use strict';

function normalizeAgentGeneratedFiles(files) {
  return Array.isArray(files) ? files.slice(0, 6).filter(file => file && file.name && file.token).map(file => ({
    token: String(file.token), name: String(file.name), mimeType: String(file.mimeType || 'application/octet-stream'),
    sizeBytes: Math.max(0, Number(file.sizeBytes) || 0)
  })) : [];
}

function stripAgentPrivateReasoning(text) {
  return String(text || '')
    .replace(/<(think|analysis|reasoning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|analysis|reasoning)(?:\s[^>]*)?>[\s\S]*$/gi, '')
    .replace(/```(?:analysis|reasoning|thinking)\b[^\r\n]*\r?\n[\s\S]*?(?:\r?\n```|$)/gi, '');
}

function stripAgentInternalNames(text) {
  return String(text || '')
    .replace(/\bclarify-generation-request\b/gi, '')
    .replace(/\bmesss-(?:question|image|open)\b/gi, '');
}

function agentVisiblePreviewText(text) {
  return stripAgentInternalNames(stripAgentPrivateReasoning(text)
    .replace(/```messs-[a-z0-9-]+\b[^\r\n]*\r?\n[\s\S]*?(?:\r?\n```|$)/gi, '')
  ).trim();
}

function agentVisibleUserText(text) {
  return String(text || '')
    .replace(/^提问\s+[^\r\n]+?\s+的回答：/u, '提问的回答：')
    .replace(/^Question\s+[^\r\n]+?\s+answers?:/i, 'Question answers:');
}

function leadingAgentJsonEnd(text) {
  const source = String(text || '');
  const start = source.search(/\S/);
  if (start < 0 || source[start] !== '{') return -1;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

function renderAgentMessageContent(element, text) {
  const source = String(text || '');
  element._messageSource = source;
  const fragment = document.createDocumentFragment();
  function append(parent, tokens) {
    for (const token of tokens || []) {
      if (token.type === 'space' || token.type === 'def') continue;
      if (token.type === 'code' && /^messs-/i.test(String(token.lang || ''))) {
        const kind = String(token.lang || '').toLowerCase();
        const card = ['messs-image', 'messs-open', 'messs-question'].includes(kind)
          ? createAgentAppAction(kind, token.text) : null;
        if (card) { card._source = element; parent.append(card); continue; }
        continue;
      }
      if (token.type === 'br') { parent.append(document.createElement('br')); continue; }
      if (token.type === 'hr') { parent.append(document.createElement('hr')); continue; }
      if (token.type === 'list') {
        const list = document.createElement(token.ordered ? 'ol' : 'ul');
        if (token.ordered && Number.isFinite(token.start)) list.start = token.start;
        for (const item of token.items) {
          const li = document.createElement('li');
          if (item.task) li.append(document.createTextNode(item.checked ? '[x] ' : '[ ] '));
          append(li, item.tokens); list.append(li);
        }
        parent.append(list); continue;
      }
      if (token.type === 'table') {
        const table = document.createElement('table');
        for (const [index, cells] of [token.header, ...token.rows].entries()) {
          const row = document.createElement('tr');
          for (const cell of cells) { const td = document.createElement(index ? 'td' : 'th'); append(td, cell.tokens); row.append(td); }
          table.append(row);
        }
        parent.append(table); continue;
      }
      const tags = { heading: 'h4', paragraph: 'p', blockquote: 'blockquote', strong: 'strong', em: 'em', del: 's', codespan: 'code', code: 'pre', link: 'span', image: 'span' };
      const tag = tags[token.type];
      if (tag) {
        const node = document.createElement(tag);
        if (token.tokens) append(node, token.tokens);
        else node.textContent = token.text || '';
        if (token.type === 'link' || token.type === 'image') node.append(document.createTextNode(` (${token.href || ''})`));
        parent.append(node);
        if (token.type === 'code' && /^---\r?\n/.test(token.text || '') && /\r?\n---(?:\r?\n|$)/.test(token.text || '')) {
          const save = document.createElement('button');
          save.type = 'button'; save.className = 'agent-save-skill'; save.textContent = '预览并保存到技能';
          save.onclick = async () => {
            try {
              await window.messsAPI.parseWorkspaceSkill(token.text);
              await window.MesssWorkHub.previewSkill(token.text);
            } catch (error) { save.textContent = error.message || '技能格式无效'; }
          };
          parent.append(save);
        }
      } else if (token.tokens) append(parent, token.tokens);
      else parent.append(document.createTextNode(token.text || token.raw || ''));
    }
  }
  try {
    const visibleSource = stripAgentPrivateReasoning(source);
    const protocol = /```(messs-[a-z0-9-]+)\b[^\r\n]*\r?\n/gi;
    let cursor = 0, match;
    const appendMarkdown = value => {
      const visible = stripAgentInternalNames(value);
      if (visible) append(fragment, marked.lexer(visible, { gfm: true, breaks: true }));
    };
    while ((match = protocol.exec(visibleSource))) {
      appendMarkdown(visibleSource.slice(cursor, match.index));
      const bodyStart = protocol.lastIndex;
      const remainder = visibleSource.slice(bodyStart);
      const closing = /\r?\n```[ \t]*(?:\r?\n|$)/.exec(remainder);
      const jsonEnd = leadingAgentJsonEnd(remainder);
      const raw = closing ? remainder.slice(0, closing.index) : (jsonEnd >= 0 ? remainder.slice(0, jsonEnd) : remainder);
      const kind = match[1].toLowerCase();
      const card = ['messs-image', 'messs-open', 'messs-question'].includes(kind)
        ? createAgentAppAction(kind, raw.trim()) : null;
      if (card) { card._source = element; fragment.append(card); }
      cursor = closing
        ? bodyStart + closing.index + closing[0].length
        : (jsonEnd >= 0 ? bodyStart + jsonEnd : visibleSource.length);
      protocol.lastIndex = cursor;
    }
    appendMarkdown(visibleSource.slice(cursor));
    if (!fragment.childNodes.length && visibleSource.trim()) {
      const fallback = document.createElement('p');
      fallback.textContent = '这条回复暂时无法显示，请重试。';
      fragment.append(fallback);
    }
    element.replaceChildren(fragment);
    element.classList.add('is-formatted-response');
  } catch {
    element.textContent = agentVisiblePreviewText(source) || '这条回复暂时无法显示，请重试。';
    element.classList.remove('is-formatted-response');
  }
}

function createAgentAppAction(kind, raw) {
  let action;
  try { action = JSON.parse(raw); } catch { return null; }
  if (!action || typeof action !== 'object') return null;
  if (kind === 'messs-question') return createAgentQuestionCard(action);
  const pages = {schedule:'日程',files:'文件',assets:'资产',skills:'技能'};
  if (kind === 'messs-open') {
    if (!Object.hasOwn(pages, action.page)) return null;
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'agent-save-skill'; button.textContent = `打开${pages[action.page]}`;
    button.onclick = () => window.MesssWorkHub.open(action.page);
    return button;
  }
  if (typeof action.providerId !== 'string' || !/^[\w-]{1,100}$/.test(action.providerId) ||
      typeof action.prompt !== 'string' || !action.prompt.trim() || action.prompt.length > 12000) return null;
  const card = document.createElement('div'); card.className = 'agent-native-action';
  const title = document.createElement('strong'); title.textContent = '生成图片';
  const description = document.createElement('p'); description.textContent = action.prompt;
  const status = document.createElement('p'); status.setAttribute('role','status');
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '查看模型和积分';
  card.append(title, description, status, button);
  let request, owner, submitted = false;
  button.onclick = async () => {
    if (submitted) return;
    button.disabled = true;
    const api = window.messsAPI;
    try {
      const currentOwner = (await api.getCloudSession())?.user?.id || 'local';
      if (!request) {
        const config = await api.getAiMediaConfig();
        const provider = config.imageProviders?.find(p => p.id === action.providerId && !p.hidden && p.hasApiKey && p.available !== false);
        if (!provider) throw Error('该图片模型当前不可用，请在图片功能中检查配置。');
        const size = provider.capabilities?.sizes?.[0] || '1K';
        const draft = {kind:'image',prompt:action.prompt,imageProviderId:provider.id,providerId:provider.id,count:1,size,aspectRatio:'1:1',quality:'auto',placeOnBoard:false};
        const quote = await api.quoteMediaCredits(draft);
        if (!Number.isFinite(quote?.totalCredits) || quote.totalCredits < 0) throw Error('暂时无法获取准确积分，请稍后重试。');
        owner = currentOwner; request = draft;
        title.textContent = provider.name;
        status.textContent = `1 张 · ${size} · 预计 ${quote.totalCredits} 积分，按实际生成结算。结果保存在文件中。`;
        button.textContent = '确认生成';
      } else {
        if (owner !== currentOwner) { request = null; throw Error('账号已切换，请重新查看积分。'); }
        submitted = true; button.textContent = '正在生成…';
        const result = await api.generateAiMedia(request);
        if ((await api.getCloudSession())?.user?.id !== (owner === 'local' ? undefined : owner)) throw Error('账号已切换，请回原账号查看生成结果。');
        if (!result?.ok || !result.files?.length) throw Error(result?.message || '生成未完成，请在文件页检查后重试。');
        const files = result.files;
        AppState.files = [...files, ...AppState.files.filter(f => !files.some(next => next.id === f.id))];
        await confirmAiMediaDeliveries(files);
        for (const file of files) {
          const preview = document.createElement('button'); preview.type = 'button';
          const img = document.createElement('img'); img.src = file.thumbUrl || file.url; img.alt = file.name;
          preview.append(img); preview.onclick = () => selectFileForPreview(file.id); card.append(preview);
        }
        status.textContent = '图片已生成并保存到文件。'; button.textContent = '已完成';
      }
    } catch (error) {
      status.textContent = error.message || '操作未完成';
      if (submitted) button.textContent = '请到文件页检查结果';
    } finally { button.disabled = submitted; }
  };
  return card;
}

function createAgentQuestionCard(action) {
  if (!action.questionId || !Array.isArray(action.questions) || !action.questions.length) return null;
  const questions = action.questions.slice(0, 12).filter(q => q && q.id && q.label && Array.isArray(q.options));
  if (!questions.length) return null;
  const card = document.createElement('section'); card.className = 'agent-question-card';
  card.setAttribute('aria-label', action.title || '提问');
  const head = document.createElement('div'); head.className = 'agent-question-head';
  const title = document.createElement('strong'); title.textContent = action.title || '提问';
  const page = document.createElement('span'); page.textContent = `${questions.length} 个问题`;
  head.append(title, page); card.append(head);
  const form = document.createElement('div'); form.className = 'agent-question-form';
  const values = Object.create(null); const custom = Object.create(null);
  questions.forEach((q, index) => {
    const block = document.createElement('fieldset'); block.className = 'agent-question-block';
    const legend = document.createElement('legend'); legend.textContent = q.label; block.append(legend);
    q.options.slice(0, 16).forEach((option, optionIndex) => {
      if (!option || !option.id || !option.label) return;
      const label = document.createElement('label'); label.className = 'agent-question-option';
      const input = document.createElement('input'); input.type = q.type === 'multi' ? 'checkbox' : 'radio'; input.name = `agent-question-${action.questionId}-${q.id}`; input.value = option.id;
      input.onchange = () => { if (q.type === 'multi') { values[q.id] = [...block.querySelectorAll('input:checked')].map(x => x.value); } else values[q.id] = input.value; custom[q.id] = ''; if (option.allowCustom) custom[q.id] = customInput.value.trim(); submit.disabled = false; };
      const text = document.createElement('span'); text.textContent = `${String.fromCharCode(65 + optionIndex)}  ${option.label}`; label.append(input, text);
      let customInput = null;
      if (option.allowCustom) { customInput = document.createElement('input'); customInput.className = 'agent-question-custom'; customInput.placeholder = '请填写…'; customInput.oninput = () => { input.checked = true; input.dispatchEvent(new Event('change')); custom[q.id] = customInput.value.trim(); submit.disabled = false; }; label.append(customInput); }
      block.append(label);
    }); form.append(block);
  }); card.append(form);
  const actions = document.createElement('div'); actions.className = 'agent-question-actions';
  const skip = document.createElement('button'); skip.type = 'button'; skip.textContent = '跳过';
  const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = '提交'; submit.disabled = true;
  const status = document.createElement('div'); status.setAttribute('role','status'); card.append(status);
  const finish = async skipped => {
    if (card.dataset.done || card.dataset.sending) return;
    if (!skipped && questions.some(q => {
      const selected=[].concat(values[q.id] || []);
      return !selected.length || (q.options.some(o => selected.includes(o.id) && o.allowCustom) && !custom[q.id]);
    })) { status.textContent='请完成每个问题；选择其他时请填写内容。'; return; }
    card.dataset.sending='true'; skip.disabled=submit.disabled=true;
    status.textContent='正在提交回答…';
    try {
      await window.MesssAgentQuestionAnswer({questionId:action.questionId, questions, answers:skipped?{}:values, customAnswers:skipped?{}:custom, skipped},card);
      card.dataset.done='true'; card.hidden=true; syncAgentQuestionDocks();
    } catch(error) { status.textContent=error.message || '提交失败，请重试'; }
    finally { delete card.dataset.sending; if (!card.dataset.done) skip.disabled=submit.disabled=false; }
  };
  skip.onclick = () => finish(true); submit.onclick = () => finish(false); actions.append(skip, submit); card.append(actions); return card;
}

window.MesssAgentQuestionAnswer = async function(payload,card) {
  const message='提问的回答：\n'+(payload.skipped?'跳过，请根据已有信息继续。':payload.questions.map(q=>{
    const ids=[].concat(payload.answers[q.id]||[]);
    return 'Q: '+q.label+'\nA: '+q.options.filter(o=>ids.includes(o.id)).map(o=>o.label).join('、')+(payload.customAnswers[q.id]?'：'+payload.customAnswers[q.id]:'');
  }).join('\n'));
  if(card._surface==='canvas') {
    if(card._canvasId !== (typeof activeCanvasId === 'function' ? activeCanvasId() : null) || card._session!==CanvasWorkspace.activeAgentSessionId) throw Error('请回到原画布会话后提交。');
    if(CanvasWorkspace.agentBusy) throw Error('Agent 正在回复，请稍后提交。');
    await requestCanvasAgentText({displayPrompt:message,contextualPrompt:canvasAgentPrompt(message)});
  } else if(card._surface==='main') {
    if(card._session!==AiAssistant.activeSessionId) throw Error('请回到原主会话后提交。');
    if(AiAssistant.busy||AiAssistant.queueRunning) throw Error('Agent 正在回复，请稍后提交。');
    if(AiAssistant.queuePaused || AiAssistant.queueEditing || AiAssistant.queueDragging) throw Error('待发队列已暂停或正在编辑，请先恢复队列后提交。');
    if(AiAssistant.queue.length >= 50) throw Error('待发队列已满，请先发送或移除待发消息。');
    if(AiAssistant.kind && AiAssistant.kind !== 'chat') throw Error('请切回 Agent 对话模式后提交回答。');
    const provider=selectedAssistantProvider(); if(!provider) throw Error('请先选择可用的 Agent 模型。');
    AiAssistant.queue.push({id:crypto.randomUUID(),prompt:message,provider:{...provider},attachments:[],kind:'chat',sessionId:card._session,permissionSession:window.MesssComposerActions?.session,routingStrategy:window.MesssAiProviderOptions?.routingStrategy(provider.model,AiAssistant.chatUsePreset!==false),options:{}});
    renderAssistantQueue(); void drainAssistantQueue();
  } else throw Error('无法确定原会话，请重新打开对话。');
};
function syncAgentQuestionDocks() {
  for(const surface of ['main','canvas']) {
    const base=surface==='main'?'ai-assistant':'board-agent';
    const list=document.getElementById(base+'-messages'), form=document.getElementById(base+'-form'); if(!list||!form) continue;
    let dock=document.getElementById(base+'-questions');
    if(!dock) { dock=document.createElement('div'); dock.id=base+'-questions'; dock.className='agent-question-dock'; form.before(dock); }
    for(const card of list.querySelectorAll('.agent-question-card')) {
      if(card.closest('.is-pending')) continue;
      const anchor=document.createElement('span'); anchor.className='agent-question-anchor'; anchor.textContent='请在输入框上方选择';
      card.before(anchor); anchor._card=card; card._anchor=anchor; card._surface=surface;
      card._canvasId = surface === 'canvas' && typeof activeCanvasId === 'function' ? activeCanvasId() : null;
      card._session=card._source?._questionSession||(surface==='main'?AiAssistant.activeSessionId:CanvasWorkspace.activeAgentSessionId);
      card.dataset.surface=surface; card.dataset.session=card._session || ''; card.remove();
    }
    const anchor=[...list.querySelectorAll('.agent-question-anchor')].at(-1); let active=anchor?._card;
    if(active) {
      const rows=[...list.children], row=anchor.closest('.ai-assistant-message, .board-agent-message');
      if(active.dataset.done||rows.slice(rows.indexOf(row)+1).some(r=>r.classList.contains('is-user'))) {
        if(anchor.textContent!=='提问已结束') anchor.textContent='提问已结束'; active=null;
      }
    }
    if(dock.firstElementChild!==(active||null)) { dock.replaceChildren(); if(active) dock.append(active); }
    dock.hidden=!active;
    const style=getComputedStyle(form); dock.style.width=style.width; dock.style.marginLeft=style.marginLeft; dock.style.marginRight=style.marginRight;
  }
}
if(typeof MutationObserver!=='undefined') {
  const start=()=>{
    for(const id of ['ai-assistant-messages','board-agent-messages']) {
      const list=document.getElementById(id); if(list) new MutationObserver(syncAgentQuestionDocks).observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }
    if (typeof ResizeObserver !== 'undefined') { const resize = new ResizeObserver(syncAgentQuestionDocks); for (const id of ['ai-assistant-form','board-agent-form']) { const form=document.getElementById(id); if(form) resize.observe(form); } }
    window.addEventListener('resize',syncAgentQuestionDocks); syncAgentQuestionDocks();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
}
