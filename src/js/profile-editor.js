'use strict';

const PROFILE_EMOJIS = ['😀', '😎', '🥳', '🤩', '😺', '🦊', '🐼', '🐻', '🐰', '🐸', '🤖', '👽'];
const profileEmojiImages = new Map();
function profileEmojiAvatar(index) {
  if (profileEmojiImages.has(index)) return profileEmojiImages.get(index);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ['#dbeafe', '#e0e7ff', '#fce7f3', '#dcfce7', '#fef3c7', '#ede9fe'][index % 6];
  ctx.fillRect(0, 0, 256, 256);
  ctx.font = '164px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(PROFILE_EMOJIS[index], 128, 137);
  const image = canvas.toDataURL('image/webp', 0.95); profileEmojiImages.set(index, image); return image;
}

const PROFILE_MOODS = [
  ['', '不设置', 'Not set'], ['focus', '专注中', 'Focused'],
  ['inspired', '灵感来了', 'Inspired'], ['happy', '好心情', 'Happy'],
  ['busy', '忙碌中', 'Busy'], ['rest', '休息一下', 'Resting']
];

function renderProfileMood(mood) {
  const entry = PROFILE_MOODS.find(item => item[0] === mood) || PROFILE_MOODS[0];
  document.querySelectorAll('.account-footer-copy, .account-popover-head > span:last-child').forEach(copy => {
    let badge = copy.querySelector('.profile-mood-badge');
    if (!badge) { badge = document.createElement('small'); badge.className = 'profile-mood-badge'; copy.append(badge); }
    badge.hidden = !entry[0];
    badge.dataset.mood = entry[0];
    badge.textContent = t(entry[2], entry[1]);
  });
}

async function refreshProfileMood() {
  const result = await window.messsAPI.getProfileMood?.().catch(() => null);
  if (result && result.userId === activeAccountAvatarUserId) renderProfileMood(result.mood);
  else renderProfileMood('');
}

