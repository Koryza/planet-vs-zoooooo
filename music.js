/* Green Frontier — original procedural soundtrack, composed in the browser.
 * GardenMusic.start()/resume(): call after a user gesture. pause()/stop() silence
 * playback; toggle() persists mute. setWorld(0..2), setIntensity(0..1), and
 * setRift(bool) change the arrangement without starting another player.
 * No audio is created until start/resume/toggle is explicitly called.
 */
(function () {
  'use strict';
  const KEY = 'green-frontier-music';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) {}
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  let context, master, compressor, echo, echoSend, echoFeedback, reverbSend;
  let timer = null, wanted = false, playing = false, initializing = false;
  let step = 0, nextTime = 0, world = 0, intensity = 0, rift = false;
  let generation = 0, noiseBuffer;
  const active = new Set();
  const SCORES = [
    { root: 50, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 120,
      chords: [0, 0, 5, 5, 3, 3, 4, 4], lead: [7, 9, 11, 9, 8, 7, 5, 7, 9, 11, 12, 11, 9, 8, 7, 4] },
    { root: 50, scale: [0, 1, 4, 5, 7, 8, 10], tempo: 124,
      chords: [0, 0, 3, 3, 5, 5, 1, 4], lead: [7, 8, 9, 11, 9, 8, 7, 4, 7, 9, 11, 12, 11, 9, 8, 7] },
    { root: 48, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 112,
      chords: [0, 0, 5, 5, 2, 2, 6, 6], lead: [11, 9, 7, 9, 12, 11, 9, 7, 8, 9, 11, 12, 14, 12, 11, 9] }
  ];
  function notify() {
    try { window.dispatchEvent(new CustomEvent('gardenmusicchange', { detail: { enabled, playing } })); } catch (_) {}
  }
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function note(degree, octave = 0) {
    const score = SCORES[world];
    const index = ((degree % 7) + 7) % 7;
    return midi(score.root + score.scale[index] + Math.floor(degree / 7) * 12 + octave * 12);
  }
  function init() {
    if (context) return true;
    if (!AudioEngine) return false;
    try {
      context = new AudioEngine();
      master = context.createGain(); master.gain.value = 0;
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -15; compressor.knee.value = 18;
      compressor.ratio.value = 4; compressor.attack.value = .004; compressor.release.value = .2;
      master.connect(compressor); compressor.connect(context.destination);
      echo = context.createDelay(1); echo.delayTime.value = 60 / SCORES[world].tempo * .75;
      echoFeedback = context.createGain(); echoFeedback.gain.value = .28;
      const echoFilter = context.createBiquadFilter(); echoFilter.type = 'lowpass'; echoFilter.frequency.value = 2700;
      echoSend = context.createGain(); echoSend.gain.value = .19;
      echoSend.connect(echo); echo.connect(echoFilter); echoFilter.connect(master);
      echoFilter.connect(echoFeedback); echoFeedback.connect(echo);
      const reverb = context.createConvolver();
      const length = Math.floor(context.sampleRate * 1.9), impulse = context.createBuffer(2, length, context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3) * .6;
      }
      reverb.buffer = impulse;
      reverbSend = context.createGain(); reverbSend.gain.value = .15;
      reverbSend.connect(reverb); reverb.connect(master);
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (_) { context = null; return false; }
  }
  function keep(source, end, cleanup) {
    active.add(source);
    source.onended = () => { active.delete(source); source.disconnect(); if (cleanup) cleanup(); };
    source.stop(end);
  }
  function voice(frequency, time, length, volume, type = 'triangle', cutoff = 0, wet = false, detune = 0) {
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, time); osc.detune.value = detune;
    env.gain.setValueAtTime(.0001, time);
    env.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), time + .012);
    env.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .48), time + Math.min(.11, length * .4));
    env.gain.exponentialRampToValueAtTime(.0001, time + length);
    let filter;
    if (cutoff) {
      filter = context.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, time);
      filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * .4), time + length);
      osc.connect(filter); filter.connect(env);
    } else osc.connect(env);
    env.connect(master);
    if (wet) { env.connect(echoSend); env.connect(reverbSend); }
    osc.start(time);
    keep(osc, time + length + .02, () => { env.disconnect(); if (filter) filter.disconnect(); });
  }
  function noise(time, length, volume, frequency, type) {
    const source = context.createBufferSource(), env = context.createGain(), filter = context.createBiquadFilter();
    source.buffer = noiseBuffer; filter.type = type; filter.frequency.value = frequency;
    env.gain.setValueAtTime(Math.max(.0002, volume), time);
    env.gain.exponentialRampToValueAtTime(.0001, time + length);
    source.connect(filter); filter.connect(env); env.connect(master);
    source.start(time, Math.random() * .5);
    keep(source, time + length, () => { filter.disconnect(); env.disconnect(); });
  }
  function kick(time, big) {
    const source = context.createOscillator(), env = context.createGain();
    source.frequency.setValueAtTime(big ? 155 : 130, time);
    source.frequency.exponentialRampToValueAtTime(big ? 42 : 48, time + .14);
    env.gain.setValueAtTime(big ? .68 : .56, time);
    env.gain.exponentialRampToValueAtTime(.0001, time + .32);
    source.connect(env); env.connect(master); source.start(time);
    keep(source, time + .34, () => env.disconnect());
    noise(time, .016, .13, 2800, 'highpass');
  }
  function snare(time, big) {
    noise(time, .16, big ? .32 : .22, 1800, 'highpass');
    voice(185, time, .12, .11, 'triangle');
    if (big) noise(time + .013, .09, .1, 3500, 'highpass');
  }
  function pad(chord, time, beat, bar) {
    const length = beat * 3.95;
    [0, 2, 4, 6].forEach((d, i) => {
      const n = note(chord + d, 1), vol = .026;
      voice(n, time + i * .018, length, vol, 'triangle', 2400, true, -4);
      if (world === 2 || rift) voice(n, time + i * .018, length, vol * .4, 'sine', 0, true, 5);
    });
    if (bar % 4 === 0) voice(note(chord + 14, 1), time, beat * 2, .032, 'sine', 0, true);
  }
  function schedule(index, time) {
    const score = SCORES[world], bar = Math.floor(index / 16), pos = index % 16;
    const chord = score.chords[bar % 8];
    const energy = rift ? 1 : intensity;
    const beat = 60 / (rift ? 142 : score.tempo);
    const drums = energy > .48;
    // A full arrangement from the first bar: four-on-the-floor with syncopated fills.
    if (pos % 4 === 0 || (drums && (pos === 10 || (bar % 4 === 3 && pos === 15)))) kick(time, rift);
    if (pos === 4 || pos === 12) snare(time, rift || energy > .7);
    if (pos % 2 === 0 || (drums && pos % 4 === 3)) noise(time, pos === 14 ? .13 : .045, pos % 4 === 2 ? .072 : .038, 7200, 'highpass');
    if (bar % 8 === 7 && pos >= 14) noise(time, .07, .095, 4200 + (pos - 14) * 900, 'bandpass');
    if (pos === 0) pad(chord, time, beat, bar);
    const bassPattern = [0, null, 0, 7, null, 0, 4, null, 0, null, 7, 0, null, 4, 7, null];
    if (bassPattern[pos] !== null) {
      const bass = note(chord + bassPattern[pos], -1);
      voice(bass, time + .008, beat * .43, .15, rift ? 'sawtooth' : 'triangle', rift ? 850 : 1500);
      voice(bass / 2, time + .008, beat * .4, .11, 'sine');
    }
    const arp = [0, 4, 7, 2, 4, 9, 7, 4];
    if (pos % 2 === 0 || rift) {
      const arpDegree = chord + arp[(pos + Math.floor(bar / 2)) % arp.length];
      voice(note(arpDegree, 1), time + .006, beat * (rift ? .22 : .38), rift ? .048 : .034,
        world === 1 ? 'sine' : 'triangle', 4200, true, rift ? (pos % 2 ? 6 : -6) : 0);
    }
    // A composed eight-bar hook rather than random notes; answer phrase varies in bars 5–8.
    if (pos % 2 === 0 && (bar % 2 === 0 || pos >= 8 || energy > .5)) {
      const motif = score.lead[(Math.floor(pos / 2) + (bar % 2) * 8) % 16];
      const octave = rift && bar % 2 ? 2 : 1;
      const melody = note(motif + (bar % 8 >= 4 ? 2 : 0), octave);
      voice(melody, time, beat * (pos === 14 ? .85 : .48), .052, 'triangle', 5500, true);
      if (rift) voice(melody / 2, time, beat * .4, .018, 'square', 1800, true);
    }
    if (rift && pos === 0 && bar % 2 === 0) {
      noise(time, .7, .07, 5000, 'highpass');
      voice(note(0, -2), time, beat * 2, .18, 'sawtooth', 600);
    }
  }
  function scheduler() {
    if (!playing || !context || context.state !== 'running') return;
    if (nextTime < context.currentTime - .08) nextTime = context.currentTime + .025;
    while (nextTime < context.currentTime + .12) {
      schedule(step++, nextTime);
      nextTime += 60 / (rift ? 142 : SCORES[world].tempo) / 4;
      if (step >= 16 * 256) step = 0;
    }
  }
  function silence() {
    generation++;
    if (timer !== null) { clearInterval(timer); timer = null; }
    initializing = false;
    playing = false;
    if (context && master) {
      const t = context.currentTime;
      master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(0, t, .018);
      for (const source of active) { try { source.stop(t + .065); } catch (_) {} }
      // Master gain mutes the delay/reverb tail too, even before suspension.
      context.suspend().catch(() => {});
    }
    notify();
  }
  function begin() {
    if (!wanted || !enabled || document.hidden || playing || initializing) return;
    if (!init()) { notify(); return; }
    initializing = true;
    const token = ++generation;
    context.resume().then(() => {
      if (token !== generation) return;
      initializing = false;
      if (!wanted || !enabled || document.hidden || context.state !== 'running') return;
      playing = true;
      nextTime = context.currentTime + .045;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      master.gain.linearRampToValueAtTime(.48, context.currentTime + .18);
      scheduler();
      timer = setInterval(scheduler, 25);
      notify();
    }).catch(() => { if (token === generation) { initializing = false; playing = false; notify(); } });
  }
  const api = {
    start() { wanted = true; begin(); return enabled; },
    resume() { wanted = true; begin(); return enabled; },
    pause() { wanted = false; silence(); },
    stop() { wanted = false; silence(); step = 0; rift = false; intensity = 0; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) {}
      if (!enabled) silence(); else begin();
      notify(); return enabled;
    },
    setIntensity(value) { intensity = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; },
    setWorld(value) {
      world = Math.max(0, Math.min(2, Math.floor(Number(value) || 0)));
      if (echo && context) echo.delayTime.setTargetAtTime(60 / SCORES[world].tempo * .75, context.currentTime, .12);
    },
    setRift(value) { rift = !!value; },
    get enabled() { return enabled; },
    get playing() { return playing; },
    get supported() { return !!AudioEngine; }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) silence(); else if (wanted) begin();
  });
  window.GardenMusic = Object.freeze(api);
})();
