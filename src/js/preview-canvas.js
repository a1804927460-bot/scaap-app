'use strict';
/* Preview canvas: drag files in to import, click sidebar item to preview, zoom + fullscreen.
   Supports these preview states:
   - image: shows the image directly
   - video / audio: native <video>/<audio> playback, no external tool needed
   - text: read-only display of the file's text content
   - document-html: safe in-process Word fallback when LibreOffice is not available
   - pages: a rendered document (pdf/docx/pptx/xlsx/psd/tiff/...) shown page by page, with page nav
   - unsupported: format we can't render inline, with "open externally" / "reveal" fallbacks
*/

let previewZoom = 1;
// The scale that makes the current image fully visible in the canvas
// (computed per-image once its natural size is known). The displayed "100%"
// always means "fully shown, as big as it can be" �?previewZoom is a
// multiplier *relative to that*, not relative to native pixel size, per
// spec: "点击或者拖入图片，这个预览画布直接显示到百分之100最�?.
let previewFitScale = 1;
let previewPanX = 0, previewPanY = 0;
const PreviewDoc = { mode: 'static', pageUrls: [], currentPage: 1, pdfPath: null, totalPages: 1 };
const AudioPreviewCleanup = { current: null };
const VideoPreviewCleanup = { current: null };
let videoPreviewEpoch = 0;
let previewRequestEpoch = 0;
const FullscreenPreviewCleanup = { current: null };
const FullscreenPreviewState = { sourceVideo: null, cloneVideo: null };
const PreviewPanCleanup = { current: null };
const PreviewLanguageState = { unsupported: null };

/** Re-centers the previewed image (clears any click-drag pan offset). Used
    when zoom changes �?without this, an existing pan offset gets visually
    amplified by the new scale (since the translate happens in the image's
    own, unscaled coordinate space, inside the stage that then gets scaled
    as a whole), making the image drift further off-center the more you
    zoom instead of staying anchored to the canvas's actual center. */
function resetPreviewPan() {
  previewPanX = 0;
  previewPanY = 0;
  const img = document.querySelector('#preview-stage img');
  if (img) img.style.transform = 'translate(0px, 0px)';
}

const UNSUPPORTED_REASON_TEXT = {
  'unknown-format': ['This file format cannot be previewed in the app.', '这个文件格式暂时无法在应用内预览。'],
  'render-failed': ['Preview could not be generated. The file may be damaged or use an unsupported codec.', '预览生成失败，文件可能已损坏或使用了不支持的编码。'],
  'not-found': ['This file is no longer in the library.', '这个文件已不在资料库中。']
};

function missingToolsMessage(missingTools) {
  const tools = missingTools && missingTools.length ? missingTools : ['LibreOffice', 'ImageMagick'];
  return t(
    `Preview requires: ${tools.join(', ')}. Install or bundle the tool, then restart Messs.`,
    `预览需要：${tools.join(', ')}。安装或内置工具后，请重启 Messs。`
  );
}
function setPreviewPanelState(state) {
  // state: 'empty' | 'loading' | 'image' | 'video' | 'audio' | 'model' | 'text' | 'binary' | 'pages' | 'unsupported' | 'folder-grid'
  document.getElementById('preview-empty').hidden = state !== 'empty';
  document.getElementById('preview-loading').hidden = state !== 'loading';
  document.getElementById('preview-stage').hidden = !['image', 'pages', 'video', 'audio', 'model', 'text', 'document-html', 'binary'].includes(state);
  document.getElementById('preview-unsupported').hidden = state !== 'unsupported';
  document.getElementById('preview-page-nav').hidden = state !== 'pages';
  document.getElementById('preview-folder-grid').hidden = state !== 'folder-grid';
  document.getElementById('view-mode-toggle').hidden = state !== 'folder-grid';
  document.getElementById('preview-stage').classList.toggle('is-image-preview', state === 'image');
}

function clearPreview() {
  videoPreviewEpoch += 1;
  previewRequestEpoch += 1;
  if (AudioPreviewCleanup.current) { AudioPreviewCleanup.current(); AudioPreviewCleanup.current = null; }
  if (VideoPreviewCleanup.current) { VideoPreviewCleanup.current(); VideoPreviewCleanup.current = null; }
  if (PreviewPanCleanup.current) { PreviewPanCleanup.current(); PreviewPanCleanup.current = null; }
  PreviewLanguageState.unsupported = null;
  AppState.activeFileId = null;
  PreviewDoc.pageUrls = [];
  PreviewDoc.currentPage = 1;
  document.getElementById('preview-stage').innerHTML = '';
  document.getElementById('preview-back-btn').hidden = true;
  hideFileDetailPanel();
  if (AppState.folderGridVisible) {
    renderFolderGridIfActive();
  } else {
    setPreviewPanelState('empty');
  }
  document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('is-active'));
}

async function selectFileForPreview(id) {
  const f = AppState.files.find((x) => x.id === id);
  if (!f) return;
  const requestEpoch = ++previewRequestEpoch;
  videoPreviewEpoch += 1;
  if (AudioPreviewCleanup.current) { AudioPreviewCleanup.current(); AudioPreviewCleanup.current = null; }
  if (VideoPreviewCleanup.current) { VideoPreviewCleanup.current(); VideoPreviewCleanup.current = null; }
  if (PreviewPanCleanup.current) { PreviewPanCleanup.current(); PreviewPanCleanup.current = null; }
  AppState.activeFileId = id;

  document.querySelectorAll('.file-item, .folder-grid-item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.fileId === id);
  });
  showFileDetailPanel(f);
  document.getElementById('preview-back-btn').hidden = !AppState.folderGridVisible;

  setPreviewPanelState('loading');
  PreviewLanguageState.unsupported = null;
  previewZoom = 1;
  previewFitScale = 1;
  updatePreviewZoomUI();

  const result = await window.messsAPI.getPreview(id);

  // The user may have clicked a different file while this was loading.
  if (AppState.activeFileId !== id || requestEpoch !== previewRequestEpoch) return;

  const renderers = {
    image: renderImagePreview,
    pages: renderPagedPreview,
    'pdf-js': renderPdfJsPreview,
    video: renderVideoPreview,
    audio: renderAudioPreview,
    model: renderModelPreview,
    text: renderTextPreview,
    'document-html': renderDocumentHtmlPreview,
    binary: renderBinaryPreview
  };
  (renderers[result.type] || renderUnsupportedPreview)(id, result);
}

