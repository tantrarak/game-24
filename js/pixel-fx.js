/* pixel-fx.js — animated pixel-RPG scenery drawn behind every page.
   Built to cost next to nothing:
   - sprites are tiny text maps baked once into offscreen canvases (no image downloads)
   - the main canvas runs at 1/3 (1/2 on phones) resolution and is upscaled
     with image-rendering: pixelated, so each frame fills only a few thousand pixels
   - the loop is capped at 20fps and stops entirely while the tab is hidden
   - prefers-reduced-motion / Save-Data get one static frame instead of a loop
   - it boots only after the page has finished loading, during idle time
   Pages can set <body data-fx="calm"> (practice/challenge) for a quieter scene
   with no bats and fewer fireflies, so it never competes with the puzzle. */
(function () {
  const FPS = 20;
  const FRAME_MS = 1000 / FPS;
  const GROUND_H = 3;

  const PAL = {
    k: '#2a2f5a', // outline (kept lighter than the page bg so it reads)
    s: '#94b0c2', S: '#f4f4f4', g: '#ffcd75', G: '#d9a441',
    r: '#d94c5c', b: '#3b5dc9', f: '#f2b98c', w: '#ffffff',
    m: '#38b764', M: '#a7f070', n: '#1f6b4a',
    v: '#8e5cd9', V: '#5d3a9b', p: '#ff5c7a',
    c: '#4fc3ff', C: '#a8e6ff', d: '#1f5f8b'
  };

  const SPRITES = {
    knight: [
      ['....rr......',
       '...rrk......',
       '..kkkkkk....',
       '..ksssSSk...',
       '..kskkkSk...',
       '..ksssssk..S',
       '...kkkkk...S',
       '..kbbgbbk..S',
       '.kbbbgbbbkgg',
       '.kfkbbbkfk.k',
       '..kbbbbbk...',
       '..kkkkkkk...',
       '..ks...ks...',
       '..kk...kk...'],
      ['....rr......',
       '...rrk......',
       '..kkkkkk....',
       '..ksssSSk...',
       '..kskkkSk...',
       '..ksssssk..S',
       '...kkkkk...S',
       '..kbbgbbk..S',
       '.kbbbgbbbkgg',
       '.kfkbbbkfk.k',
       '..kbbbbbk...',
       '..kkkkkkk...',
       '...ksks.....',
       '...kkkk.....']
    ],
    // Slime: frame 0 standing, frame 1 squashed (padded to the same height so feet line up)
    slime: [
      ['...kkkk...',
       '..kmmmMk..',
       '.kmmmmmMk.',
       '.kmwkmwkmk',
       'kmmmmmmmmk',
       'kmmmmmmmmk',
       'knnnnnnnnk',
       '.kkkkkkkk.'],
      ['..........',
       '..........',
       '..kkkkkk..',
       '.kmmmmmMk.',
       'kmmwkmwkmk',
       'kmmmmmmmmk',
       'knnnnnnnnk',
       'kkkkkkkkkk']
    ],
    bat: [
      ['v.......v',
       'vv.VVV.vv',
       'vvVpVpVvv',
       '..VVVVV..',
       '...V.V...'],
      ['.........',
       '...VVV...',
       '.vvpVpvv.',
       'vvvVVVvvv',
       'v..V.V..v']
    ],
    coin: [
      ['.kkk.',
       'kgggk',
       'kgGgk',
       'kgggk',
       '.kkk.'],
      ['..k..',
       '.kgk.',
       '.kGk.',
       '.kgk.',
       '..k..']
    ]
  };

  // Blue slime is the same shape with a palette swap.
  const BLUE_SLIME = { m: PAL.c, M: PAL.C, n: PAL.d };

  function bakeFrame(rows, w, h, swap) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const top = h - rows.length;
    rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) {
        const col = (swap && swap[row[i]]) || PAL[row[i]];
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i, top + y, 1, 1);
      }
    });
    return c;
  }

  function mirror(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const x = c.getContext('2d');
    x.translate(src.width, 0);
    x.scale(-1, 1);
    x.drawImage(src, 0, 0);
    return c;
  }

  // -> { w, h, right: [frames], left: [frames] }
  function bake(frames, swap) {
    const w = Math.max(...frames.flat().map(r => r.length));
    const h = Math.max(...frames.map(f => f.length));
    const right = frames.map(f => bakeFrame(f, w, h, swap));
    return { w, h, right, left: right.map(mirror) };
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function boot() {
    const calm = document.body.dataset.fx === 'calm';
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = !!(navigator.connection && navigator.connection.saveData);

    const canvas = document.createElement('canvas');
    canvas.className = 'pixel-fx';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;' +
      'image-rendering:pixelated;image-rendering:crisp-edges;opacity:0;transition:opacity .8s ease';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const art = {
      knight: bake(SPRITES.knight),
      slime: bake(SPRITES.slime),
      blueSlime: bake(SPRITES.slime, BLUE_SLIME),
      bat: bake(SPRITES.bat),
      coin: bake(SPRITES.coin)
    };

    let W = 0, H = 0, px = 3;
    let stars = [], flies = [], bats = [], walkers = [], tufts = [];

    function layout(force) {
      const newPx = window.innerWidth < 600 ? 2 : 3;
      const newW = Math.ceil(window.innerWidth / newPx);
      const newH = Math.ceil(window.innerHeight / newPx);
      const widthChanged = force || newW !== W || newPx !== px;
      px = newPx;
      W = newW;
      H = newH;
      canvas.width = W;
      canvas.height = H;
      ctx.imageSmoothingEnabled = false;
      // Mobile URL bars resize the height constantly while scrolling — only
      // reseed the scene when the width actually changes, so nothing jumps.
      if (widthChanged) seed();
    }

    function seed() {
      const area = W * H;
      stars = Array.from({ length: Math.min(70, Math.round(area / 700)) }, () => ({
        x: Math.floor(rand(0, W)), y: Math.floor(rand(0, H * 0.6)),
        phase: rand(0, Math.PI * 2), speed: rand(0.6, 1.8)
      }));
      flies = Array.from({ length: calm ? 4 : Math.min(14, Math.round(W / 40)) }, () => ({
        x: rand(0, W), y: rand(H * 0.2, H - 10),
        vx: rand(-3, 3), phase: rand(0, Math.PI * 2)
      }));
      bats = calm ? [] : Array.from({ length: W > 300 ? 2 : 1 }, (_, i) => newBat(i * W * 0.6));
      tufts = [];
      for (let x = 0; x < W; x += Math.floor(rand(3, 9))) tufts.push({ x, tall: Math.random() < 0.3 });

      // A knight followed by a green slime (and a coin it keeps bouncing), plus
      // a blue slime wandering the other way.
      const start = rand(0, W * 0.5);
      walkers = [
        { art: art.knight, x: start, dir: 1, speed: 9, frameT: 0.28 },
        { art: art.slime, x: start - 26, dir: 1, speed: 9, frameT: 0.4, hop: true },
        { art: art.coin, x: start - 40, dir: 1, speed: 9, frameT: 0.15, float: true },
        { art: art.blueSlime, x: rand(W * 0.5, W), dir: -1, speed: 6, frameT: 0.5, hop: true }
      ];
    }

    function newBat(offset) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      return {
        dir, x: dir > 0 ? -20 - (offset || 0) : W + 20 + (offset || 0),
        y0: rand(H * 0.08, H * 0.4), speed: rand(14, 22), phase: rand(0, 6)
      };
    }

    function update(dt) {
      for (const f of flies) {
        f.x += f.vx * dt;
        if (f.x < -2) f.x = W + 2;
        if (f.x > W + 2) f.x = -2;
      }
      for (let i = 0; i < bats.length; i++) {
        const b = bats[i];
        b.x += b.dir * b.speed * dt;
        if (b.x < -40 || b.x > W + 40) bats[i] = newBat(rand(0, W));
      }
      // The knight's party wraps as one group so the slime stays behind the knight.
      const party = walkers.slice(0, 3);
      for (const w of walkers) w.x += w.dir * w.speed * dt;
      if (party[2].x > W + 10) {
        const shift = W + 10 + party[0].x - party[2].x + rand(10, 80);
        for (const w of party) w.x -= shift;
      }
      const lone = walkers[3];
      if (lone.x < -lone.art.w - 10) lone.x = W + rand(10, 120);
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);

      for (const s of stars) {
        ctx.globalAlpha = 0.25 + 0.6 * Math.max(0, Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = '#ffe1a0';
        ctx.fillRect(s.x, s.y, 1, 1);
      }

      for (const f of flies) {
        ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.3 + f.phase));
        ctx.fillStyle = '#ffcd75';
        ctx.fillRect(Math.round(f.x), Math.round(f.y + Math.sin(t * 0.8 + f.phase) * 4), 1, 1);
      }
      ctx.globalAlpha = 1;

      for (const b of bats) {
        const frames = b.dir > 0 ? art.bat.right : art.bat.left;
        const fr = frames[Math.floor(t * 6 + b.phase) % 2];
        ctx.drawImage(fr, Math.round(b.x), Math.round(b.y0 + Math.sin(t * 2 + b.phase) * 5));
      }

      const groundY = H - GROUND_H;
      ctx.fillStyle = '#122019';
      ctx.fillRect(0, groundY, W, GROUND_H);
      ctx.fillStyle = '#2d5a3f';
      ctx.fillRect(0, groundY, W, 1);
      for (const tf of tufts) {
        ctx.fillRect(tf.x, groundY - 1, 1, 1);
        if (tf.tall) ctx.fillRect(tf.x + 1, groundY - 2, 1, 2);
      }

      for (const w of walkers) {
        const frames = w.dir > 0 ? w.art.right : w.art.left;
        const i = Math.floor(t / w.frameT) % frames.length;
        let y = groundY - w.art.h;
        // Hop during the standing frame, land squashed on the other one.
        if (w.hop && i === 0) y -= Math.round(Math.sin(((t % (w.frameT * 2)) / w.frameT) * Math.PI) * 4);
        if (w.float) y -= 8 + Math.round(Math.abs(Math.sin(t * 3)) * 6);
        ctx.drawImage(frames[i], Math.round(w.x), y);
      }
    }

    let raf = 0;
    let last = 0;
    const animate = () => !(reduceMq.matches || saveData);

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      update(dt);
      draw(now / 1000);
    }

    function start() {
      stop();
      if (!animate() || document.hidden) {
        draw(0);
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        layout(false);
        if (!raf) draw(0);
      }, 150);
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    if (reduceMq.addEventListener) reduceMq.addEventListener('change', start);

    layout(true);
    start();
    requestAnimationFrame(() => { canvas.style.opacity = calm ? '0.7' : '0.9'; });
  }

  const idle = window.requestIdleCallback
    ? cb => requestIdleCallback(cb, { timeout: 1500 })
    : cb => setTimeout(cb, 200);
  if (document.readyState === 'complete') idle(boot);
  else window.addEventListener('load', () => idle(boot));
})();
