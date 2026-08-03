'use strict';
/* In-place document editor for txt/docx files. */

let editorStatusKey = 'saved';

const EDITOR_STATUS_TEXT = {
  loading: ['Loading...', '加载中...'],
  saved: ['Saved', '已保存'],
  'load-failed': ['Load failed', '加载失败'],
  saving: ['Saving...', '保存中...'],
  'save-failed': ['Save failed', '保存失败'],
  unsaved: ['Unsaved changes', '有未保存更改'],
  unsupported: ['Unsupported', '不支持']
};

function setEditorSaveStatus(key) {
  editorStatusKey = EDITOR_STATUS_TEXT[key] ? key : 'saved';
  const [en, zh] = EDITOR_STATUS_TEXT[editorStatusKey];
  document.getElementById('editor-save-status').textContent = t(en, zh);
}

function refreshEditorLanguage() {
  setEditorSaveStatus(editorStatusKey);
}

async function openDocumentEditor(fileId) {
  const f = AppState.files.find((x) => x.id === fileId);
  if (!f) return;

  document.getElementById('editor-overlay').hidden = false;
  document.getElementById('editor-overlay').dataset.fileId = f.id;
  document.getElementById('editor-filename').textContent = f.name;

  const textarea = document.getElementById('editor-textarea');
  const richtext = document.getElementById('editor-richtext');
  const toolbar = document.getElementById('editor-toolbar');
  textarea.hidden = true;
  richtext.hidden = true;
  toolbar.hidden = true;

  if ((f.ext || '').toLowerCase() === '.txt') {
    textarea.hidden = false;
    setEditorSaveStatus('loading');
    const res = await window.messsAPI.readTextFile(f.id);
    if (res.ok) {
      textarea.value = res.content || '';
      setEditorSaveStatus('saved');
    } else {
      textarea.value = '';
      setEditorSaveStatus('load-failed');
      textarea.placeholder = t('This text file could not be loaded.', '这个文本文件无法加载。');
    }
    textarea.focus();
    return;
  }

  if ((f.ext || '').toLowerCase() === '.docx') {
    richtext.hidden = false;
    toolbar.hidden = false;
    setEditorSaveStatus('loading');
    const res = await window.messsAPI.readDocxAsHtml(f.id);
    if (res.ok) {
      richtext.innerHTML = res.html || '<p></p>';
      setEditorSaveStatus('saved');
    } else {
      richtext.innerHTML = `<p style="color:#e05c5c">${t('This Word document could not be loaded.', '这个 Word 文档无法加载。')}</p>`;
      setEditorSaveStatus('load-failed');
    }
    richtext.focus();
    return;
  }

  setEditorSaveStatus('unsupported');
}

async function saveEditorContent() {
  const overlay = document.getElementById('editor-overlay');
  if (overlay.hidden) return;

  const fileId = overlay.dataset.fileId;
  const f = AppState.files.find((x) => x.id === fileId);
  if (!f) return;

  const textarea = document.getElementById('editor-textarea');
  const richtext = document.getElementById('editor-richtext');
  const isTxt = !textarea.hidden;

  setEditorSaveStatus('saving');
  if (isTxt) {
    const res = await window.messsAPI.saveTextFile(f.id, textarea.value);
    setEditorSaveStatus(res.ok ? 'saved' : 'save-failed');
  } else {
    const res = await window.messsAPI.saveDocxFile(f.id, richtext.innerHTML);
    setEditorSaveStatus(res.ok ? 'saved' : 'save-failed');
  }
}

function hasUnsavedEditorWork() {
  return !document.getElementById('editor-overlay').hidden;
}

function initDocumentEditor() {
  document.getElementById('editor-close').addEventListener('click', async () => {
    await saveEditorContent();
    document.getElementById('editor-overlay').hidden = true;
    delete document.getElementById('editor-overlay').dataset.fileId;
  });

  document.getElementById('editor-bold').addEventListener('click', () => document.execCommand('bold'));
  document.getElementById('editor-italic').addEventListener('click', () => document.execCommand('italic'));
  document.getElementById('editor-underline').addEventListener('click', () => document.execCommand('underline'));

  document.getElementById('editor-textarea').addEventListener('input', () => setEditorSaveStatus('unsaved'));
  document.getElementById('editor-richtext').addEventListener('input', () => setEditorSaveStatus('unsaved'));
}
