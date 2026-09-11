/**
 * main.js -- bootstrap.
 */
import { GameManager } from './systems/GameManager.js';
import { CONFIG } from './core/Config.js';

function boot () {
  const canvas = document.getElementById('scene');
  try {
    const game = new GameManager(canvas, CONFIG);
    game.start();
    // Handy for debugging from the console; harmless in production.
    window.__squadRush = game;
  } catch (error) {
    console.error('Squad Rush failed to start', error);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML =
        `<div class="loading-text" style="text-align:center;padding:20px">
           COULD NOT START<br><span style="font-size:12px;opacity:.7">${String(error.message || error)}</span>
         </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
