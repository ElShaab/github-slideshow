/**
 * main.js -- bootstrap.
 */
import { GameManager } from './systems/GameManager.js';
import { CONFIG } from './core/Config.js';

function boot () {
  const canvas = document.getElementById('scene');
  try {
    const game = new GameManager(canvas, CONFIG);

    // Nothing should fail silently on a device we cannot open a console on.
    window.addEventListener('error', (event) => {
      game.ui.showFatal(event.message || 'Unexpected error',
        event.error && (event.error.stack || event.error.message));
    });
    window.addEventListener('unhandledrejection', (event) => {
      game.ui.showFatal('Unhandled promise rejection', String(event.reason));
    });

    game.start();
    // Handy for debugging from the console; harmless in production.
    window.__squadRush = game;
  } catch (error) {
    console.error('Squad Rush failed to start', error);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.remove('hidden');
      const webgl = /webgl|context/i.test(String(error && error.message));
      const hint = webgl
        ? 'This device would not give the page a 3D canvas. Closing other browser tabs and reloading usually frees one up.'
        : 'Reloading the page usually clears this.';
      loading.innerHTML =
        `<div class="loading-text" style="text-align:center;padding:22px;letter-spacing:.12em">
           COULD NOT START
           <div style="font-size:12px;opacity:.75;letter-spacing:.02em;margin-top:10px;line-height:1.5">${hint}</div>
           <div style="font-size:11px;opacity:.5;letter-spacing:.02em;margin-top:10px">${String(error && error.message || error)}</div>
         </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