function createVideoPlayer(video, { fullscreen = false, onPlaybackFailure = null } = {}) {
  const shell = document.createElement('div');
  shell.className = `messs-video-player${fullscreen ? ' is-fullscreen-player' : ' is-inline-player'}`;
  video.controls = false;
  video.preload = fullscreen ? 'auto' : 'metadata';
  video.playsInline = true;
  shell.appendChild(video);

  const controls = document.createElement('div');
  controls.className = 'video-control-capsule';
  controls.innerHTML = `
    <button type="button" class="video-control-btn video-play-toggle" title="${t('Play/Pause', '播放/暂停')}" aria-label="${t('Play/Pause', '播放/暂停')}">
      <svg class="video-icon-play" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="m7 4 13 8-13 8z"/></svg>
      <svg class="video-icon-pause" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" hidden><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
    </button>
    <input class="video-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="${t('Video progress', '视频进度')}" />
    <span class="video-time-label"><span class="video-time-current">0:00</span><span aria-hidden="true">/</span><span class="video-time-total">--:--</span></span>
    ${fullscreen ? `
      <div class="video-volume-group">
        <button type="button" class="video-control-btn video-mute-toggle" title="${t('Mute', '静音')}" aria-label="${t('Mute', '静音')}">
          <svg class="video-icon-volume" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/></svg>
          <svg class="video-icon-muted" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" hidden><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 10 5 5M21 10l-5 5"/></svg>
        </button>
        <input class="video-volume" type="range" min="0" max="1" value="0.82" step="0.01" aria-label="${t('Volume', '音量')}" />
      </div>` : ''}
  `;
  shell.appendChild(controls);

  const controller = new AbortController();
  const { signal } = controller;
  const playButton = controls.querySelector('.video-play-toggle');
  const playIcon = controls.querySelector('.video-icon-play');
  const pauseIcon = controls.querySelector('.video-icon-pause');
  const seek = controls.querySelector('.video-seek');
  const currentLabel = controls.querySelector('.video-time-current');
  const totalLabel = controls.querySelector('.video-time-total');
  const muteButton = controls.querySelector('.video-mute-toggle');
  const volume = controls.querySelector('.video-volume');
  const volumeIcon = controls.querySelector('.video-icon-volume');
  const mutedIcon = controls.querySelector('.video-icon-muted');
  let lastVolume = 0.82;
  let seeking = false;

  video.volume = Math.min(1, Math.max(0, Number(video.volume) || lastVolume));
  const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const setProgressFill = (fraction) => seek.style.setProperty('--video-progress', `${Math.max(0, Math.min(1, fraction)) * 100}%`);
  const updatePosition = () => {
    const total = duration();
    if (!seeking) {
      const fraction = total ? video.currentTime / total : 0;
      seek.value = String(Math.round(fraction * 1000));
      setProgressFill(fraction);
      currentLabel.textContent = formatTime(video.currentTime);
    }
    totalLabel.textContent = total ? formatTime(total) : '--:--';
  };
  const updatePlayState = () => {
    const playing = !video.paused && !video.ended;
    playIcon.hidden = playing;
    pauseIcon.hidden = !playing;
    shell.classList.toggle('is-playing', playing);
  };
  const updateVolume = () => {
    if (!muteButton) return;
    const muted = video.muted || video.volume === 0;
    volumeIcon.hidden = muted;
    mutedIcon.hidden = !muted;
    muteButton.classList.toggle('is-active', muted);
    volume.value = String(muted ? 0 : video.volume);
  };
  const togglePlayback = () => {
    if (video.paused || video.ended) {
      const playback = video.play();
      if (playback && typeof playback.catch === 'function') {
        playback.catch((error) => {
          if (typeof onPlaybackFailure === 'function') onPlaybackFailure(error);
        });
      }
    }
    else video.pause();
  };

  playButton.addEventListener('click', togglePlayback, { signal });
  video.addEventListener('click', togglePlayback, { signal });
  video.addEventListener('play', updatePlayState, { signal });
  video.addEventListener('pause', updatePlayState, { signal });
  video.addEventListener('ended', updatePlayState, { signal });
  video.addEventListener('loadedmetadata', updatePosition, { signal });
  video.addEventListener('durationchange', updatePosition, { signal });
  video.addEventListener('timeupdate', updatePosition, { signal });
  seek.addEventListener('pointerdown', () => { seeking = true; }, { signal });
  seek.addEventListener('input', () => {
    const total = duration();
    const fraction = Number(seek.value) / 1000;
    setProgressFill(fraction);
    currentLabel.textContent = total ? formatTime(total * fraction) : '0:00';
  }, { signal });
  const commitSeek = () => {
    if (!seeking) return;
    const total = duration();
    if (total) video.currentTime = total * Number(seek.value) / 1000;
    seeking = false;
    updatePosition();
  };
  seek.addEventListener('change', () => {
    seeking = true;
    commitSeek();
  }, { signal });
  document.addEventListener('pointerup', commitSeek, { signal });
  document.addEventListener('pointercancel', commitSeek, { signal });

  if (muteButton && volume) {
    muteButton.addEventListener('click', () => {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        video.volume = lastVolume || 0.82;
      } else {
        lastVolume = video.volume;
        video.muted = true;
      }
    }, { signal });
    volume.addEventListener('input', () => {
      video.muted = false;
      video.volume = Number(volume.value);
      if (video.volume > 0) lastVolume = video.volume;
    }, { signal });
    video.addEventListener('volumechange', updateVolume, { signal });
    updateVolume();
  }
  updatePosition();
  updatePlayState();

  return {
    shell,
    signal,
    cleanup() {
      controller.abort();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  };
}

function monitorVideoPlayback(video, signal, onFailure) {
  let watchdog = 0;
  let failed = false;
  const clear = () => {
    clearTimeout(watchdog);
    watchdog = 0;
  };
  const fail = () => {
    if (failed || signal.aborted) return;
    failed = true;
    clear();
    onFailure();
  };
  const arm = () => {
    if (failed || signal.aborted) return;
    clear();
    const startedAt = Number(video.currentTime) || 0;
    watchdog = window.setTimeout(() => {
      watchdog = 0;
      if (signal.aborted || video.paused || Number(video.currentTime) > startedAt + 0.04) return;
      fail();
    }, 2600);
  };
  const handlePlayFailure = (error) => {
    if (error && error.name === 'NotSupportedError') fail();
    else arm();
  };
  const reset = () => {
    clear();
    failed = false;
  };
  video.addEventListener('playing', clear, { signal });
  video.addEventListener('pause', clear, { signal });
  video.addEventListener('waiting', () => { if (!video.paused) arm(); }, { signal });
  video.addEventListener('stalled', () => { if (!video.paused) arm(); }, { signal });
  video.addEventListener('error', fail, { signal });
  signal.addEventListener('abort', clear, { once: true });
  return { arm, clear, fail, reset, handlePlayFailure };
}

function renderVideoPreview(id, result) {
  const epoch = videoPreviewEpoch;
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const video = document.createElement('video');
  video.src = result.url;
  video.dataset.usingTranscode = result.transcoded ? 'true' : '';
  video.autoplay = false;
  let playbackMonitor = null;
  const recover = () => { void handleVideoPlaybackFailure(id, result, video, epoch); };
  const player = createVideoPlayer(video, {
    onPlaybackFailure: (error) => playbackMonitor && playbackMonitor.handlePlayFailure(error)
  });
  playbackMonitor = monitorVideoPlayback(video, player.signal, recover);
  video.addEventListener('dblclick', openFullscreenPreview, { signal: player.signal });
  VideoPreviewCleanup.current = player.cleanup;
  stage.appendChild(player.shell);
  setPreviewPanelState('video');
}

/**
 * The browser's native player can't decode every codec a video file might
 * use (ProRes 422/4444 being the classic example) �?when that happens, ask
 * the main process to transcode it to a plain H.264 MP4 (cached after the
 * first time) and retry with that instead of giving up immediately.
 */
