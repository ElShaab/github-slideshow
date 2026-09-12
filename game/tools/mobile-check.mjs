/**
 * Mobile QA harness -- run this against a served build before shipping.
 *
 *   cd game && npm run serve            # in one terminal
 *   node tools/mobile-check.mjs         # in another
 *
 * Playwright is NOT a dependency of this project (the game itself has none),
 * so this script is deliberately outside `npm test`: it needs a browser and a
 * running server. Point it elsewhere with BASE_URL=... if you serve on another
 * port, and pass PLAYWRIGHT=/path/to/playwright if it is not resolvable.
 *
 * What it checks, on real phone and tablet profiles with real touch events:
 *   - the HUD fits inside the screen (a flex overflow once pushed the gem
 *     counter off a 320px phone, and `body { overflow: hidden }` hides that
 *     from any scrollWidth-based check)
 *   - tapping and swiping with a finger actually move the squad between lanes
 *   - WebGL comes up and the page cannot be panned or scrolled
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080/game/index.html';
const PLAYWRIGHT = process.env.PLAYWRIGHT || 'playwright';
const GUTTER = 12;          // the side gutter the HUD is designed around

const { chromium, devices } = await import(PLAYWRIGHT)
  .then((m) => m.default || m)
  .catch(() => {
    console.error('Playwright not found. Install it, or set PLAYWRIGHT=/path/to/playwright.');
    process.exit(2);
  });

const PROFILES = ['iPhone SE', 'iPhone 13', 'iPhone 13 Pro Max', 'Pixel 5', 'iPad (gen 7)'];
const browser = await chromium.launch();
let failures = 0;

for (const name of PROFILES) {
  const device = devices[name];
  if (!device) { console.log(`- ${name}: no such device profile, skipped`); continue; }

  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const cdp = await context.newCDPSession(page);
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const swipe = async (fromX, toX, y, steps = 6) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y, id: 1 }]
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  const play = await page.locator('#play-button').boundingBox();
  await tap(play.x + play.width / 2, play.y + play.height / 2);
  await page.waitForTimeout(1000);

  const { width, height } = page.viewportSize();
  const midX = Math.round(width / 2);
  const y = Math.round(height * 0.6);

  const lanes = [await page.evaluate(() => window.__squadRush.lanes.lane)];
  await swipe(midX + 70, midX - 70, y); await page.waitForTimeout(450);
  lanes.push(await page.evaluate(() => window.__squadRush.lanes.lane));
  await swipe(midX - 70, midX + 70, y); await page.waitForTimeout(450);
  await swipe(midX - 70, midX + 70, y); await page.waitForTimeout(450);
  lanes.push(await page.evaluate(() => window.__squadRush.lanes.lane));

  const report = await page.evaluate((gutter) => {
    const viewport = window.innerWidth;
    const problems = [];
    // Every HUD element must sit inside the gutter on both sides.
    for (const selector of ['.squad-chip', '.gem-chip', '.hud-stage', '.hud-weapon', '.icon-button', '#boss-bar']) {
      const element = document.querySelector(selector);
      if (!element || element.offsetParent === null) continue;
      const rect = element.getBoundingClientRect();
      if (rect.right > viewport - gutter + 1) problems.push(`${selector} overflows right by ${Math.round(rect.right - viewport)}px`);
      if (rect.left < gutter - 1) problems.push(`${selector} overflows left by ${Math.round(gutter - rect.left)}px`);
      if (rect.bottom > window.innerHeight + 1) problems.push(`${selector} runs off the bottom`);
    }
    const canvas = document.getElementById('scene');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) problems.push('no WebGL context');
    if (window.scrollY !== 0 || window.scrollX !== 0) problems.push('the page scrolled under the finger');
    return { problems, state: window.__squadRush.state, squad: window.__squadRush.run.squad };
  }, GUTTER);

  const swipesWorked = lanes[1] === 0 && lanes[2] === 2;
  const problems = [...report.problems];
  if (!swipesWorked) problems.push(`swipes did not move the squad (lanes: ${lanes.join(' -> ')})`);
  if (report.state !== 'PLAYING') problems.push(`tapping PLAY left the game in ${report.state}`);
  if (errors.length) problems.push(`runtime errors: ${errors.join(' | ')}`);

  if (problems.length) {
    failures++;
    console.log(`✗ ${name} (${width}x${height} @${device.deviceScaleFactor}x)`);
    for (const problem of problems) console.log(`    ${problem}`);
  } else {
    console.log(`✓ ${name} (${width}x${height} @${device.deviceScaleFactor}x) — HUD fits, touch works, WebGL up`);
  }
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} profile(s) failed.` : '\nAll profiles passed.');
process.exit(failures ? 1 : 0);