function openProfileEditor() {
  if (document.getElementById('profile-editor')) return;
  const userId = activeAccountAvatarUserId;
  if (!userId) { showToast(t('Sign in to edit your profile.', '请先登录再编辑资料。')); return; }
  const focusBefore = document.activeElement;
  document.getElementById('account-popover').hidden = true;
  const dialog = document.createElement('dialog');
  dialog.id = 'profile-editor';
  dialog.setAttribute('aria-labelledby', 'profile-editor-title');
  dialog.innerHTML = `
    <form method="dialog" class="profile-editor-form">
      <header><h2 id="profile-editor-title">${t('Your profile', '个人资料')}</h2><button type="button" class="profile-editor-close" aria-label="${t('Close', '关闭')}">&times;</button></header>
      <div class="profile-editor-preview"><img alt=""><div><strong></strong><small></small><span></span></div></div>
      <div class="profile-avatar-actions"><strong>${t('Avatar', '头像')}</strong><button type="button" data-profile-upload>${t('Upload avatar', '上传头像')}</button><button type="button" data-profile-random>${t('Surprise me', '随机一个')}</button></div>
      <div class="profile-avatar-grid" role="group" aria-label="${t('Default avatars', '默认头像')}"></div>
      <label>${t('Name', '名字')}<input name="name" maxlength="80" required autocomplete="nickname"></label>
      <label>${t('Signature', '个性签名')}<input name="signature" maxlength="120" autocomplete="off"></label>
      <fieldset><legend>${t('Mood', '此刻心情')}</legend><div class="profile-mood-options"></div></fieldset>
      <p class="profile-editor-status" role="status"></p>
      <footer><button type="button" data-profile-cancel>${t('Cancel', '取消')}</button><button type="submit" class="profile-editor-save">${t('Save changes', '保存修改')}</button></footer>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const name = form.elements.namedItem('name'), signature = form.elements.namedItem('signature');
  name.value = accountProfileDisplayName || accountProfileFallbackName;
  signature.value = accountProfileSignature;
  let preset = null, avatarDataUrl = '', mood = '', busy = false, moodTouched = false;
  const currentImage = document.querySelector('#account-footer-avatar img');
  const preview = dialog.querySelector('.profile-editor-preview img');
  preview.src = currentImage?.src || profileEmojiAvatar(0);
  const status = dialog.querySelector('.profile-editor-status');
  const update = () => {
    dialog.querySelector('.profile-editor-preview strong').textContent = name.value || t('Your name', '你的名字');
    dialog.querySelector('.profile-editor-preview small').textContent = signature.value;
    const entry = PROFILE_MOODS.find(item => item[0] === mood) || PROFILE_MOODS[0];
    dialog.querySelector('.profile-editor-preview span').textContent = mood ? t(entry[2], entry[1]) : '';
    dialog.querySelectorAll('[data-avatar]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.avatar) === preset)));
  };
  const choose = value => { preset = value; avatarDataUrl = profileEmojiAvatar(value - 1); preview.src = avatarDataUrl; update(); };
  for (let i = 1; i <= 12; i++) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.avatar = String(i);
    button.setAttribute('aria-label', `${PROFILE_EMOJIS[i - 1]} ${t('Avatar', '头像')} ${i}`);
    const image = document.createElement('img'); image.src = profileEmojiAvatar(i - 1); image.alt = ''; image.draggable = false;
    button.append(image); button.addEventListener('click', () => choose(i)); dialog.querySelector('.profile-avatar-grid').append(button);
  }
  PROFILE_MOODS.forEach(entry => {
    const label = document.createElement('label'), radio = document.createElement('input'), text = document.createElement('span');
    radio.type = 'radio'; radio.name = 'mood'; radio.value = entry[0]; radio.checked = !entry[0];
    text.textContent = t(entry[2], entry[1]); label.dataset.mood = entry[0];
    label.append(radio, text); dialog.querySelector('.profile-mood-options').append(label);
    radio.addEventListener('change', () => { moodTouched = true; mood = entry[0]; update(); });
  });
  window.messsAPI.getProfileMood?.().then(result => {
    if (!dialog.isConnected || result.userId !== userId || moodTouched) return;
    mood = PROFILE_MOODS.some(entry => entry[0] === result.mood) ? result.mood : '';
    [...form.elements.namedItem('mood')].forEach(input => { input.checked = input.value === mood; }); update();
  }).catch(() => {});
  const close = () => { if (busy) return; dialog.close(); dialog.remove(); focusBefore?.focus(); };
  dialog.querySelector('.profile-editor-close').onclick = close;
  dialog.querySelector('[data-profile-cancel]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  name.addEventListener('input', update); signature.addEventListener('input', update);
  dialog.querySelector('[data-profile-random]').onclick = () => choose(preset ? (preset + Math.floor(Math.random() * 11)) % 12 + 1 : Math.floor(Math.random() * 12) + 1);
  const setBusy = value => { busy = value; form.querySelectorAll('button,input').forEach(input => { input.disabled = value; }); };
  dialog.querySelector('[data-profile-upload]').onclick = async () => {
    setBusy(true);
    try {
      const result = await window.messsAPI.previewProfileAvatar();
      if (result?.ok) { preset = null; avatarDataUrl = result.dataUrl; preview.src = avatarDataUrl; update(); }
      else if (result?.reason !== 'cancelled') status.textContent = t('Could not load this image.', '无法读取这张图片。');
    } catch { status.textContent = t('Could not load this image.', '无法读取这张图片。'); }
    finally { setBusy(false); }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (!name.value.trim()) { name.focus(); return; }
    setBusy(true); status.textContent = t('Saving...', '正在保存…');
    try {
      const result = await window.messsAPI.saveProfileDraft({ userId, name: name.value, signature: signature.value, preset: null, avatarDataUrl, mood });
      if (!result?.ok || activeAccountAvatarUserId !== userId) throw new Error();
      accountProfileDisplayName = result.name; accountProfileSignature = result.signature;
      renderAccountProfileText(); renderAccountAvatars(result.name[0].toUpperCase(), result.dataUrl); renderProfileMood(result.mood);
      document.dispatchEvent(new CustomEvent('messs:profile-avatar-updated', { detail: { userId, dataUrl: result.dataUrl || '' } }));
      setBusy(false); close();
    } catch { status.textContent = t('Could not save. Check your account and retry.', '保存失败，请检查登录状态后重试。'); }
    finally { setBusy(false); }
  });
  update(); dialog.showModal(); name.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const head = document.querySelector('.account-popover-head');
  head?.setAttribute('tabindex', '0'); head?.setAttribute('role', 'button');
  head?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); openProfileEditor(); }, true);
  head?.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProfileEditor(); } });
  document.addEventListener('messs:language-changed', () => void refreshProfileMood());
  window.messsAPI.onCloudSessionChanged?.(() => { document.getElementById('profile-editor')?.remove(); void refreshProfileMood(); });
  void refreshProfileMood();
});