async function handleVideoPlaybackFailure(id, result, videoEl, epoch) {
  if (epoch !== videoPreviewEpoch || AppState.activeFileId !== id || !videoEl.isConnected) return;
  if (videoEl.dataset.triedTranscode || videoEl.dataset.usingTranscode === 'true') {
    renderUnsupportedPreview(id, { ...result, reason: 'render-failed' });
    return;
  }
  videoEl.dataset.triedTranscode = '1';
  if (VideoPreviewCleanup.current) { VideoPreviewCleanup.current(); VideoPreviewCleanup.current = null; }

  const stage = document.getElementById('preview-stage');
  stage.innerHTML = `<div class="preview-empty-sub">${t('Video codec is being converted for preview...', '这个视频的编码格式比较特殊，正在转换为可以直接播放的格式...')}</div>`;

  const res = await window.messsAPI.transcodeVideo(id);
  if (epoch !== videoPreviewEpoch || AppState.activeFileId !== id || !stage.isConnected) return;

  if (!res.ok) {
    const reason = res.reason === 'missing-tools' ? 'missing-tools' : 'render-failed';
    renderUnsupportedPreview(id, { ...result, reason, missingTools: res.missingTools });
    return;
  }

  stage.innerHTML = '';
  const video = document.createElement('video');
  video.src = res.url;
  let playbackMonitor = null;
  const fail = () => {
    if (epoch === videoPreviewEpoch && AppState.activeFileId === id && video.isConnected) {
      renderUnsupportedPreview(id, { ...result, reason: 'render-failed' });
    }
  };
  const player = createVideoPlayer(video, {
    onPlaybackFailure: (error) => playbackMonitor && playbackMonitor.handlePlayFailure(error)
  });
  playbackMonitor = monitorVideoPlayback(video, player.signal, fail);
  video.addEventListener('dblclick', openFullscreenPreview, { signal: player.signal });
  VideoPreviewCleanup.current = player.cleanup;
  stage.appendChild(player.shell);
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function renderAudioPreview(id, result) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'audio-preview';
  const extension = String(result.name || '').split('.').pop().toUpperCase().slice(0, 5) || 'AUDIO';
  const waveformBarCount = 72;
  const waveformBars = Array.from({ length: waveformBarCount }, () => '<i style="--wave-height:12%"></i>').join('');
  wrap.innerHTML = `
    <div class="audio-player-card">
      <div class="audio-artwork" aria-hidden="true">
        <div class="audio-artwork-ring audio-artwork-ring-outer"></div>
        <div class="audio-artwork-ring audio-artwork-ring-inner"></div>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>
        <span class="audio-format-badge">${escapeHtml(extension)}</span>
      </div>
      <div class="audio-player-main">
        <div class="audio-track-copy">
          <div class="audio-track-kicker">${t('NOW PLAYING', '正在播放')}</div>
          <div class="audio-preview-name" title="${escapeHtml(result.name)}">${escapeHtml(result.name)}</div>
          <div class="audio-track-subtitle">${t('High quality audio preview', '高质量音频预览')}</div>
        </div>
        <div class="audio-waveform-shell">
          <div class="audio-waveform is-loading" aria-hidden="true">${waveformBars}</div>
          <input type="range" class="audio-seek" min="0" max="1000" value="0" step="1" aria-label="${t('Audio progress', '音频进度')}" />
        </div>
        <div class="audio-time-row">
          <span class="audio-time audio-time-current">0:00</span>
          <span class="audio-time audio-time-total">--:--</span>
        </div>
        <div class="audio-controls">
          <div class="audio-transport">
            <button class="audio-control-btn audio-skip-back" aria-label="${t('Back 10 seconds', '后退 10 秒')}" title="${t('Back 10 seconds', '后退 10 秒')}">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 8H5V4"/><path d="M5.5 8A8 8 0 1 1 4 14"/><path d="M10 11v5M14 11v5"/></svg>
            </button>
            <button class="audio-play-btn audio-primary-btn" aria-label="${t('Play', '播放')}" title="${t('Play', '播放')}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="7 4 20 12 7 20"/></svg>
            </button>
            <button class="audio-pause-btn audio-primary-btn" aria-label="${t('Pause', '暂停')}" title="${t('Pause', '暂停')}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            </button>
            <button class="audio-control-btn audio-skip-forward" aria-label="${t('Forward 10 seconds', '前进 10 秒')}" title="${t('Forward 10 seconds', '前进 10 秒')}">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 8h4V4"/><path d="M18.5 8A8 8 0 1 0 20 14"/><path d="M10 11v5M14 11v5"/></svg>
            </button>
          </div>
          <div class="audio-options">
            <button class="audio-control-btn audio-mute-btn" aria-label="${t('Mute', '静音')}" title="${t('Mute', '静音')}">
              <svg class="audio-icon-volume" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/></svg>
              <svg class="audio-icon-muted" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" hidden><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 10 5 5M21 10l-5 5"/></svg>
            </button>
            <input type="range" class="audio-volume" min="0" max="1" value="0.82" step="0.01" aria-label="${t('Volume', '音量')}" />
            <button class="audio-speed-btn" aria-label="${t('Playback speed', '播放速度')}" title="${t('Playback speed', '播放速度')}">1x</button>
          </div>
        </div>
      </div>
    </div>`;
  stage.appendChild(wrap);

  const audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.src = result.url;
  const playBtn = wrap.querySelector('.audio-play-btn');
  const pauseBtn = wrap.querySelector('.audio-pause-btn');
  const seekEl = wrap.querySelector('.audio-seek');
  const waveform = wrap.querySelector('.audio-waveform');
  const waveformBarsEls = Array.from(waveform.children);
  const currentLabel = wrap.querySelector('.audio-time-current');
  const totalLabel = wrap.querySelector('.audio-time-total');
  const skipBackBtn = wrap.querySelector('.audio-skip-back');
  const skipForwardBtn = wrap.querySelector('.audio-skip-forward');
  const muteBtn = wrap.querySelector('.audio-mute-btn');
  const volumeEl = wrap.querySelector('.audio-volume');
  const volumeIcon = wrap.querySelector('.audio-icon-volume');
  const mutedIcon = wrap.querySelector('.audio-icon-muted');
  const speedBtn = wrap.querySelector('.audio-speed-btn');
  let duration = 0;
  let isScrubbing = false;
  let lastVolume = 0.82;
  let playbackFrame = 0;
  const speeds = [0.75, 1, 1.25, 1.5, 2];

  audioEl.volume = lastVolume;
  const updateWaveform = (fraction) => {
    const playedCount = Math.round(Math.max(0, Math.min(1, fraction)) * waveformBarsEls.length);
    waveformBarsEls.forEach((bar, index) => bar.classList.toggle('is-played', index < playedCount));
  };
  const updatePlaybackPosition = () => {
    if (!isScrubbing) {
      currentLabel.textContent = formatTime(audioEl.currentTime);
      if (duration) {
        const fraction = audioEl.currentTime / duration;
        seekEl.value = String(Math.round(fraction * 1000));
        updateWaveform(fraction);
      }
    }
  };
  const animatePlayback = () => {
    updatePlaybackPosition();
    if (!audioEl.paused) playbackFrame = requestAnimationFrame(animatePlayback);
  };
  const updateTransportUI = () => {
    playBtn.classList.toggle('is-active', !audioEl.paused);
    pauseBtn.classList.toggle('is-active', audioEl.paused);
  };
  const updateVolumeUI = () => {
    const muted = audioEl.muted || audioEl.volume === 0;
    volumeIcon.hidden = muted;
    mutedIcon.hidden = !muted;
    muteBtn.classList.toggle('is-active', muted);
    volumeEl.value = String(muted ? 0 : audioEl.volume);
  };
  const updateDuration = () => {
    if (isFinite(audioEl.duration) && audioEl.duration > 0) {
      duration = audioEl.duration;
      totalLabel.textContent = formatTime(duration);
    }
  };
  audioEl.addEventListener('loadedmetadata', updateDuration);
  audioEl.addEventListener('durationchange', updateDuration);
  audioEl.addEventListener('timeupdate', updatePlaybackPosition);
  seekEl.addEventListener('input', () => {
    isScrubbing = true;
    const fraction = seekEl.value / 1000;
    if (duration) currentLabel.textContent = formatTime(fraction * duration);
    updateWaveform(fraction);
  });
  const commitSeek = () => {
    if (!isScrubbing || !duration) return;
    audioEl.currentTime = seekEl.value / 1000 * duration;
    isScrubbing = false;
  };
  seekEl.addEventListener('change', commitSeek);
  document.addEventListener('mouseup', commitSeek);
  playBtn.addEventListener('click', () => audioEl.play().catch(() => {}));
  pauseBtn.addEventListener('click', () => audioEl.pause());
  skipBackBtn.addEventListener('click', () => { audioEl.currentTime = Math.max(0, audioEl.currentTime - 10); });
  skipForwardBtn.addEventListener('click', () => { audioEl.currentTime = Math.min(duration || Infinity, audioEl.currentTime + 10); });
  volumeEl.addEventListener('input', () => {
    audioEl.muted = false;
    audioEl.volume = Number(volumeEl.value);
    if (audioEl.volume > 0) lastVolume = audioEl.volume;
    updateVolumeUI();
  });
  muteBtn.addEventListener('click', () => {
    if (audioEl.muted || audioEl.volume === 0) {
      audioEl.muted = false;
      audioEl.volume = lastVolume || 0.82;
    } else {
      lastVolume = audioEl.volume;
      audioEl.muted = true;
    }
    updateVolumeUI();
  });
  speedBtn.addEventListener('click', () => {
    const currentIndex = speeds.indexOf(audioEl.playbackRate);
    audioEl.playbackRate = speeds[(currentIndex + 1) % speeds.length];
    speedBtn.textContent = `${audioEl.playbackRate}x`;
  });
  audioEl.addEventListener('play', () => {
    cancelAnimationFrame(playbackFrame);
    updateTransportUI();
    playbackFrame = requestAnimationFrame(animatePlayback);
  });
  audioEl.addEventListener('pause', () => {
    cancelAnimationFrame(playbackFrame);
    updatePlaybackPosition();
    updateTransportUI();
  });
  audioEl.addEventListener('ended', () => { seekEl.value = '0'; currentLabel.textContent = '0:00'; updateWaveform(0); });
  audioEl.addEventListener('error', () => handleAudioPlaybackFailure(id, result, audioEl), { once: true });
  AudioPreviewCleanup.current = () => {
    cancelAnimationFrame(playbackFrame); audioEl.pause(); audioEl.src = ''; document.removeEventListener('mouseup', commitSeek);
  };
  window.messsAPI.getAudioWaveform(id, waveformBarCount).then((waveformResult) => {
    if (AppState.activeFileId !== id || !document.body.contains(waveform)) return;
    waveform.classList.remove('is-loading');
    if (!waveformResult.ok || !Array.isArray(waveformResult.peaks)) return;
    waveformResult.peaks.forEach((peak, index) => {
      if (waveformBarsEls[index]) waveformBarsEls[index].style.setProperty('--wave-height', `${Math.round(10 + peak * 86)}%`);
    });
  }).catch(() => waveform.classList.remove('is-loading'));
  updateVolumeUI();
  updateTransportUI();
  setPreviewPanelState('audio');
}
async function handleAudioPlaybackFailure(id, result, audioEl) {
  if (audioEl.dataset.triedTranscode) {
    renderUnsupportedPreview(id, { ...result, reason: 'render-failed' });
    return;
  }
  audioEl.dataset.triedTranscode = '1';
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = `<div class="preview-empty-sub">${t('Audio codec is being converted for preview...', '正在转换音频编码以便预览...')}</div>`;
  const res = await window.messsAPI.transcodeAudio(id);
  if (AppState.activeFileId !== id) return;
  if (!res.ok) {
    renderUnsupportedPreview(id, { ...result, reason: res.reason === 'missing-tools' ? 'missing-tools' : 'render-failed', missingTools: res.missingTools });
    return;
  }
  renderAudioPreview(id, { ...result, url: res.url });
}

