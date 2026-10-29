/* Run against a local HTTP server:
 * GAME_URL=http://127.0.0.1:8080 node tests/smoke.cjs
 * GAME_URL=http://127.0.0.1:8080/ИГРАТЬ.html node tests/smoke.cjs
 * Needs Playwright and Chromium (CHROMIUM_PATH overrides its location).
 */
'use strict';
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Drive simulation time explicitly. Audio keeps its real scheduler so we
    // also exercise the actual browser Web Audio implementation.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      try {
        if (!sessionStorage.getItem('smoke-initialized')) {
          localStorage.clear();
          sessionStorage.setItem('smoke-initialized', 'yes');
        }
      } catch {}
    });
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080', { waitUntil: 'load' });
    assert.equal(await page.locator('.card').count(), 8, 'eight plant cards');
    assert.equal(await page.evaluate(() => state), 'intro', 'no game before clicking play');
    assert.equal(await page.evaluate(() => GardenMusic.playing), false, 'no music before user gesture');
    await page.getByRole('button', { name: 'Начать игру →' }).click();
    await page.waitForFunction(() => GardenMusic.playing, null, { polling: 50, timeout: 5000 });
    assert.equal(await page.evaluate(() => GardenMusic.enabled), true, 'music starts with game');

    const clickField = async (x, y) => {
      const b = await page.locator('#game').boundingBox();
      await page.mouse.click(b.x + x * b.width / 1100, b.y + y * b.height / 540);
    };
    await page.locator('.card').first().click();
    await clickField(193, 109);
    assert.deepEqual(await page.evaluate(() => [plants.length, sun]), [1, 150], 'planting charges correct cost');
    await page.evaluate(() => addSun(400, 200));
    await clickField(400, 200);
    assert.equal(await page.evaluate(() => sun), 175, 'sun collection');

    await page.evaluate(() => {
      start(1);
      nextSpawn = nextSun = 999;
      plants.push({ c: 1, r: 0, i: 1, hp: 150, max: 150, timer: 0, age: 0 });
      zombies.push({ r: 0, x: 480, hp: 24, max: 24, kind: 'basic', speed: 0, slow: 0, bite: 0, phase: 0 });
      for (let i = 0; i < 150; i++) update(.05);
    });
    assert.equal(await page.evaluate(() => kills), 1, 'ordinary projectile kills enemy');

    // Rift activation must be available in an ordinary first-level run.
    await page.evaluate(() => start(1));
    assert.equal(await page.evaluate(() => CosmicRift.charge), 100, 'rift starts charged');
    await page.locator('#riftButton').click();
    assert.equal(await page.evaluate(() => CosmicRift.active), true, 'rift button activates');
    assert.equal(await page.evaluate(() => CosmicRift.charge), 0, 'rift consumes charge');
    const remaining = await page.evaluate(() => CosmicRift.remaining);
    await page.evaluate(() => CosmicRift.activate());
    assert.equal(await page.evaluate(() => CosmicRift.remaining), remaining, 'cannot reactivate active rift');

    await page.locator('#pauseButton').click();
    assert.equal(await page.evaluate(() => state), 'paused', 'pause state');
    assert.equal(await page.evaluate(() => GardenMusic.playing), false, 'music pauses');
    await page.evaluate(() => { frame(1000); frame(2000); });
    assert.equal(await page.evaluate(() => CosmicRift.remaining), remaining, 'pause freezes rift timer');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.waitForFunction(() => GardenMusic.playing, null, { polling: 50, timeout: 5000 });

    await page.locator('#soundButton').click();
    assert.equal(await page.evaluate(() => GardenMusic.enabled), false, 'mute preference');
    assert.equal(await page.evaluate(() => GardenMusic.playing), false, 'mute stops music');
    await page.locator('#soundButton').click();
    await page.waitForFunction(() => GardenMusic.playing, null, { polling: 50, timeout: 5000 });

    // The R shortcut works too, and restarting removes all previous effects.
    await page.evaluate(() => start(1));
    assert.equal(await page.evaluate(() => CosmicRift.active), false, 'restart clears rift');
    assert.equal(await page.evaluate(() => CosmicRift.allies.length), 0, 'restart clears allies');
    await page.keyboard.press('r');
    assert.equal(await page.evaluate(() => CosmicRift.active), true, 'R shortcut');

    await page.evaluate(() => {
      start(1);
      nextSpawn = nextSun = 999;
      zombies.push({ r: 2, x: 650, hp: 160, max: 160, kind: 'basic', speed: 0, slow: 0, bite: 0, phase: 0 });
      CosmicRift.activate();
      for (let i = 0; i < 80 && !CosmicRift.allies.length; i++) update(.05);
    });
    assert.equal(await page.evaluate(() => CosmicRift.allies.length), 1, 'cat converts a zombie');
    assert.equal(await page.evaluate(() => zombies.length), 0, 'converted enemy leaves hostile array');
    assert.equal(await page.evaluate(() => kills), 1, 'conversion counts exactly once');
    await page.evaluate(() => { for (let i = 0; i < 10; i++) update(.05); });
    assert.equal(await page.evaluate(() => kills), 1, 'conversion not counted repeatedly');

    // Allies keep defending after their 12-second summoning window ends.
    await page.evaluate(() => {
      for (let i = 0; i < 245; i++) update(.05);
      const a = CosmicRift.allies[0];
      zombies.push({ r: a.r, x: Math.min(1050, a.x + 95), hp: 500, max: 500, kind: 'basic', speed: 0, slow: 0, bite: 0, phase: 0 });
      for (let i = 0; i < 20; i++) update(.05);
    });
    assert.equal(await page.evaluate(() => CosmicRift.active), false, 'rift expires');
    assert.ok(await page.evaluate(() => zombies[0].hp < 500), 'summoned ally damages a hostile zombie');
    const chargeAfterExpiry = await page.evaluate(() => CosmicRift.charge);
    assert.ok(chargeAfterExpiry > 0, 'passive recharge starts after rift expires');
    await page.evaluate(() => addSun(400, 200));
    await clickField(400, 200);
    assert.ok(await page.evaluate(() => CosmicRift.charge) >= chargeAfterExpiry + 3, 'sun collection adds charge');
    const chargeBeforeKill = await page.evaluate(() => CosmicRift.charge);
    await page.evaluate(() => {
      zombies.push({ r: 1, x: 500, hp: 24, max: 24, kind: 'basic', speed: 0, slow: 0, bite: 0, phase: 0 });
      shots.push({ x: 480, y: 180, r: 1, ice: false, damage: 24 });
      update(.01);
    });
    assert.ok(await page.evaluate(() => CosmicRift.charge) >= chargeBeforeKill + 7, 'defeating enemy adds charge');
    await page.evaluate(() => { for (let i = 0; i < 2600; i++) update(.05); });
    assert.equal(await page.evaluate(() => CosmicRift.charge), 100, 'charge caps at full after passive recharge');
    assert.equal(await page.locator('#riftButton').isEnabled(), true, 'fully recharged rift is usable');
    await page.locator('#riftButton').click();
    assert.equal(await page.evaluate(() => CosmicRift.mode), 1, 'next activation cycles to a different effect');

    await page.evaluate(() => {
      start(2);
      nextSpawn = nextSun = 999;
      CosmicRift.activate();
      zombies.push({ r: 0, x: 500, hp: 160, max: 160, kind: 'basic', speed: 0, slow: 0, bite: 0, phase: 0 });
      shots.push({ x: 480, y: 90, r: 0, ice: false, damage: 24 });
      update(.01);
    });
    assert.equal(await page.evaluate(() => CosmicRift.mode), 1, 'second level offers singularity');
    assert.equal(await page.evaluate(() => zombies[0].hp), 112, 'comet deals double normal damage');
    assert.equal(await page.evaluate(() => zombies[0].x), 511, 'comet knocks enemy back');
    await page.evaluate(() => {
      shots.push({ x: 200, y: 180, r: 1, ice: false, damage: 24 });
      update(.01); update(.01);
    });
    assert.equal(await page.evaluate(() => shots[0].damage), 48, 'comet bonus applied once across frames');

    await page.evaluate(() => {
      start(3);
      nextSpawn = nextSun = 999;
      plants.push({ c: 3, r: 2, i: 2, hp: 200, max: 1400, timer: 0, age: 0 });
      zombies.push({ r: 2, x: 500, hp: 160, max: 160, kind: 'basic', speed: 12, slow: 0, bite: 0, phase: 0 });
      CosmicRift.activate();
      for (let i = 0; i < 20; i++) update(.05);
    });
    assert.equal(await page.evaluate(() => CosmicRift.mode), 2, 'third level offers reverse time');
    assert.ok(await page.evaluate(() => zombies[0].x > 500), 'reverse time pushes enemies away from house');
    assert.ok(await page.evaluate(() => plants[0].hp >= 229.9), 'reverse time heals plants without bites');
    assert.ok(await page.evaluate(() => suns.length > 0), 'reverse time produces future sun');

    // Progression and failure conditions still use the real game update loop.
    await page.evaluate(() => { start(1); spawned = target(); update(.01); });
    assert.equal(await page.evaluate(() => state), 'won', 'victory condition');
    assert.equal(await page.evaluate(() => unlocked), 2, 'victory unlocks next level');
    assert.equal(await page.evaluate(() => GardenMusic.playing), false, 'result screen pauses music');
    await page.evaluate(() => {
      start(2);
      mowers[0].used = true;
      zombies.push({ r: 0, x: 30, hp: 160, max: 160, kind: 'basic', speed: 12, slow: 0, bite: 0, phase: 0 });
      update(.01);
    });
    assert.equal(await page.evaluate(() => state), 'lost', 'defeat condition');
    await page.getByRole('button', { name: /Карта миров/ }).first().click();
    assert.equal(await page.locator('[data-level]').count(), 30, 'all levels remain in map');
    await page.locator('#closeModal').click();
    // The user's mute choice must survive a normal page reload.
    await page.locator('#soundButton').click();
    assert.equal(await page.evaluate(() => GardenMusic.enabled), false, 'mute before reload');
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.evaluate(() => GardenMusic.enabled), false, 'mute preference survives reload');
    await page.getByRole('button', { name: 'Начать игру →' }).click();
    assert.equal(await page.evaluate(() => GardenMusic.playing), false, 'muted music stays silent on next game');
    await page.locator('#soundButton').click();
    await page.waitForFunction(() => GardenMusic.playing, null, { polling: 50, timeout: 5000 });
    assert.deepEqual(errors, [], 'no browser script errors');
    console.log('PASS: planting, sun, combat, rift activation/reset/conversion/ally combat/comets/reverse time/pause/expiry/recharge/cycle, music start/mute/resume/persistence, victory/unlock/defeat, map; no browser errors.');
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
