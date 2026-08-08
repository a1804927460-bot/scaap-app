'use strict';
/* Start screen <-> main app transition (Apple-style crossfade), both ways. */

let mainAppBootstrapped = false;

function initStartScreen(onStart, options = {}) {
  const startScreen = document.getElementById('start-screen');
  const mainApp = document.getElementById('main-app');
  const startBtn = document.getElementById('start-btn');

  const invokeStart = () => {
    if (mainAppBootstrapped) return;
    mainAppBootstrapped = true;
    if (typeof onStart === 'function') onStart();
  };

  // The normal launch path enters the app immediately. Keeping this in the
  // start-screen module preserves the reverse transition used by the context
  // menu and avoids a second, competing startup state machine.
  if (options.enterImmediately === true) {
    startScreen.hidden = true;
    startScreen.classList.remove('is-leaving');
    document.documentElement.setAttribute('data-view', 'main');
    if (window.messsAPI && typeof window.messsAPI.syncThemeSurface === 'function') {
      window.messsAPI.syncThemeSurface(document.documentElement.getAttribute('data-theme') || 'dark');
    }
    mainApp.hidden = false;
    mainApp.classList.add('is-visible');
    invokeStart();
    return;
  }

  function enterMainApp() {
    startScreen.classList.add('is-leaving');
    setTimeout(() => {
      startScreen.hidden = true;
      document.documentElement.setAttribute('data-view', 'main');
      if (window.messsAPI && typeof window.messsAPI.syncThemeSurface === 'function') {
        window.messsAPI.syncThemeSurface(document.documentElement.getAttribute('data-theme') || 'dark');
      }
      mainApp.hidden = false;
      requestAnimationFrame(() => {
        mainApp.classList.add('is-visible');
      });
      invokeStart();
    }, 560);
  }

  if (!startBtn) return;
  startBtn.addEventListener('click', enterMainApp);
  startBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterMainApp();
    }
  });
}

/** Reverses the transition: main app fades/scales out, start screen fades back in. */
function showStartScreenAgain() {
  const startScreen = document.getElementById('start-screen');
  const mainApp = document.getElementById('main-app');

  mainApp.classList.remove('is-visible');
  setTimeout(() => {
    mainApp.hidden = true;
    document.documentElement.setAttribute('data-view', 'start');
    if (window.messsAPI && typeof window.messsAPI.syncThemeSurface === 'function') {
      window.messsAPI.syncThemeSurface(document.documentElement.getAttribute('data-theme') || 'dark');
    }
    startScreen.hidden = false;
    startScreen.classList.remove('is-leaving');
    // Re-trigger the entrance animation from a clean state.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      startScreen.classList.remove('is-leaving');
    }));
  }, 420);
}
