/* battle.js — pixel knight-vs-dragon battle strip shown during Challenge.
   Correct answer -> the knight dashes in and slashes the dragon, which falls
   and puffs away while a fresh dragon flies in. Wrong / skip / time-up ->
   the dragon swoops down and bites the knight, who falls and respawns.

   Purely cosmetic and cheap: one 160x52 canvas upscaled with pixelated
   rendering, backdrop baked once, sprites are text maps baked once, loop
   capped at 20fps and only running while a game session is on screen.
   Animations play alongside the game flow — they never delay the next
   puzzle. Pages without #battle-canvas get no-op calls. */
(function (global) {
  const W = 160, H = 52, GROUND = 46;
  const FRAME_MS = 1000 / 20;
  const KNIGHT_HOME = 26, DRAGON_HOME = 112, DRAGON_Y = 14;

  const PAL = {
    k: '#1a1426',
    Y: '#ffe066', y: '#f0b429', o: '#b8741a',
    w: '#ffffff', s: '#c7d0e0', S: '#7d879c',
    b: '#3b5dc9', B: '#24357a', d: '#2b2238', r: '#e23b4e',
    g: '#6bd35b', G: '#2f8f46', e: '#f3d36b', E: '#ff3b3b',
    p: '#b16ae0', P: '#6a2f9a'
  };

  const KNIGHT_TOP = [
    '......rr........',
    '.....rrr........',
    '....kkkkk.......',
    '...kYYYYyk......',
    '...kYddddk......',
    '...kYYYYyk....w.',
    '....kkkkk....ws.',
    '...kyYYYyk..ws..',
    '..kbkYYYyk.ws...',
    '..kbBkYYykYs....',
    '..kbBkyyykk.....',
    '..kbbkYYyk......',
    '...kkkooook.....'
  ];
  const LEGS_STAND = ['....kYk.kYk.....', '....kYk.kYk.....', '....kok.kok.....', '...kkkk.kkkk....'];
  const LEGS_RUN = ['...kYk...kYk....', '..kYk.....kYk...', '..kok.....kok...', '.kkk.......kkk..'];
  const KNIGHT_SLASH = [
    '......rr..............',
    '.....rrr..............',
    '....kkkkk.............',
    '...kYYYYyk............',
    '...kYddddk............',
    '...kYYYYyk............',
    '....kkkkk.............',
    '...kyYYYyk............',
    '..kbkYYYykkkkkkkkkkkk.',
    '..kbBkYYykoSsssssssssw',
    '..kbBkyyykkkkkkkkkkkk.',
    '..kbbkYYyk............',
    '...kkkooook...........',
    '...kYk...kYk..........',
    '..kYk.....kYk.........',
    '..kok.....kok.........',
    '.kkk.......kkk........'
  ];

  const DRAGON_BODY = [
    '...kk.....................',
    '..kgGk....................',
    '.kgggGk.....kgggggk.......',
    'kgEggGgk...kgggggggk......',
    'kwkggGggkkkggeeeeggGk.....',
    '.kwwkgggggggeeeeegggGkk...',
    '..kkkkgggggeeeeegggGGggk..',
    '......kGggeeeeeggGGk.kGgk.',
    '.......kGGgeeegGGk....kGk.',
    '........kGkkkkGk.......kk.',
    '........kGk..kGk..........',
    '........kkk..kkk..........'
  ];
  const WING_UP = [
    '..............P...........',
    '.............PpP..........',
    '............PppP...P......',
    '...........PpppP..PpP.....',
    '..........PpppppPPppP.....',
    '..........PppppppppppP....',
    '...........PpppppppppP....',
    '............PPPPPPPPP.....'
  ];
  const BLANK8 = Array(8).fill('..........................');
  const BITE_HEAD = [
    '...kk.....................',
    '..kgGk....................',
    '.kgggGk.....kgggggk.......',
    'kgEggGgk...kgggggggk......',
    'kkkkkGggkkkggeeeeggGk.....',
    'w.w.kgggggggeeeeegggGkk...',
    'kkkkkkgggggeeeeegggGGggk..'
  ];

  function wingDown(body) {
    // fold the wing below the body line instead of above it
    const rows = body.slice();
    const wing = ['PPPPPP', 'PppppppP', 'PppppppP', 'PpppppP', 'PppPP', '.PP'];
    const at = [[5, 12], [6, 11], [7, 10], [8, 10], [9, 11], [10, 12]];
    wing.forEach((seg, i) => {
      const [r, c] = at[i];
      const row = rows[r].split('');
      for (let j = 0; j < seg.length; j++) if (seg[j] !== '.') row[c + j] = seg[j];
      rows[r] = row.join('');
    });
    return rows;
  }

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function bake(rows, tint) {
    const w = Math.max(...rows.map(r => r.length));
    const c = mk(w, rows.length);
    const x = c.getContext('2d');
    rows.forEach((row, yy) => {
      for (let i = 0; i < row.length; i++) {
        const col = PAL[row[i]];
        if (!col) continue;
        x.fillStyle = tint || col;
        x.fillRect(i, yy, 1, 1);
      }
    });
    return c;
  }

  function bakeBackdrop() {
    const c = mk(W, H);
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#1b1233');
    sky.addColorStop(1, '#4a2140');
    x.fillStyle = sky;
    x.fillRect(0, 0, W, H);
    // two rows of pine silhouettes
    const pines = (color, base, minH, maxH, step, seed) => {
      x.fillStyle = color;
      let s = seed;
      const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      for (let px = -4; px < W + 4; px += step + Math.floor(rnd() * 4)) {
        const h = minH + Math.floor(rnd() * (maxH - minH));
        for (let yy = 0; yy < h; yy++) {
          const half = Math.floor((yy / h) * (step * 0.75)) + 1;
          x.fillRect(px - half, base - h + yy, half * 2 + 1, 1);
        }
      }
    };
    pines('#2a1a3a', GROUND, 14, 26, 9, 3);
    pines('#171126', GROUND, 8, 18, 7, 11);
    x.fillStyle = '#3f7a35';
    x.fillRect(0, GROUND, W, 1);
    x.fillStyle = '#2c4a24';
    x.fillRect(0, GROUND + 1, W, 1);
    x.fillStyle = '#2a1d1a';
    x.fillRect(0, GROUND + 2, W, H - GROUND - 2);
    x.fillStyle = '#3a2a24';
    for (let i = 0; i < 30; i++) x.fillRect((i * 37) % W, GROUND + 3 + (i % 3), 2, 1);
    return c;
  }

  const ease = t => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, t) => a + (b - a) * ease(t);

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const knightStand = bake(KNIGHT_TOP.concat(LEGS_STAND));
    const knightRun = bake(KNIGHT_TOP.concat(LEGS_RUN));
    const art = {
      backdrop: bakeBackdrop(),
      knight: [knightStand, knightRun],
      knightSlash: bake(KNIGHT_SLASH),
      knightHurt: bake(KNIGHT_TOP.concat(LEGS_STAND), '#ff5c6c'),
      dragonUp: bake(WING_UP.concat(DRAGON_BODY)),
      dragonDown: bake(BLANK8.concat(wingDown(DRAGON_BODY))),
      dragonBite: bake(WING_UP.concat(BITE_HEAD, DRAGON_BODY.slice(7))),
      dragonFlash: bake(WING_UP.concat(DRAGON_BODY), '#ffffff')
    };

    // scene state; `act` is the running sequence ('knight' | 'dragon' | null)
    let act = null, actT = 0;
    let particles = [];
    let raf = 0, last = 0, running = false, clock = 0;

    function burst(x, y, colors, n, spread, up) {
      for (let i = 0; i < n; i++) {
        particles.push({
          x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * up,
          life: 0.4 + Math.random() * 0.5, color: colors[i % colors.length]
        });
      }
    }

    function play(kind) {
      act = kind;
      actT = 0;
      particles = [];
      if (!running) draw(); // still show the result pose if the loop is paused
    }

    function step(dt) {
      clock += dt;
      if (act) {
        const prev = actT;
        actT += dt;
        // one-shot effects at specific moments of each sequence
        if (act === 'knight' && prev < 0.38 && actT >= 0.38) {
          burst(DRAGON_HOME + 6, DRAGON_Y + 14, ['#ffffff', '#ffe066', '#ff7a2f'], 14, 50, 30);
        }
        if (act === 'knight' && prev < 0.95 && actT >= 0.95) {
          burst(DRAGON_HOME + 12, GROUND - 4, ['#8a8aa8', '#5a5a78', '#c0c0d8'], 18, 34, 18);
        }
        if (act === 'dragon' && prev < 0.42 && actT >= 0.42) {
          burst(KNIGHT_HOME + 8, GROUND - 12, ['#ffe066', '#ffffff', '#ff5c6c'], 12, 44, 26);
        }
        if (act === 'dragon' && prev < 1.45 && actT >= 1.45) {
          burst(KNIGHT_HOME + 8, GROUND - 8, ['#fff6b0', '#7fefff', '#ffffff'], 14, 30, 30);
        }
        if (actT > 1.9) act = null;
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 60 * dt;
      }
    }

    function drawKnight(x, frame, opts) {
      const img = frame;
      const y = GROUND - img.height + ((opts && opts.bob) || 0);
      if (opts && opts.dead) {
        // lying on the ground, rotated a quarter turn
        ctx.save();
        ctx.translate(Math.round(x + img.height / 2), GROUND - 4);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2 + 2);
        ctx.restore();
        return;
      }
      if (opts && opts.alpha != null) ctx.globalAlpha = opts.alpha;
      ctx.drawImage(img, Math.round(x), Math.round(y));
      ctx.globalAlpha = 1;
    }

    function drawDragon(x, y, img, opts) {
      if (opts && opts.alpha != null) ctx.globalAlpha = opts.alpha;
      if (opts && opts.flipY) {
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y) + img.height);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(img, Math.round(x), Math.round(y));
      }
      ctx.globalAlpha = 1;
    }

    function draw() {
      ctx.drawImage(art.backdrop, 0, 0);
      const flap = Math.floor(clock * 6) % 2 === 0;
      const hover = Math.round(Math.sin(clock * 3) * 2);
      const dragonIdle = flap ? art.dragonUp : art.dragonDown;
      const t = actT;

      if (act === 'knight') {
        // 0-0.3 dash in, 0.3-0.55 slash, 0.55-1.0 dragon falls, knight walks back,
        // 1.0-1.9 new dragon flies in from the right
        const reach = DRAGON_HOME - 20;
        let kx, kImg;
        if (t < 0.3) { kx = lerp(KNIGHT_HOME, reach, t / 0.3); kImg = art.knight[Math.floor(t * 16) % 2]; }
        else if (t < 0.6) { kx = reach; kImg = art.knightSlash; }
        else if (t < 1.0) { kx = lerp(reach, KNIGHT_HOME, (t - 0.6) / 0.4); kImg = art.knight[Math.floor(t * 16) % 2]; }
        else { kx = KNIGHT_HOME; kImg = art.knight[0]; }

        if (t < 0.38) drawDragon(DRAGON_HOME, DRAGON_Y + hover, dragonIdle);
        else if (t < 0.5) drawDragon(DRAGON_HOME, DRAGON_Y, art.dragonFlash);
        else if (t < 0.95) {
          const fall = (t - 0.5) / 0.45;
          drawDragon(DRAGON_HOME + fall * 6, lerp(DRAGON_Y, GROUND - art.dragonDown.height + 4, fall),
            art.dragonDown, { flipY: true, alpha: Math.floor(t * 20) % 2 ? 1 : 0.6 });
        } else if (t > 1.15) {
          drawDragon(lerp(W + 4, DRAGON_HOME, (t - 1.15) / 0.7), DRAGON_Y + hover, dragonIdle);
        }

        drawKnight(kx, kImg);
        if (t >= 0.3 && t < 0.55) {
          // sword arc
          const a = (t - 0.3) / 0.25;
          ctx.strokeStyle = `rgba(255,255,255,${1 - a})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(reach + 14, GROUND - 9, 9 + a * 3, -1.5, 0.5);
          ctx.stroke();
        }
      } else if (act === 'dragon') {
        // 0-0.4 swoop down, 0.4-0.6 bite, 0.6-1.0 fly back, knight lies down
        // until 1.45, then respawns with a sparkle
        const biteX = KNIGHT_HOME + 8, biteY = GROUND - art.dragonBite.height + 2;
        let dx, dy, dImg = dragonIdle;
        if (t < 0.4) { dx = lerp(DRAGON_HOME, biteX, t / 0.4); dy = lerp(DRAGON_Y, biteY, t / 0.4); }
        else if (t < 0.6) { dx = biteX; dy = biteY; dImg = art.dragonBite; }
        else if (t < 1.05) { dx = lerp(biteX, DRAGON_HOME, (t - 0.6) / 0.45); dy = lerp(biteY, DRAGON_Y, (t - 0.6) / 0.45); }
        else { dx = DRAGON_HOME; dy = DRAGON_Y + hover; }

        if (t < 0.42) drawKnight(KNIGHT_HOME, art.knight[0]);
        else if (t < 0.6) drawKnight(KNIGHT_HOME, art.knightHurt, { bob: Math.floor(t * 30) % 2 });
        else if (t < 1.45) drawKnight(KNIGHT_HOME, art.knight[0], { dead: true });
        else drawKnight(KNIGHT_HOME, art.knight[0], { alpha: Math.min(1, (t - 1.45) / 0.25) });

        drawDragon(dx, dy, dImg);
      } else {
        drawDragon(DRAGON_HOME, DRAGON_Y + hover, dragonIdle);
        drawKnight(KNIGHT_HOME, art.knight[0], { bob: Math.floor(clock * 2) % 2 });
      }

      for (const p of particles) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      step(dt);
      draw();
    }

    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (running) { stop(); running = 'paused'; } }
      else if (running === 'paused') { running = false; start(); }
    });

    draw();
    return { start, stop, knightWins: () => play('knight'), dragonWins: () => play('dragon') };
  }

  let api = null;
  function get() {
    if (api) return api;
    const canvas = document.getElementById('battle-canvas');
    if (!canvas) return null;
    api = create(canvas);
    return api;
  }

  global.Battle24 = {
    start() { const a = get(); if (a) a.start(); },
    stop() { const a = get(); if (a) a.stop(); },
    knightWins() { const a = get(); if (a) a.knightWins(); },
    dragonWins() { const a = get(); if (a) a.dragonWins(); }
  };
})(window);
