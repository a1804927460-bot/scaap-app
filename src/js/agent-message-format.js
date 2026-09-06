'use strict';

function renderAgentMessageContent(element, text) {
  const source = String(text || '');
  const fragment = document.createDocumentFragment();
  function append(parent, tokens) {
    for (const token of tokens || []) {
      if (token.type === 'space' || token.type === 'def') continue;
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
