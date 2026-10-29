'use strict';

// A small, self-contained reality-bending game system. Uses the game's shared state.
window.CosmicRift = (() => {
  const modes = [
    {name: 'КОТОСМОС', icon: '🐈', color: '#d9a5ff', short: 'Кот вербует зомби в твою команду', detail: 'Кот-капитан забирает до четырёх зомби. Они возвращаются союзниками и стреляют звёздами!'},
    {name: 'ГОРОХОВАЯ СИНГУЛЯРНОСТЬ', icon: '✺', color: '#85f3e3', short: 'Кометы вместо гороха · двойной урон', detail: 'Растения парят над землёй. Снаряды превращаются в кометы, бьют вдвое сильнее и отбрасывают зомби.'},
    {name: 'ОБРАТНЫЙ ЧЕТВЕРГ', icon: '↶', color: '#ffdba1', short: 'Время идёт назад. Но только для зомби', detail: 'Зомби пятятся назад и не кусаются, растения восстанавливаются. Кот присылает солнце из будущего.'}
  ];
  let charge = 100, remaining = 0, mode = 0, nextMode = 0;
  let pulses = 0, pulseTimer = 0, notice = 0, frozenTarget = null;
  let allies = [];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const active = () => remaining > 0;

  function reset(n) {
    charge = 100; remaining = 0; nextMode = (n - 1) % 3; mode = nextMode;
    pulses = 0; pulseTimer = 0; notice = 0; allies = []; frozenTarget = null;
    document.body.classList.remove('rift-active');
    window.GardenMusic?.setRift(false);
    syncUI();
  }

  function syncUI() {
    const button = document.getElementById('riftButton');
    if (!button) return;
    const ready = charge >= 100 && !active();
    const playable = typeof state !== 'undefined' && state === 'playing';
    button.disabled = !playable || (!ready && !active()) || active();
    button.classList.toggle('ready', ready);
    button.classList.toggle('active', active());
    button.setAttribute('aria-label', active() ? `Разлом активен: ${Math.ceil(remaining)} секунд` : `Разлом реальности: ${ready ? 'готов' : Math.floor(charge) + '%'}`);
    button.title = modes[active() ? mode : nextMode].detail;
    document.getElementById('riftFill').style.width = (active() ? remaining / 12 * 100 : charge) + '%';
    document.getElementById('riftStatus').textContent = active() ? `${modes[mode].name} · ${Math.ceil(remaining)}с` : ready ? 'ГОТОВ · НАЖМИ R' : `ЗАРЯД ${Math.floor(charge)}%`;
    document.getElementById('riftHint').textContent = modes[active() ? mode : nextMode].short;
    const banner = document.getElementById('riftBanner');
    banner.classList.toggle('visible', active() && notice > 0);
    banner.style.setProperty('--rift-color', modes[mode].color);
    document.getElementById('riftTitle').textContent = modes[mode].name;
    document.getElementById('riftDescription').textContent = modes[mode].short;
  }

  function activate() {
    if (state !== 'playing' || document.getElementById('modal').open || charge < 100 || active()) return false;
    mode = nextMode; nextMode = (nextMode + 1) % 3;
    charge = 0; remaining = 12; pulses = 0; pulseTimer = 0; notice = 3.5;
    // A first-click rift should meet an enemy before its twelve seconds expire.
    if (mode === 0 && !zombies.some(z => z.hp > 0) && spawned < target()) nextSpawn = Math.min(nextSpawn, .5);
    document.body.classList.add('rift-active');
    document.getElementById('hint').textContent = modes[mode].detail;
    window.GardenMusic?.setRift(true);
    window.GardenMusic?.resume();
    sound(540);
    syncUI();
    return true;
  }

  function addCharge(amount) {
    if (!active()) charge = Math.min(100, charge + amount);
  }

  function convert() {
    // Closest enemy to the house gets rescued first. Dead enemies still belong to kill accounting.
    const candidates = zombies.filter(z => z.hp > 0);
    if (!candidates.length) return false;
    const z = candidates.reduce((a, b) => a.x < b.x ? a : b);
    const x = z.x;
    zombies = zombies.filter(other => other !== z);
    allies.push({...z, x: Math.max(180, Math.min(900, x - 65)), timer: .25, life: 24});
    kills++;
    frozenTarget = {x, y: Y + z.r * CH + 15, life: 1.3};
    burst(x, Y + z.r * CH + 30, '#e6b9ff', 25);
    sound(660);
    return true;
  }

  function update(dt) {
    if (frozenTarget) { frozenTarget.life -= dt; if (frozenTarget.life <= 0) frozenTarget = null; }
    if (active()) {
      notice = Math.max(0, notice - dt);
      pulseTimer -= dt;
      if (mode === 0 && pulses < 4 && pulseTimer <= 0 && convert()) { pulses++; pulseTimer = 2.8; }
      if (mode === 2) {
        for (const p of plants) if (p.hp > 0) p.hp = Math.min(p.max, p.hp + 30 * dt);
        if (pulseTimer <= 0) { addSun(300 + (pulses * 163) % 600, 110 + (pulses * 71) % 300, 25); pulses++; pulseTimer = 3; }
      }
      remaining = Math.max(0, remaining - dt);
      if (!active()) { document.body.classList.remove('rift-active'); window.GardenMusic?.setRift(false); }
    } else addCharge(dt * .8);
    for (const ally of allies) {
      ally.life -= dt; ally.timer -= dt;
      const target = zombies.find(z => z.hp > 0 && z.r === ally.r && z.x > ally.x - 20);
      if (target && ally.timer <= 0) {
        shots.push({x: ally.x + 24, y: Y + ally.r * CH + 27, r: ally.r, ice: false, damage: 42, cosmic: true});
        ally.timer = .9;
      }
      if (!target) ally.x += 19 * dt;
    }
    allies = allies.filter(a => a.life > 0 && a.x < 1060);
  }

  function decorateShot(b) {
    if (active() && mode === 1 && !b.comet) {
      b.damage *= 2; b.comet = true;
    }
  }

  function impact(z, b) {
    if (b.comet) z.x = Math.min(1080, z.x + 11);
  }

  function reverseEnemy(z, dt) {
    if (!active() || mode !== 2) return false;
    z.x = Math.min(1080, z.x + z.speed * 2.4 * dt);
    return true;
  }

  function draw(c, time) {
    if (!active()) return;
    const a = Math.min(1, remaining, (12 - remaining) * 2);
    c.save(); c.globalAlpha = a;
    c.fillStyle = ['#201439bb', '#0b2c3ea6', '#282047a6'][mode];
    c.fillRect(0, 0, 1100, 540);
    // Stars use a stable pattern; no random flicker, and no rapid screen flashes.
    for (let i = 0; i < 65; i++) {
      const x = (i * 173 + 29) % 1100, y = (i * 97 + 41) % 500;
      const radius = 1 + (i % 3) * .6;
      c.globalAlpha = a * (.4 + .25 * Math.sin(time * .8 + i));
      ellipse(x, y, radius, radius, '#ecdcff');
    }
    c.globalAlpha = a * .36;
    c.strokeStyle = modes[mode].color; c.lineWidth = 1;
    for (let r = 0; r <= 5; r++) { c.beginPath(); c.moveTo(X, Y + r * CH); c.lineTo(X + 9 * CW, Y + r * CH); c.stroke(); }
    for (let col = 0; col <= 9; col++) { c.beginPath(); c.moveTo(X + col * CW, Y); c.lineTo(X + col * CW, Y + 5 * CH); c.stroke(); }
    c.globalAlpha = a * .8;
    c.save(); c.translate(990, 113); c.rotate(-.35);
    ellipse(0, 0, 34, 34, '#a18ac7');
    c.strokeStyle = '#e0c3fa'; c.lineWidth = 7;
    c.beginPath(); c.ellipse(0, 0, 58, 12, 0, 0, Math.PI * 2); c.stroke();
    c.restore(); c.restore();
  }

  function drawCat(c, x, y, time) {
    c.save(); c.translate(x, y);
    c.shadowColor = '#c695ff'; c.shadowBlur = 25;
    ellipse(0, 13, 65, 16, '#8872c4');
    c.shadowBlur = 0;
    ellipse(0, 8, 58, 11, '#d1c0f5');
    ellipse(0, -6, 35, 29, '#b4ecf180');
    c.strokeStyle = '#dcffff'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, -6, 35, Math.PI, Math.PI * 2); c.stroke();
    // The interdimensional captain is unmistakably a cat in a flying saucer.
    c.fillStyle = '#ecc69c';
    c.beginPath(); c.moveTo(-23, -10); c.lineTo(-23, -40); c.lineTo(-7, -29); c.lineTo(8, -29); c.lineTo(23, -40); c.lineTo(23, -10); c.closePath(); c.fill();
    ellipse(0, -14, 23, 17, '#ecc69c');
    c.strokeStyle = '#65485d'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-15, -18); c.lineTo(-6, -18); c.moveTo(6, -18); c.lineTo(15, -18); c.stroke();
    ellipse(0, -10, 3, 2, '#bd7180');
    c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(-11, -7); c.lineTo(-29, -10); c.moveTo(11, -7); c.lineTo(29, -10); c.moveTo(-11, -3); c.lineTo(-29, -1); c.moveTo(11, -3); c.lineTo(29, -1); c.stroke();
    for (let i = 0; i < 5; i++) ellipse(-38 + i * 19, 14, 4, 3, ['#c7ffba', '#ffd58d', '#f1b7ff'][(i + Math.floor(time * 2)) % 3]);
    c.fillStyle = '#ecdcff'; c.font = 'bold 10px Arial'; c.textAlign = 'center'; c.fillText('МЯУ-01', 0, 38);
    c.restore();
  }

  function drawActors(c, time) {
    for (const a of allies) {
      c.save(); c.translate(a.x * 2, 0); c.scale(-1, 1); zombie(a, time); c.restore();
      const y = Y + a.r * CH;
      c.strokeStyle = '#e8b1ff'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(a.x, y - 6, 19, 5, 0, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#edc2ff'; c.font = 'bold 11px Arial'; c.textAlign = 'center'; c.fillText('♥ СОЮЗНИК', a.x, y - 18);
    }
    if (!active()) return;
    const age = 12 - remaining;
    const catX = frozenTarget ? frozenTarget.x : 570 + (reducedMotion ? 0 : Math.sin(age * .55) * 160);
    const catY = frozenTarget ? Math.max(83, frozenTarget.y - 160) : 95 + (reducedMotion ? 0 : Math.sin(age * 1.4) * 9);
    if (frozenTarget) {
      const g = c.createLinearGradient(catX, catY, catX, frozenTarget.y + 65);
      g.addColorStop(0, '#e3a7ff77'); g.addColorStop(1, '#e3a7ff00'); c.fillStyle = g;
      c.beginPath(); c.moveTo(catX - 20, catY + 20); c.lineTo(catX - 52, frozenTarget.y + 65); c.lineTo(catX + 52, frozenTarget.y + 65); c.lineTo(catX + 20, catY + 20); c.fill();
    }
    drawCat(c, catX, catY, time);
    if (mode === 2) {
      for (let i = 0; i < 5; i++) {
        const x = 220 + i * 170, y = 280 + Math.sin(time + i) * (reducedMotion ? 0 : 55);
        c.save(); c.translate(x, y); c.strokeStyle = '#ffdfa0aa'; c.lineWidth = 2;
        c.beginPath(); c.arc(0, 0, 21, 0, Math.PI * 2); c.stroke(); c.rotate(-time);
        c.beginPath(); c.moveTo(0, -15); c.lineTo(0, 0); c.lineTo(10, 0); c.stroke(); c.restore();
      }
    }
  }

  return {reset, activate, update, draw, drawActors, syncUI, addCharge, decorateShot, impact, reverseEnemy,
    get charge() { return charge; }, get active() { return active(); }, get mode() { return mode; },
    get remaining() { return remaining; }, get allies() { return allies; },
    get levitating() { return active() && mode === 1; }
  };
})();