function renderTextPreview(id, result) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'text-preview-shell';
  const pre = document.createElement('pre');
  pre.className = 'text-preview';
  if (result.content && result.content.trim().length > 0) {
    pre.textContent = result.content;
  } else {
    pre.classList.add('is-empty');
    pre.textContent = t('(This file is empty.)', '（这个文件没有内容）');
  }
  if (result.partial) {
    const notice = document.createElement('div');
    notice.className = 'text-preview-notice';
    notice.textContent = t(
      'Showing the first 2 MB of this file.',
      '当前仅显示这个文件的前 2 MB。',
      '이 파일의 처음 2MB만 표시됩니다.'
    );
    shell.appendChild(notice);
  }
  shell.appendChild(pre);
  stage.appendChild(shell);
  setPreviewPanelState('text');
}

function renderDocumentHtmlPreview(id, result) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const article = document.createElement('article');
  article.className = 'document-html-preview';
  article.setAttribute('aria-label', result.name || t('Document preview', '文档预览'));
  // The main process sanitizes Mammoth output before it crosses the IPC
  // boundary. Keep insertion in a dedicated article so document styles never
  // leak into the rest of the application.
  article.innerHTML = String(result.html || '');
  if (!article.textContent.trim() && !article.querySelector('img, table')) {
    article.textContent = t('(This document is empty.)', '（这个文档为空。）');
    article.classList.add('is-empty');
  }
  stage.appendChild(article);
  setPreviewPanelState('document-html');
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function renderModelPreview(id, result) {
  const stage = document.getElementById('preview-stage');
  const file = AppState.files.find((entry) => entry.id === id);
  stage.innerHTML = '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'model-preview-launch';
  button.setAttribute('aria-label', t('Open 3D model', '打开 3D 模型', '3D 모델 열기'));
  button.title = t('Open 3D model', '打开 3D 模型', '3D 모델 열기');
  const format = String(result.format || (file && file.ext) || '3D').replace(/^\./, '').toUpperCase();
  button.innerHTML = `
    <span class="model-preview-orbit" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="m24 7 15 8.5v17L24 41 9 32.5v-17L24 7Z"></path>
        <path d="m9 15.5 15 8.5 15-8.5M24 24v17"></path>
      </svg>
    </span>
    <span class="model-preview-format">${escapeHtml(format)}</span>
    <strong>${escapeHtml(result.name || file && file.name || t('3D model', '3D 模型', '3D 모델'))}</strong>`;
  button.addEventListener('click', () => {
    if (file && typeof openBoardModelViewer === 'function') openBoardModelViewer(file);
  });
  stage.appendChild(button);
  setPreviewPanelState('model');
}

