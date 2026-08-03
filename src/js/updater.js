'use strict';

let downloadedUpdateVersion = null;
let latestUpdaterState = null;

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
  if (version) version.textContent = `v${latestUpdaterState.currentVersion || '0.0.1'}`;
  ['auto-update-toggle', 'software-auto-update-toggle'].forEach((id) => {
    const toggle = document.getElementById(id);
    if (toggle) toggle.checked = latestUpdaterState.enabled !== false;
  });
  ['check-update-btn', 'software-check-update-btn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = latestUpdaterState.status === 'checking';
  });
}

function refreshUpdaterLanguage() {
  const installBtn = document.getElementById('update-install-btn');
  if (installBtn) {
    document.querySelector('.update-banner-text').textContent = t(
      'A new version has been downloaded. Restart to update.',
      '新版本已下载，重启即可更新。'
    );
    installBtn.textContent = downloadedUpdateVersion
      ? t(`Restart to install ${downloadedUpdateVersion}`, `重启安装 ${downloadedUpdateVersion}`)
      : t('Restart to update', '重启更新');
  }
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
    const banner = document.getElementById('update-banner');
    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add('is-visible'));
    downloadedUpdateVersion = info && info.version ? info.version : null;
    refreshUpdaterLanguage();
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
    banner.classList.remove('is-visible');
    setTimeout(() => { banner.hidden = true; }, 180);
  });
}
