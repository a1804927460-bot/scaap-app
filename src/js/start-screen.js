'use strict';
/* Start screen <-> main app transition (Apple-style crossfade), both ways. */

let mainAppEnteredOnce = false;

function initStartScreen(onStart) {
  const startScreen = document.getElementById('start-screen');
  const mainApp = document.getElementById('main-app');
  const startBtn = document.getElementById('start-btn');

  function enterMainApp() {
    startScreen.classList.add('is-leaving');
    setTimeout(() => {
      startScreen.hidden = true;
      document.documentElement.setAttribute('data-view', 'main');
      mainApp.hidden = false;
      requestAnimationFrame(() => {
        mainApp.classList.add('is-visible');
      });
      if (!mainAppEnteredOnce) {
        mainAppEnteredOnce = true;
        if (typeof onStart === 'function') onStart();
      }
    }, 560);
  }

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
    startScreen.hidden = false;
    startScreen.classList.remove('is-leaving');
    // Re-trigger the entrance animation from a clean state.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      startScreen.classList.remove('is-leaving');
    }));
  }, 420);
}