function renderBinaryPreview(id, result) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const panel = document.createElement('section');
  panel.className = 'binary-preview';
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const hexRows = rows.map((row) => `
    <div class="binary-row">
      <span class="binary-offset">${escapeHtml(row.offset)}</span>
      <span class="binary-hex">${escapeHtml(row.hex)}</span>
      <span class="binary-ascii">${escapeHtml(row.ascii)}</span>
    </div>`).join('');
  const modified = result.modifiedAt
    ? new Date(result.modifiedAt).toLocaleString(appLocale(), { hour12: false })
    : '--';
  panel.innerHTML = `
    <header class="binary-header">
      <div class="binary-file-mark">${escapeHtml((result.ext || 'BIN').replace('.', '').toUpperCase().slice(0, 5) || 'BIN')}</div>
      <div class="binary-heading">
        <div class="binary-kicker">${t('UNIVERSAL FILE INSPECTOR', '通用文件检查器')}</div>
        <h3 title="${escapeHtml(result.name || t('File', '文件'))}">${escapeHtml(result.name || t('File', '文件'))}</h3>
        <p>${escapeHtml(result.kind || t('Binary data', '二进制数据'))}</p>
      </div>
    </header>
    <div class="binary-meta">
      <div><span>${t('File Size', '文件大小')}</span><strong>${formatFileSize(result.sizeBytes)}</strong></div>
      <div><span>${t('Modified', '修改时间')}</span><strong>${escapeHtml(modified)}</strong></div>
      <div><span>${t('File Signature', '文件头签名')}</span><strong>${escapeHtml(result.signature || '--')}</strong></div>
    </div>
    <div class="binary-code" role="region" aria-label="${t('Binary content', '二进制内容')}">
      <div class="binary-code-head"><span>OFFSET</span><span>HEX DATA</span><span>ASCII</span></div>
      ${hexRows || `<div class="binary-empty">${t('Empty file', '空文件')}</div>`}
    </div>`;
  stage.appendChild(panel);
  setPreviewPanelState('binary');
}

function renderImagePreview(id, result) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const img = document.createElement('img');
  img.alt = result.name;
  img.style.transform = 'translate(0px, 0px)';
  resetPreviewPan();
  // "100%" always means "the whole image, as big as it can be shown" �?the
  // actual CSS scale needed to achieve that (previewFitScale) is computed
  // once natural dimensions are known, and previewZoom (kept at 1 here)
  // is purely a multiplier on top of it from then on.
  img.addEventListener('load', () => {
    previewFitScale = 1;
    previewZoom = 1;
    updatePreviewZoomUI();
  }, { once: true });
  img.src = result.url;
  stage.appendChild(img);
  setPreviewPanelState('image');
  makePreviewImageDraggable(img, id);
}

/** Fits the whole image to the available preview area and treats that fitted
    presentation as the user's 100%. Small images are enlarged as well as
    large images being reduced, so opening an image immediately uses the
    useful canvas area instead of showing a tiny native-size thumbnail. */
/** Lets the user click-and-drag the image within the preview stage to pan
    around (useful for zoomed-in detail inspection), while a plain click
    (no movement) still kicks off the native HTML5 drag so the image can
    still be dropped onto the board canvas as before. */
function makePreviewImageDraggable(img, fileId) {
  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0;
  const controller = new AbortController();
  const { signal } = controller;
  const panRunner = createLatestFrameRunner((point) => {
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    if (Math.abs(dx - previewPanX) > 3 || Math.abs(dy - previewPanY) > 3) moved = true;
    previewPanX = dx;
    previewPanY = dy;
    img.style.transform = `translate3d(${previewPanX}px, ${previewPanY}px, 0)`;
  });

  img.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX - previewPanX;
    startY = e.clientY - previewPanY;
    img.classList.add('is-panning');
    e.preventDefault();
  }, { signal });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panRunner.push({ clientX: e.clientX, clientY: e.clientY });
  }, { signal });

  document.addEventListener('mouseup', () => {
    panRunner.flush();
    if (dragging) img.classList.remove('is-panning');
    dragging = false;
  }, { signal });

  // Double-click resets the pan position back to centered.
  img.addEventListener('dblclick', () => resetPreviewPan(), { signal });

  // Still draggable out to the board canvas �?only when the gesture didn't
  // actually pan the image (a real drag-and-drop, not a click-drag-pan).
  img.draggable = true;
  img.addEventListener('dragstart', (e) => {
    if (moved) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-messs-file-id', fileId);
    e.dataTransfer.effectAllowed = 'copy';
  }, { signal });

  PreviewPanCleanup.current = () => {
    panRunner.cancel();
    dragging = false;
    img.classList.remove('is-panning');
    controller.abort();
  };
}

function renderPagedPreview(id, result) {
  PreviewDoc.mode = 'static';
  PreviewDoc.pageUrls = result.pageUrls;
  PreviewDoc.currentPage = 1;
  renderCurrentDocPage();
  updatePageNavUI();
  setPreviewPanelState('pages');
}

/** PDFs and office documents (already converted to a PDF by main.js) �?    pages are rendered on demand by pdfjs-dist running in the preload
    script, not pre-rendered ahead of time, so flipping to a page you
    haven't viewed yet has a brief render step instead of being instant. */
async function renderPdfJsPreview(id, result) {
  PreviewDoc.mode = 'pdfjs';
  PreviewDoc.pdfPath = result.path;
  PreviewDoc.currentPage = 1;
  PreviewDoc.pageUrls = []; // total page count isn't known until the first render resolves
  setPreviewPanelState('loading');

  try {
    const { dataUrl, totalPages } = await window.messsAPI.renderPdfPage(result.path, 1, previewZoom + 0.5);
    if (AppState.activeFileId !== id) return;
    PreviewDoc.totalPages = totalPages;
    showDocPageImage(dataUrl);
    updatePageNavUI();
    setPreviewPanelState('pages');
  } catch (err) {
    console.error('PDF render failed:', err);
    if (AppState.activeFileId === id) {
      renderUnsupportedPreview(id, { ...result, reason: 'render-failed' });
    }
  }
}

function showDocPageImage(url) {
  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = `Page ${PreviewDoc.currentPage}`;
  stage.appendChild(img);
}

