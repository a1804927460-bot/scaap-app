'use strict';

// Runs before CSS is requested so Chromium's first paint matches the native window.
const startupTheme = new URLSearchParams(window.location.search).get('theme');
document.documentElement.dataset.theme = startupTheme === 'light' ? 'light' : 'dark';
