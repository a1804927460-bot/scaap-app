'use strict';

function normalizeAgentGeneratedFiles(files) {
  return Array.isArray(files) ? files.slice(0, 6).filter(file => file && file.name && file.token).map(file => ({
    token: String(file.token), name: String(file.name), mimeType: String(file.mimeType || 'application/octet-stream'),
    sizeBytes: Math.max(0, Number(file.sizeBytes) || 0)
  })) : [];
}

function renderAgentMessageContent(element, text) {
  const source = String(text || '');
  element._messageSource = source;
  const fragment = document.createDocumentFragment();
  function append(parent, tokens) {
    for (const token of tokens || []) {
      if (token.type === 'space' || token.type === 'def') continue;
      if (token.type === 'code' && ['messs-image', 'messs-open'].includes(token.lang)) {
        const card = createAgentAppAction(token.lang, token.text);
        if (card) { parent.append(card); continue; }
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
    append(fragment, marked.lexer(source, { gfm: true, breaks: true }));
    element.replaceChildren(fragment);
    element.classList.add('is-formatted-response');
  } catch {
    element.textContent = source;
    element.classList.remove('is-formatted-response');
  }
}

function createAgentAppAction(kind, raw) {
  let action;
  try { action = JSON.parse(raw); } catch { return null; }
  if (!action || typeof action !== 'object') return null;
  const pages = {schedule:'日程',files:'文件',assets:'素材库',skills:'技能'};
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