async function renderCurrentDocPage() {
  if (PreviewDoc.mode === 'pdfjs') {
    setPreviewPanelState('loading');
    try {
      const { dataUrl } = await window.messsAPI.renderPdfPage(PreviewDoc.pdfPath, PreviewDoc.currentPage, previewZoom + 0.5);
      showDocPageImage(dataUrl);
      setPreviewPanelState('pages');
    } catch (err) {
      console.error('PDF page render failed:', err);
    }
    return;
  }

  const stage = document.getElementById('preview-stage');
  stage.innerHTML = '';
  const url = PreviewDoc.pageUrls[PreviewDoc.currentPage - 1];
  if (!url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = `Page ${PreviewDoc.currentPage}`;
  stage.appendChild(img);
}

function getTotalPages() {
  return PreviewDoc.mode === 'pdfjs' ? (PreviewDoc.totalPages || 1) : PreviewDoc.pageUrls.length;
}

function updatePageNavUI() {
  const total = getTotalPages();
  document.getElementById('preview-page-label').textContent = `${PreviewDoc.currentPage} / ${total}`;
  document.getElementById('preview-page-prev').disabled = PreviewDoc.currentPage <= 1;
  document.getElementById('preview-page-next').disabled = PreviewDoc.currentPage >= total;
}

function goToPage(delta) {
  const next = PreviewDoc.currentPage + delta;
  if (next < 1 || next > getTotalPages()) return;
  PreviewDoc.currentPage = next;
  renderCurrentDocPage();
  updatePageNavUI();
}

function renderUnsupportedPreview(id, result) {
  PreviewLanguageState.unsupported = { id, result };
  const icon = document.getElementById('preview-unsupported-icon');
  const title = document.getElementById('preview-unsupported-title');
  const detail = document.getElementById('preview-unsupported-detail');
  icon.textContent = fileIconLabel(result.ext || '');
  title.textContent = result.name || t('File', '文件');
  const reasonText = UNSUPPORTED_REASON_TEXT[result.reason] || UNSUPPORTED_REASON_TEXT['unknown-format'];
  detail.textContent = result.reason === 'missing-tools'
    ? missingToolsMessage(result.missingTools)
    : t(reasonText[0], reasonText[1]);
  setPreviewPanelState('unsupported');
}
function updatePreviewZoomUI() {
  document.getElementById('preview-zoom-label').textContent = formatZoomPercent(previewZoom);
  document.getElementById('preview-stage').style.transform = `scale(${previewFitScale * previewZoom})`;
}

/** Rounding zoom straight to whole percent (the old behavior) hides the
    real scale once it's been fit to an odd image size �?e.g. an image that
    actually fits at 23.7% would misleadingly show "24%". Round to one
    decimal place instead unless it lands on a whole number. */
function formatZoomPercent(zoom) {
  const pct = zoom * 100;
  const rounded = Math.round(pct * 10) / 10;
  return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + '%';
}

/* ===================== Folder browsing (grid / list view) ===================== */

// Multi-selection within the folder grid (Ctrl/Cmd+click toggles one,
// Shift+click selects a contiguous range, Ctrl/Cmd+A selects everything
// currently visible while hovering the canvas). Kept separate from
// AppState.activeFileId, which is the single file actually open for
// preview �?you can have a multi-selection without anything "open".
let folderGridSelected = new Set();
let lastClickedGridId = null;
let isCanvasHovered = false;

function toggleGridSelect(id) {
  if (folderGridSelected.has(id)) folderGridSelected.delete(id);
  else folderGridSelected.add(id);
  lastClickedGridId = id;
  renderFolderGridIfActive();
}

function selectGridRange(toId) {
  const ids = currentFileListScope().map((f) => f.id);
  const fromIdx = lastClickedGridId ? ids.indexOf(lastClickedGridId) : -1;
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) {
    folderGridSelected.add(toId);
  } else {
    const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    ids.slice(start, end + 1).forEach((id) => folderGridSelected.add(id));
  }
  lastClickedGridId = toId;
  renderFolderGridIfActive();
}

function clearGridSelect() {
  if (!folderGridSelected.size) return;
  folderGridSelected.clear();
  renderFolderGridIfActive();
}

function selectAllGridFiles() {
  folderGridSelected = new Set(currentFileListScope().map((f) => f.id));
  renderFolderGridIfActive();
}

function renderFolderGridIfActive() {
  if (!AppState.folderGridVisible) return;
  const files = currentFileListScope();
  const grid = document.getElementById('preview-folder-grid');
  grid.innerHTML = '';
  grid.classList.toggle('is-list-mode', AppState.viewMode === 'list');
  grid.style.setProperty('--grid-thumb-size', (AppState.gridThumbSize || 140) + 'px');

  if (!files.length) {
    grid.innerHTML = `<div class="preview-empty-sub folder-grid-empty">${t('This folder is empty. Drag files here, or drag them in from below.', '这个文件夹还是空的，把文件拖到这里，或从下方拖入')}</div>`;
  } else {
    for (const f of files) grid.appendChild(buildFolderGridItem(f));
  }
  updateViewModeButtons();
  setPreviewPanelState('folder-grid');
}

function refreshPreviewLanguage() {
  if (PreviewLanguageState.unsupported) {
    renderUnsupportedPreview(PreviewLanguageState.unsupported.id, PreviewLanguageState.unsupported.result);
  }
  document.querySelectorAll('.text-preview.is-empty').forEach((pre) => {
    pre.textContent = t('(This file is empty.)', '（这个文件没有内容）');
  });
  const audioCard = document.querySelector('.audio-player-card');
  if (audioCard) {
    const labels = [
      ['.audio-track-kicker', 'NOW PLAYING', '正在播放'],
      ['.audio-track-subtitle', 'High quality audio preview', '高质量音频预览']
    ];
    labels.forEach(([selector, en, zh]) => {
      const el = audioCard.querySelector(selector);
      if (el) el.textContent = t(en, zh);
    });
    [
      ['.audio-seek', 'Audio progress', '音频进度'],
      ['.audio-skip-back', 'Back 10 seconds', '后退 10 秒'],
      ['.audio-play-btn', 'Play', '播放'],
      ['.audio-pause-btn', 'Pause', '暂停'],
      ['.audio-skip-forward', 'Forward 10 seconds', '前进 10 秒'],
      ['.audio-mute-btn', 'Mute', '静音'],
      ['.audio-volume', 'Volume', '音量'],
      ['.audio-speed-btn', 'Playback speed', '播放速度']
    ].forEach(([selector, en, zh]) => {
      const el = audioCard.querySelector(selector);
      if (!el) return;
      const value = t(en, zh);
      el.setAttribute('aria-label', value);
      if (el.tagName === 'BUTTON') el.title = value;
    });
  }
}

const MIN_GRID_THUMB = 64;
const MAX_GRID_THUMB = 220;

/** Ctrl/Cmd+wheel over the folder grid resizes thumbnails live, matching
    "放大没反应，我希望是能有大小变化�? �?and at the smallest size it
    behaves the same as manually switching to list view ("当最小的时候就
    自动变成列表"), since a list row is effectively what a thumbnail looks
    like once it can't shrink any further. Scrolling back up out of that
    minimum switches back to the grid. */
function resizeGridThumbnails(delta) {
  const current = AppState.gridThumbSize || 140;
  AppState.gridThumbSize = Math.round(Math.max(MIN_GRID_THUMB, Math.min(MAX_GRID_THUMB, current + delta * 0.15)));

  if (AppState.gridThumbSize <= MIN_GRID_THUMB && AppState.viewMode !== 'list') {
    AppState.viewMode = 'list';
    window.messsAPI.setViewMode('list');
  } else if (AppState.gridThumbSize > MIN_GRID_THUMB && AppState.viewMode === 'list' && delta > 0) {
    AppState.viewMode = 'grid';
    window.messsAPI.setViewMode('grid');
  }

  const grid = document.getElementById('preview-folder-grid');
  grid.classList.toggle('is-list-mode', AppState.viewMode === 'list');
  grid.style.setProperty('--grid-thumb-size', AppState.gridThumbSize + 'px');
  updateViewModeButtons();
}

function buildFolderGridItem(f) {
  const item = document.createElement('div');
  item.className = 'folder-grid-item';
  item.dataset.fileId = f.id;
  if (f.id === AppState.activeFileId) item.classList.add('is-active');
  if (folderGridSelected.has(f.id)) item.classList.add('is-multi-selected');

  const thumb = document.createElement('div');
  thumb.className = 'folder-grid-thumb';
  appendFileThumbnail(thumb, f, f.name);

  const name = document.createElement('div');
  name.className = 'folder-grid-name';
  name.textContent = f.name;

  item.append(thumb, name);
  item.addEventListener('click', (e) => {
    if (e.shiftKey) {
      e.stopPropagation();
      selectGridRange(f.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      toggleGridSelect(f.id);
      return;
    }
    if (folderGridSelected.size) clearGridSelect();
    selectFileForPreview(f.id);
  });
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (folderGridSelected.size >= 2 && folderGridSelected.has(f.id)) {
      showMultiFileContextMenu([...folderGridSelected], e.clientX, e.clientY, f.id);
    } else {
      showContextMenu(f.id, e.clientX, e.clientY);
    }
  });
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    // Dragging a file that's part of a larger multi-selection carries the
    // whole selection along (drop targets that understand the multi-id
    // payload �?folders, the board �?move/add all of them, not just the
    // one the cursor happened to grab).
    if (folderGridSelected.size > 1 && folderGridSelected.has(f.id)) {
      e.dataTransfer.setData('application/x-messs-file-ids', JSON.stringify([...folderGridSelected]));
    }
    e.dataTransfer.setData('application/x-messs-file-id', f.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  return item;
}

