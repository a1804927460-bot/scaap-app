'use strict';
const { randomUUID } = require('node:crypto');
const fail = message => { throw new Error(message); };
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('请填写有效日期');
  const d = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2199-12-31') fail('日期须在 2000 至 2199 年之间');
  return value;
}
function text(value, max, required = false) {
  const s = typeof value === 'string' ? value.trim() : '';
  if ((required && !s) || s.length > max) fail('请检查文字长度和必填项');
  return s;
}
function validate(input) {
  if (!input || typeof input !== 'object') fail('日程数据无效');
  const start = date(input.start), due = date(input.due);
  if (due < start) fail('交付日期不能早于开始日期');
  const progress = Number(input.progress);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail('进度须为 0–100 的整数');
  if (!['planned', 'active', 'blocked', 'done'].includes(input.status)) fail('项目状态无效');
  const milestones = input.milestones || [];
  if (!Array.isArray(milestones) || milestones.length > 50) fail('每个项目最多 50 个里程碑');
  return {
    title: text(input.title, 160, true), owner: text(input.owner, 100), notes: text(input.notes, 6000),
    canvasId: text(input.canvasId, 160), start, due,
    status: progress === 100 ? 'done' : input.status, progress: input.status === 'done' ? 100 : progress,
    milestones: milestones.map(m => {
      const day = date(m.date);
      if (day < start || day > due) fail('里程碑日期须在项目排期内');
      return { title: text(m.title, 160, true), date: day, done: m.done === true };
    })
  };
}
function createScheduleService(store, getOwner) {
  function bucket() {
    const owner = String(getOwner() || 'local');
    const entries = store.data.projectSchedules || [];
    return { owner, entries, rows: entries.filter(row => row.ownerId === owner) };
  }
  function list() { return structuredClone(bucket().rows); }
  function mutate(input, action = 'save') {
    const { owner, entries, rows } = bucket();
    const previous = input.id ? rows.find(row => row.id === input.id) : null;
    if (input.id && !previous) fail('项目不存在或不属于当前账号');
    if (previous && input.revision !== previous.revision) fail('项目已在其他窗口更新，请关闭编辑框并重新打开');
    if (!previous && action !== 'save') fail('项目不存在');
    if (!previous && rows.length >= 2000) fail('当前账号最多保存 2000 个项目');
    const now = new Date().toISOString();
    const next = action === 'save'
      ? { ...validate(input), deletedAt: previous?.deletedAt || null }
      : { ...previous, deletedAt: action === 'archive' ? now : null };
    const record = { ...next, id: previous?.id || randomUUID(), ownerId: owner,
      revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now,
      history: [...(previous?.history || []), { at: now, action, status: next.status, progress: next.progress, due: next.due }].slice(-100) };
    const updated = previous ? entries.map(row => row === previous ? record : row) : [...entries, record];
    const original = store.data.projectSchedules;
    store.data.projectSchedules = updated;
    try { store.save(); } catch (error) { store.data.projectSchedules = original; throw error; }
    return structuredClone(record);
  }
  return { list, save: input => mutate(input), archive: input => mutate(input, 'archive'), restore: input => mutate(input, 'restore') };
}
module.exports = { createScheduleService, validate };
