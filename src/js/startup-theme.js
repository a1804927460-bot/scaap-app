'use strict';

// Runs before CSS is requested so Chromium's first paint matches the native window.
const startupTheme = new URLSearchParams(window.location.search).get('theme');
document.documentElement.dataset.theme = startupTheme === 'light' ? 'light' : 'dark';

// Apply the persisted language before CSS and the first paint.
const startupLanguage = new URLSearchParams(window.location.search).get('language');
const normalizedStartupLanguage = ['en', 'zh', 'ko'].includes(startupLanguage) ? startupLanguage : 'ko';
document.documentElement.dataset.language = normalizedStartupLanguage;
document.documentElement.lang = normalizedStartupLanguage === 'zh'
  ? 'zh-CN'
  : (normalizedStartupLanguage === 'ko' ? 'ko' : 'en');