function updateViewModeButtons() {
  document.getElementById('view-mode-grid').classList.toggle('is-active', AppState.viewMode !== 'list');
  document.getElementById('view-mode-list').classList.toggle('is-active', AppState.viewMode === 'list');
}

function initViewModeToggle() {
  document.getElementById('view-mode-grid').addEventListener('click', async () => {
    AppState.viewMode = 'grid';
    await window.messsAPI.setViewMode('grid');
    renderFolderGridIfActive();
  });
  document.getElementById('view-mode-list').addEventListener('click', async () => {
    AppState.viewMode = 'list';
    await window.messsAPI.setViewMode('list');
    renderFolderGridIfActive();
  });
}

function initPreviewCanvas() {
  const canvas = document.getElementById('preview-canvas');

  // The empty preview state explicitly invites external files. Keep this
  // target live on macOS as well as Windows; Finder may provide only
  // DataTransfer.files, which handleExternalDrop normalizes for us.
  let previewDragDepth = 0;
  const hasExternalFiles = (event) => {
    return Boolean(window.MesssFileDrop && window.MesssFileDrop.hasFiles(event && event.dataTransfer));
  };
  const clearPreviewDrop = () => {
    previewDragDepth = 0;
    canvas.classList.remove('is-drag-over');
  };
  canvas.addEventListener('dragenter', (event) => {
    if (!hasExternalFiles(event)) return;
    event.preventDefault();
    previewDragDepth += 1;
    canvas.classList.add('is-drag-over');
  });
  canvas.addEventListener('dragover', (event) => {
    if (!hasExternalFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('is-drag-over');
  });
  canvas.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && canvas.contains(event.relatedTarget)) return;
    previewDragDepth = Math.max(0, previewDragDepth - 1);
    if (!previewDragDepth) clearPreviewDrop();
  });
  canvas.addEventListener('drop', async (event) => {
    if (!hasExternalFiles(event)) return;
    event.preventDefault();
    clearPreviewDrop();
    if (typeof handleExternalDrop === 'function') await handleExternalDrop(event.dataTransfer);
  });

  // Clicking blank grid space no longer exits the folder (per spec: 鐐瑰嚮
  // 画布边缘不要退出文件夹) �?it just clears any multi-selection, the way
  // clicking empty space on the board canvas deselects rather than leaving.
  // Use the breadcrumb "back" row (already in folders.js) to actually leave.
  canvas.addEventListener('click', (e) => {
    if (e.target.id === 'preview-folder-grid' || e.target.classList.contains('folder-grid-empty')) {
      clearGridSelect();
    }
  });

  canvas.addEventListener('mouseenter', () => { isCanvasHovered = true; });
  canvas.addEventListener('mouseleave', () => { isCanvasHovered = false; });

  // Ctrl/Cmd+A selects every file in the currently-open folder while the
  // mouse is hovering the canvas; Ctrl/Cmd+D (or Escape) clears the
  // selection. Skipped while typing anywhere (search box, rename fields).
  document.addEventListener('keydown', (e) => {
    if (!isCanvasHovered || !AppState.folderGridVisible) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
    if (isEditable) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllGridFiles();
    } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') || e.key === 'Escape') {
      if (folderGridSelected.size) {
        e.preventDefault();
        clearGridSelect();
      }
    }
  });

  // Mouse wheel: resizes thumbnails while browsing a folder (Ctrl/Cmd+wheel),
  // scrolls normally otherwise, and zooms the single-file preview once a
  // specific file is open.
  canvas.addEventListener('wheel', (e) => {
    // While browsing a folder's thumbnail grid, the wheel should just
    // scroll the list like any normal content area �?no special handling,
    // so don't preventDefault here; let the grid's own overflow-y:auto do
    // its job. Zooming only applies once a specific file is open for preview.
    const gridVisible = AppState.folderGridVisible && !document.getElementById('preview-folder-grid').hidden;
    if (gridVisible) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        resizeGridThumbnails(-e.deltaY);
      }
      return;
    }

    if (!document.getElementById('preview-stage').hidden) {
      e.preventDefault();
      previewZoom = Math.max(0.25, Math.min(4, previewZoom - e.deltaY * 0.0015));
      resetPreviewPan();
      updatePreviewZoomUI();
    }
  }, { passive: false });

  document.getElementById('preview-zoom-in').addEventListener('click', () => {
    previewZoom = Math.min(4, previewZoom + 0.25);
    resetPreviewPan();
    updatePreviewZoomUI();
  });
  document.getElementById('preview-zoom-out').addEventListener('click', () => {
    previewZoom = Math.max(0.25, previewZoom - 0.25);
    resetPreviewPan();
    updatePreviewZoomUI();
  });
  document.getElementById('preview-fullscreen').addEventListener('click', openFullscreenPreview);

  document.getElementById('preview-page-prev').addEventListener('click', () => goToPage(-1));
  document.getElementById('preview-page-next').addEventListener('click', () => goToPage(1));

  document.getElementById('preview-open-external').addEventListener('click', () => {
    if (AppState.activeFileId) window.messsAPI.openFileExternally(AppState.activeFileId);
  });
  const revealBtn = document.getElementById('preview-reveal');
  if (revealBtn) revealBtn.addEventListener('click', () => {
    if (AppState.activeFileId) window.messsAPI.revealFile(AppState.activeFileId);
  });

  document.getElementById('preview-back-btn').addEventListener('click', () => {
    clearPreview();
  });

  initViewModeToggle();
}

function openFullscreenPreview() {
  if (!AppState.activeFileId) return;
  const stage = document.getElementById('preview-stage');
  const media = stage.querySelector('img, video');
  if (!media) return;
  showFullscreenMedia(media);
}

async function openFileFullscreenPreview(file, sourceMedia = null) {
  if (!file) return;
  if (isVideoExt(file.ext)) {
    let video = sourceMedia && sourceMedia.tagName === 'VIDEO' ? sourceMedia : null;
    if (!video) {
      const result = await window.messsAPI.getPreview(file.id);
      if (!result || result.type !== 'video' || !result.url) return;
      video = document.createElement('video');
      video.src = result.url;
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.dataset.usingTranscode = result.transcoded ? 'true' : '';
    }
    showFullscreenMedia(video, { videoFileId: file.id, autoplay: true });
    return;
  }
  if (isImageExt(file.ext)) {
    const primarySource = resolveImageDisplaySource(file, true);
    const fallbackSource = resolveImageDisplaySource(file, false);
    if (!primarySource) return;
    const image = document.createElement('img');
    image.src = primarySource;
    image.alt = file.name || '';
    image.decoding = 'async';
    image.fetchPriority = 'high';
    showFullscreenMedia(image, {
      fallbackSrc: fallbackSource !== primarySource ? fallbackSource : '',
      onPrimaryImageError: () => {
        if (typeof Board !== 'undefined' && Board.failedFullImageSources) {
          Board.failedFullImageSources.add(primarySource);
        }
      }
    });
  }
}

