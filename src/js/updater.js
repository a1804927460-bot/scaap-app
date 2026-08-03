'use strict';

let downloadedUpdateVersion = null;

function refreshUpdaterLanguage() {
  const installBtn = document.getElementById('update-install-btn');
  if (!installBtn) return;
  document.querySelector('.update-banner-text').textContent = t(
    'A new version has been downloaded. Restart to update.',
    '新版本已下载，重启即可更新。'
  );
  installBtn.textContent = downloadedUpdateVersion
    ? t(`Restart to install ${downloadedUpdateVersion}`, `重启安装 ${downloadedUpdateVersion}`)
    : t('Restart to update', '重启更新');
}

function initUpdater() {
  window.messsAPI.onUpdateDownloaded((info) => {
    const banner = document.getElementById('update-banner');
    banner.hidden = false;
    downloadedUpdateVersion = info && info.version ? info.version : null;
    refreshUpdaterLanguage();
  });

  document.getElementById('update-install-btn').addEventListener('click', () => {
    window.messsAPI.installUpdateNow();
  });

  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    document.getElementById('update-banner').hidden = true;
  });
}
