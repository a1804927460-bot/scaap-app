'use strict';

let downloadedUpdateVersion = null;
let latestUpdaterState = null;
let dismissedUpdateVersion = null;

function showUpdateBanner(state = latestUpdaterState, force = false) {
  const banner = document.getElementById('update-banner');
  const text = banner && banner.querySelector('.update-banner-text');
  const installBtn = document.getElementById('update-install-btn');
  if (!banner || !text || !installBtn || !state) return;

  const status = state.status;
  const version = state.availableVersion || downloadedUpdateVersion || '';
  const isRelevant = ['available', 'downloading', 'downloaded'].includes(status);
  if (!isRelevant || (!force && dismissedUpdateVersion && dismissedUpdateVersion === version)) return;

  if (status === 'downloaded') {
    downloadedUpdateVersion = version || downloadedUpdateVersion;
    text.textContent = t(
      `Version ${version || ''} is ready. Restart to update.`,
      `新版本 ${version || ''} 已准备好，重启即可更新。`
    );
    installBtn.disabled = false;
    installBtn.textContent = version
      ? t(`Restart to install ${version}`, `重启安装 ${version}`)
      : t('Restart to update', '重启更新');
  } else if (status === 'downloading') {
    const progress = Math.round(Number(state.progress) || 0);
    text.textContent = t(
      `A new version ${version || ''} was found and is downloading automatically.`,
      `发现新版本 ${version || ''}，正在自动下载。`
    );
    installBtn.disabled = true;
    installBtn.textContent = t(`Downloading ${progress}%`, `下载中 ${progress}%`);
  } else {
    text.textContent = t(
      `A new version ${version || ''} is available.`,
      `发现新版本 ${version || ''}。`
    );
    installBtn.disabled = true;
    installBtn.textContent = t('Update available', '有可用更新');
  }

  banner.hidden = false;
  requestAnimationFrame(() => banner.classList.add('is-visible'));
}

function updaterStatusText(state) {
  const status = state && state.status || 'idle';
  const version = state && state.availableVersion;
  const progress = Math.round(Number(state && state.progress) || 0);
  const labels = {
    idle: t('Ready to check', '可检查更新'),
    disabled: t('Automatic updates are off', '自动更新已关闭'),
    development: t('Available after installation', '安装正式版后可用'),
    checking: t('Checking for updates...', '正在检查更新...'),
    available: t(`Version ${version || ''} is available`, `发现版本 ${version || ''}`),
    downloading: t(`Downloading ${version || ''} · ${progress}%`, `正在下载 ${version || ''} · ${progress}%`),
    downloaded: t(`Version ${version || ''} is ready to install`, `版本 ${version || ''} 已可安装`),
    'up-to-date': t('You are up to date', '当前已是最新版本'),
    error: t('Update check failed', '更新检查失败')
  };
  return labels[status] || labels.idle;
}

function renderUpdaterState(state) {
  latestUpdaterState = state || latestUpdaterState || {};
  const text = updaterStatusText(latestUpdaterState);
  ['account-update-status', 'software-update-status'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  });
  const version = document.getElementById('software-update-version');
  if (version && latestUpdaterState.currentVersion) {
    version.textContent = `v${latestUpdaterState.currentVersion}`;
  }
  ['auto-update-toggle', 'software-auto-update-toggle'].forEach((id) => {
    const toggle = document.getElementById(id);
    if (toggle) toggle.checked = latestUpdaterState.enabled !== false;
  });
  ['check-update-btn', 'software-check-update-btn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = latestUpdaterState.status === 'checking';
  });
  showUpdateBanner(latestUpdaterState);
}

function refreshUpdaterLanguage() {
  renderUpdaterState(latestUpdaterState);
}

async function checkUpdateFromSettings() {
  renderUpdaterState({ ...latestUpdaterState, status: 'checking' });
  const result = await window.messsAPI.checkForUpdatesNow();
  renderUpdaterState(result);
}

function initUpdater() {
  window.messsAPI.onUpdateStatus(renderUpdaterState);
  window.messsAPI.onUpdateDownloaded((info) => {
    downloadedUpdateVersion = info && info.version ? info.version : null;
    dismissedUpdateVersion = null;
    showUpdateBanner({
      ...(latestUpdaterState || {}),
      status: 'downloaded',
      availableVersion: downloadedUpdateVersion,
      progress: 100
    }, true);
  });

  window.messsAPI.getUpdateState().then(renderUpdaterState);
  ['check-update-btn', 'software-check-update-btn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', checkUpdateFromSettings);
  });
  ['auto-update-toggle', 'software-auto-update-toggle'].forEach((id) => {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.addEventListener('change', async () => {
      renderUpdaterState(await window.messsAPI.setAutoUpdateEnabled(toggle.checked));
    });
  });

  document.getElementById('update-install-btn').addEventListener('click', () => window.messsAPI.installUpdateNow());
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    const banner = document.getElementById('update-banner');
    dismissedUpdateVersion = latestUpdaterState && latestUpdaterState.availableVersion
      || downloadedUpdateVersion
      || null;
    banner.classList.remove('is-visible');
    setTimeout(() => { banner.hidden = true; }, 180);
  });
}