function fitFullscreenVideoPlayer(video, shell, stage, signal) {
  let frame = 0;
  const apply = () => {
    frame = 0;
    const sourceWidth = Number(video.videoWidth) || 16;
    const sourceHeight = Number(video.videoHeight) || 9;
    const stageWidth = Math.max(1, stage.clientWidth);
    const stageHeight = Math.max(1, stage.clientHeight);
    const compact = window.innerWidth <= 720;
    const maxWidth = Math.max(1, Math.min(
      stageWidth - (compact ? 28 : 48),
      compact ? window.innerWidth * 0.94 : Math.min(window.innerWidth * 0.82, 1440)
    ));
    const maxHeight = Math.max(1, Math.min(
      stageHeight - (compact ? 108 : 136),
      compact ? window.innerHeight * 0.68 : Math.min(window.innerHeight * 0.76, 860)
    ));
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    shell.style.width = `${Math.max(1, Math.round(sourceWidth * scale))}px`;
    shell.style.height = `${Math.max(1, Math.round(sourceHeight * scale))}px`;
    shell.style.aspectRatio = `${sourceWidth} / ${sourceHeight}`;
  };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  observer?.observe(stage);
  video.addEventListener('loadedmetadata', schedule, { signal });
  window.addEventListener('resize', schedule, { signal });
  schedule();
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}

function showFullscreenMedia(media, options = {}) {
  const overlay = document.getElementById('fullscreen-overlay');
  const fsStage = document.getElementById('fullscreen-stage');
  if (overlay._closeTimer) {
    window.clearTimeout(overlay._closeTimer);
    overlay._closeTimer = 0;
  }
  if (!overlay.hidden) finalizeFullscreenPreviewClose();
  overlay.classList.remove('is-closing');
  fsStage.innerHTML = '';
  const clone = media.cloneNode(true);
  clone.removeAttribute('style');
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  FullscreenPreviewState.sourceVideo = null;
  FullscreenPreviewState.cloneVideo = null;
  if (clone.tagName === 'IMG' && options.fallbackSrc) {
    clone.addEventListener('error', () => {
      if (typeof options.onPrimaryImageError === 'function') options.onPrimaryImageError();
      clone.src = options.fallbackSrc;
    }, { once: true });
  } else if (clone.tagName === 'VIDEO') {
    const currentTime = Number(media.currentTime) || 0;
    const wasPlaying = !media.paused && !media.ended;
    const shouldAutoplay = options.autoplay === true || wasPlaying;
    clone.muted = media.muted;
    clone.volume = media.volume;
    clone.playbackRate = media.playbackRate;
    media.pause();
    let playbackMonitor = null;
    let recovering = false;
    const recover = async () => {
      if (recovering || !options.videoFileId || clone.dataset.usingTranscode === 'true') return;
      recovering = true;
      const resumeAt = Number(clone.currentTime) || currentTime;
      const response = await window.messsAPI.transcodeVideo(options.videoFileId).catch(() => null);
      if (
        !response || !response.ok || !response.url || overlay.hidden ||
        FullscreenPreviewState.cloneVideo !== clone
      ) return;
      clone.dataset.usingTranscode = 'true';
      clone.src = response.url;
      clone.load();
      playbackMonitor.reset();
      clone.addEventListener('loadedmetadata', () => {
        clone.currentTime = Math.min(resumeAt, Number.isFinite(clone.duration) ? clone.duration : resumeAt);
        clone.play().catch((error) => playbackMonitor.handlePlayFailure(error));
      }, { once: true, signal: player.signal });
    };
    const player = createVideoPlayer(clone, {
      fullscreen: true,
      onPlaybackFailure: (error) => playbackMonitor && playbackMonitor.handlePlayFailure(error)
    });
    playbackMonitor = monitorVideoPlayback(clone, player.signal, () => { void recover(); });
    const releaseVideoLayout = fitFullscreenVideoPlayer(clone, player.shell, fsStage, player.signal);
    FullscreenPreviewCleanup.current = () => {
      releaseVideoLayout();
      player.cleanup();
    };
    FullscreenPreviewState.sourceVideo = media.isConnected ? media : null;
    FullscreenPreviewState.cloneVideo = clone;
    fsStage.appendChild(player.shell);
    clone.addEventListener('loadedmetadata', () => {
      clone.currentTime = Math.min(currentTime, Number.isFinite(clone.duration) ? clone.duration : currentTime);
      if (shouldAutoplay) clone.play().catch((error) => playbackMonitor.handlePlayFailure(error));
    }, { once: true });
    overlay.hidden = false;
    clone.load();
    return;
  }
  fsStage.appendChild(clone);
  overlay.hidden = false;
}

function finalizeFullscreenPreviewClose() {
  const overlay = document.getElementById('fullscreen-overlay');
  const sourceVideo = FullscreenPreviewState.sourceVideo;
  const cloneVideo = FullscreenPreviewState.cloneVideo;
  if (sourceVideo && cloneVideo) {
    const resume = !cloneVideo.paused && !cloneVideo.ended;
    sourceVideo.currentTime = Number(cloneVideo.currentTime) || 0;
    sourceVideo.muted = cloneVideo.muted;
    sourceVideo.volume = cloneVideo.volume;
    sourceVideo.playbackRate = cloneVideo.playbackRate;
    if (resume) sourceVideo.play().catch(() => {});
  }
  if (FullscreenPreviewCleanup.current) { FullscreenPreviewCleanup.current(); FullscreenPreviewCleanup.current = null; }
  FullscreenPreviewState.sourceVideo = null;
  FullscreenPreviewState.cloneVideo = null;
  document.getElementById('fullscreen-stage').innerHTML = '';
  overlay.hidden = true;
  overlay.classList.remove('is-closing');
  overlay._closeTimer = 0;
}

function closeFullscreenPreview() {
  const overlay = document.getElementById('fullscreen-overlay');
  if (!overlay || overlay.hidden || overlay.classList.contains('is-closing')) return;
  overlay.classList.add('is-closing');
  overlay._closeTimer = window.setTimeout(finalizeFullscreenPreviewClose, 150);
}

function initFullscreenOverlay() {
  document.getElementById('fullscreen-close').addEventListener('click', (event) => {
    event.stopPropagation();
    closeFullscreenPreview();
  });
  document.getElementById('fullscreen-overlay').addEventListener('click', (event) => {
    const mediaHit = event.target.closest(
      '#fullscreen-stage > img, #fullscreen-stage video, #fullscreen-stage .video-control-capsule'
    );
    if (!mediaHit) closeFullscreenPreview();
  });
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('fullscreen-overlay');
    const fullscreenVideo = FullscreenPreviewState.cloneVideo;
    if (e.key === 'Escape') {
      if (!overlay.hidden) {
        e.preventDefault();
        closeFullscreenPreview();
        return;
      }
      document.getElementById('detail-overlay').hidden = true;
      if (!(typeof isDoodleActive === 'function' && isDoodleActive())) {
        exitBoardFullscreen();
      }
      return;
    }
    if (overlay.hidden || !fullscreenVideo) return;
    if (e.target && e.target.closest && e.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (fullscreenVideo.paused) fullscreenVideo.play().catch(() => {});
      else fullscreenVideo.pause();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -5 : 5;
      fullscreenVideo.currentTime = Math.max(0, Math.min(fullscreenVideo.duration || Infinity, fullscreenVideo.currentTime + delta));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      fullscreenVideo.muted = false;
      fullscreenVideo.volume = Math.max(0, Math.min(1, fullscreenVideo.volume + (e.key === 'ArrowUp' ? .05 : -.05)));
    }
  });
}
