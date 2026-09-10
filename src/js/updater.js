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
  const isRelevant = ['available', 'downloading', 'downloaded', 'installing'].includes(status);
  if (!isRelevant || (!force && dismissedUpdateVersion && dismissedUpdateVersion === version)) return;

  if (status === 'installing') {
    text.textContent = state.platform === 'darwin'
      ? t(
        'The macOS update is opening. Approve the update if macOS asks, then Messs will restart automatically.',
        '正在打开 macOS 更新，请按系统提示允许更新，Messs 会自动重启。'
      )
      : t(
        'Updating automatically. Messs will restart; approve the Windows permission prompt if shown.',
        '正在自动更新，完成后将重新打开；如出现 Windows 权限提示，请允许本次更新。'
      );
    installBtn.disabled = true;
    installBtn.textContent = t('Updating...', '正在更新...');
  } else if (status === 'downloaded') {
    downloadedUpdateVersion = version || downloadedUpdateVersion;
    text.textContent = t(
      `Version ${version || ''} is ready. It will install when you quit, or restart now.`,
      `新版本 ${version || ''} 已下载，退出软件时自动安装，也可立即重启更新。`
    );
    installBtn.disabled = false;
    installBtn.textContent = version
      ? t(`Restart to update ${version}`, `重启更新 ${version}`)
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
    installing: t('Installing update...', '正在自动安装更新...'),
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
  const progress = document.querySelector('.update-banner-progress');
  if (progress) {
    const downloading = latestUpdaterState.status === 'downloading';
    const percent = Math.max(0, Math.min(100, Math.round(Number(latestUpdaterState.progress) || 0)));
    progress.hidden = !downloading;
    progress.setAttribute('aria-valuenow', String(percent));
    const fill = progress.querySelector('span');
    if (fill) fill.style.width = `${percent}%`;
  }
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

  document.getElementById('update-install-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = latestUpdaterState && latestUpdaterState.platform === 'darwin'
      ? t('Opening macOS update...', '正在打开 macOS 更新...')
      : t('Updating...', '正在更新...');
    renderUpdaterState({ ...(latestUpdaterState || {}), status: 'installing', progress: 100 });
    try {
      const result = await window.messsAPI.installUpdateNow();
      if (!result || !result.ok) {
        button.disabled = false;
        renderUpdaterState({ ...(latestUpdaterState || {}), status: 'downloaded', progress: 100 });
        showToast(t(
          'The update installer could not be opened. Please try again.',
          '无法打开更新安装程序，请重试。'
        ));
      }
    } catch (error) {
      button.disabled = false;
      renderUpdaterState({ ...(latestUpdaterState || {}), status: 'downloaded', progress: 100 });
      showToast(t('The update installer could not be opened.', '无法打开更新安装程序。'));
    }
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    const banner = document.getElementById('update-banner');
    dismissedUpdateVersion = latestUpdaterState && latestUpdaterState.availableVersion
      || downloadedUpdateVersion
      || null;
    banner.classList.remove('is-visible');
    setTimeout(() => { banner.hidden = true; }, 180);
  });
}
