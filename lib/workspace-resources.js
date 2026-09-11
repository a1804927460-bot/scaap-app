'use strict';
const { randomUUID } = require('node:crypto');
const yaml = require('js-yaml');
function parseSkill(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 64000) throw Error('SKILL.md 最大为 64 KB');
  const match = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw Error('SKILL.md 须包含 YAML 元数据和正文');
  const meta = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!meta || typeof meta.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name) || meta.name.length > 64) throw Error('技能名称须为小写英文、数字和连字符，最多 64 字符');
  if (typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1024) throw Error('技能描述须为 1–1024 字符');
  if (!match[2].trim()) throw Error('请填写技能正文');
  return { name: meta.name, description: meta.description.trim(), instructions: match[2].trim(), markdown: raw,
    model: typeof meta.model === 'string' ? meta.model.trim().slice(0, 120) : '',
    coverDataUrl: typeof meta.cover === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(meta.cover) ? meta.cover.slice(0, 400000) : '' };
}
function createResourceService(store, getOwner) {
  function owner() { return String(getOwner() || 'local'); }
  function rows() { return store.data.workspaceResources || []; }
  function list() { return structuredClone(rows().filter(r => r.ownerId === owner() && !r.deletedAt)); }
  function save(input) {
    if (!input || !['asset', 'asset-folder', 'skill'].includes(input.kind)) throw Error('资源类型无效');
    const all = rows(), scope = owner();
    const previous = input.id ? all.find(r => r.id === input.id && r.ownerId === scope) : null;
    if (input.id && !previous) throw Error('资源不存在');
    if (previous && previous.revision !== input.revision) throw Error('资源已在其他窗口更新，请重新打开');
    if (all.filter(r => r.ownerId === scope && !r.deletedAt).length >= 5000 && !previous) throw Error('资源库已达到 5000 条上限');
    let data;
    if (input.kind === 'asset-folder') {
      const name=String(input.name||'').trim();
      if (!name || name.length>120) throw Error('文件夹名称须为 1–120 个字符');
      data={name,parentId:input.parentId||null};
    } else if (input.kind === 'skill') data = { ...parseSkill(input.markdown),
      model: String(input.model || '').trim().slice(0, 120) || parseSkill(input.markdown).model,
      coverDataUrl: /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(input.coverDataUrl || '')) ? String(input.coverDataUrl).slice(0, 400000) : '' };
    else {
      if (!store.data.files.some(f => f.id === input.fileId)) throw Error('素材文件不存在，请先导入');
      if (!Array.isArray(input.tags) || input.tags.length > 12 || input.tags.some(t => typeof t !== 'string' || t.length > 40)) throw Error('最多 12 个标签，每个不超过 40 字');
      data = { fileId: input.fileId, tags: [...new Set(input.tags.map(t => t.trim()).filter(Boolean))], favorite: input.favorite === true };
      const existing = all.find(r => r.ownerId === scope && r.kind === 'asset' && r.fileId === input.fileId && !r.deletedAt);
      if (!previous && existing) return structuredClone(existing);
    }
    const record = { ...data, kind: input.kind, id: previous?.id || randomUUID(), ownerId: scope, revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() };
    write(previous ? all.map(r => r === previous ? record : r) : [...all, record]);
    return structuredClone(record);
  }
  function write(next) {
    const before = store.data.workspaceResources;
    store.data.workspaceResources = next;
    try { store.save(); } catch (error) { store.data.workspaceResources = before; throw error; }
  }
  function remove(input) {
    const previous = rows().find(r => r.id === input.id && r.ownerId === owner());
    if (!previous || previous.revision !== input.revision) throw Error('资源已变更，请刷新后重试');
    write(rows().map(r => r === previous ? { ...r, deletedAt: new Date().toISOString(), revision: r.revision + 1 } : r));
  }
  return { list, save, remove, parseSkill };
}
module.exports = { createResourceService, parseSkill };
