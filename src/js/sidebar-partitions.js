'use strict';
function initSidebarPartitions() {
  const brand = document.getElementById('sidebar-brand-btn');
  if (!brand || document.getElementById('workspace-shortcuts')) return;
  const nav = document.createElement('nav');
  nav.id = 'workspace-shortcuts'; nav.className = 'workspace-shortcuts';
  nav.setAttribute('aria-label', '工作分区');
  for (const [id, label, icon] of [['schedule','日程','calendar-days'],['files','文件','folder'],['assets','素材库','images'],['skills','技能','sparkles']]) {
    const button = document.createElement('button');
    button.type='button'; button.dataset.workspaceArea=id; button.title=label; button.setAttribute('aria-label',label);
    const paths = {
      schedule: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
      files: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
      assets: '<rect x="6" y="3" width="15" height="15" rx="3"/><path d="M3 7v12a2 2 0 0 0 2 2h12M7 15l4-4 3 3 3-2 3 3"/><circle cx="16" cy="7" r="1"/>',
      skills: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
    };
    button.innerHTML = `<span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]}</svg></span><small>${label}</small>`;
    button.addEventListener('click',()=>window.MesssWorkHub.open(id)); nav.append(button);
  }
  (brand.closest('.sidebar-brand-row') || brand).after(nav);
  document.getElementById('collapse-sidebar-btn')?.addEventListener('click', toggleSidebarCollapsed);
  const quick = document.createElement('div');
  quick.className = 'sidebar-rail-actions';
  const buttons = [
    ['搜索文件', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', () => { setSidebarCollapsed(false); document.getElementById('search-input').focus(); }],
    ['导入文件', '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>', () => document.getElementById('import-btn').click()],
    ['新建文件夹', '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Zm9 3v6m-3-3h6"/>', () => document.getElementById('add-folder-btn').click()]
  ];
  for (const [label, path, run] of buttons) {
    const button = document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);
    button.innerHTML=`<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    button.addEventListener('click',run);quick.append(button);
  }
  nav.after(quick);
}
document.addEventListener('DOMContentLoaded',initSidebarPartitions);
