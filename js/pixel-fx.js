/* pixel-fx.js — animated pixel-fantasy night scene drawn behind every page:
   moon, drifting clouds, light rain, stars, fireflies, and along the bottom
   edge a lantern tree, lamp post, treasure chest, campfire, glowing crystals
   and a torch.

   Built to cost next to nothing:
   - no image downloads; sprites are tiny text maps / procedural shapes
   - everything that doesn't move (ground, tree, chest, posts) is baked ONCE
     into an offscreen layer and blitted with a single drawImage per frame;
     only flames, glows, rain and particles are drawn live
   - the canvas runs at 1/3 (1/2 on phones) resolution, upscaled with
     image-rendering: pixelated, so each frame touches very few pixels
   - capped at 20fps, stopped entirely while the tab is hidden
   - prefers-reduced-motion / Save-Data get one static frame, no loop
   - boots only after the page has loaded, during idle time
   <body data-fx="calm"> (practice/challenge) drops the rain and most
   fireflies and dims the scene so it never competes with the puzzle. */
(function () {
  const FPS = 20;
  const FRAME_MS = 1000 / FPS;
  const SCENE_H = 96; // art px of the baked bottom strip
  const GROUND_H = 8;

  const PAL = {
    k: '#1b1830',
    // chest
    B: '#5c2f1d', b: '#8a4b2a', g: '#ffcd75', G: '#d9a441',
    // flames
    y: '#fff3b0', o: '#ffb347', O: '#ff7a2f', R: '#d9442b',
    // logs / wood
    L: '#5a3324', l: '#8f5a3a', s: '#4a4560',
    // crystals
    c: '#4fe3ff', C: '#c4f8ff', d: '#1f7a9c',
    // iron / lamp
    i: '#2e2a45', Y: '#ffe7a0',
    // lantern
    A: '#c9527a', p: '#ffb3c6'
  };

  const SPRITES = {
    chest: [
      '..kkkkkkkkkk..',
      '.kBBBBBgBBBBk.',
      'kBbbbbbgbbbbBk',
      'kBbbbbbgbbbbBk',
      'kkkkkkkGkkkkkk',
      'kBbbbbgGgbbbBk',
      'kBbbbbbgbbbbBk',
      'kBbbbbbgbbbbBk',
      'kGBBBBBgBBBBGk',
      '.kkkkkkkkkkkk.'
    ],
    crystals: [
      '....C.......',
      '...CCd......',
      '...Ccd...C..',
      '.C.Ccd..CCd.',
      'CCdCccd.Ccd.',
      'CcdCccdCCcdC',
      'CcdCccdCccdc',
      'kkkkkkkkkkkk'
    ],
    lamp: [
      '..iii..',
      '.iYYYi.',
      '.iYgYi.',
      '.iYYYi.',
      '..iii..',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '...i...',
      '..iii..',
      '.iiiii.'
    ],
    torch: [
      'kGk',
      '.l.',
      '.l.',
      '.l.',
      '.L.',
      '.L.',
      '.L.',
      '.L.',
      '.L.',
      '.L.',
      'kLk'
    ],
    logs: [
      's.LllllllL.s',
      'sLllLLLLlllLs',
      '.sLL.....LLs.'
    ],
    lantern: ['.k.', 'ApA', 'AyA', '.A.'],
    flame: [
      ['...O...',
       '...O...',
       '..OoO..',
       '..Ooo.O',
       '.OoyoO.',
       '.Ooyyo.',
       'OoyyyoO',
       'OoyyyoO',
       '.Ooyoo.',
       '..OOO..'],
      ['....O..',
       '...O...',
       '...oO..',
       '.O.ooO.',
       '.OoyoO.',
       'OooyyoO',
       'OoyyyoO',
       'Ooyyyo.',
       '.Ooyoo.',
       '..OOO..'],
      ['..O....',
       '...O...',
       '..Oo...',
       '..OooO.',
       '.OoyoO.',
       '.Ooyyo.',
       'OoyyyoO',
       'OoyyyoO',
       '.Ooyyo.',
       '..OOO..']
    ],
    torchFlame: [
      ['.O.', 'OoO', 'oyo', 'OoO'],
      ['O..', 'Oo.', 'oyO', 'OoO'],
      ['..O', '.oO', 'Oyo', 'OoO']
    ]
  };

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Bakes one text map; frames of an animation are padded to a shared size and bottom-aligned.
  function bakeRows(rows, w, h) {
    w = w || Math.max(...rows.map(r => r.length));
    h = h || rows.length;
    const c = mk(w, h);
    const x = c.getContext('2d');
    const top = h - rows.length;
    rows.forEach((row, yy) => {
      for (let i = 0; i < row.length; i++) {
        const col = PAL[row[i]];
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i, top + yy, 1, 1);
      }
    });
    return c;
  }

  function bakeFrames(frames) {
    const w = Math.max(...frames.flat().map(r => r.length));
    const h = Math.max(...frames.map(f => f.length));
    return frames.map(f => bakeRows(f, w, h));
  }

  function bakeGlow(r, rgb, strength) {
    const c = mk(r * 2, r * 2);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, `rgba(${rgb},${strength})`);
    g.addColorStop(0.35, `rgba(${rgb},${strength * 0.35})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, r * 2, r * 2);
    return c;
  }

  function bakeMoon(r) {
    const s = r * 2 + 1;
    const c = mk(s, s);
    const x = c.getContext('2d');
    for (let py = 0; py < s; py++) {
      for (let pxl = 0; pxl < s; pxl++) {
        const dx = pxl - r, dy = py - r;
        const d = Math.sqrt(dx * dx + dy * dy);
        const bite = Math.sqrt((dx + r * 0.55) ** 2 + (dy + r * 0.2) ** 2);
        if (d > r || bite < r * 0.85) continue;
        x.fillStyle = d > r - 1.2 || bite < r * 0.85 + 1.2 ? '#b9c3dd' : '#e3e9f7';
        x.fillRect(pxl, py, 1, 1);
      }
    }
    x.fillStyle = '#c4cde3';
    x.fillRect(r + 3, r - 2, 2, 2);
    x.fillRect(r + 1, r + 4, 1, 1);
    return c;
  }

  function bakeCloud(w, rnd) {
    // Puffs sit fully inside the canvas (never clipped by its top edge), so
    // the outline is a bumpy dome over a flat base rather than a box.
    const h = Math.round(w * 0.36);
    const circles = [];
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const edge = i === 0 || i === n - 1;
      const rr = h * (edge ? 0.22 + rnd() * 0.1 : 0.32 + rnd() * 0.18);
      const cx = rr + (w - 2 * rr) * (i / (n - 1 || 1));
      circles.push({ cx, cy: h - rr, rx: rr, ry: rr });
    }
    // a wide, low ellipse joining the puffs into one cloud
    circles.push({ cx: w / 2, cy: h - h * 0.28, rx: w * 0.48, ry: h * 0.28 });
    const inside = (px, py) => py < h && py >= 0 && px >= 0 && px < w &&
      circles.some(q => ((px - q.cx) / q.rx) ** 2 + ((py - q.cy) / q.ry) ** 2 <= 1);
    const c = mk(w, h);
    const x = c.getContext('2d');
    for (let py = 0; py < h; py++) {
      for (let pxl = 0; pxl < w; pxl++) {
        if (!inside(pxl, py)) continue;
        x.fillStyle = !inside(pxl, py - 1) ? '#3b3a72' : py >= h - 2 ? '#1f1c42' : '#2a2852';
        x.fillRect(pxl, py, 1, 1);
      }
    }
    return c;
  }

  // Seeded RNG so the scenery looks the same on every visit.
  function seeded(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function line(g, x0, y0, x1, y1, w) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), w, w);
    }
  }

  // Bare autumn tree; returns lantern hang points when asked for lanterns.
  function drawTree(g, x, groundY, h, rnd, lanternCount) {
    const trunkH = Math.round(h * 0.42);
    g.fillStyle = '#3b2f4a';
    for (let yy = 0; yy < trunkH; yy++) {
      const w = yy < 2 ? 5 : yy < trunkH * 0.6 ? 3 : 2;
      g.fillRect(x - Math.floor(w / 2), groundY - 1 - yy, w, 1);
    }
    const tips = [];
    const joints = [];
    const branch = (bx, by, ang, len, depth) => {
      const ex = bx + Math.cos(ang) * len;
      const ey = by - Math.sin(ang) * len;
      g.fillStyle = '#3b2f4a';
      line(g, bx, by, ex, ey, depth >= 3 ? 2 : 1);
      if (depth === 0) { tips.push([ex, ey]); return; }
      if (depth <= 2) joints.push([ex, ey]);
      const spread = 0.38 + rnd() * 0.32;
      branch(ex, ey, ang + spread, len * (0.62 + rnd() * 0.15), depth - 1);
      branch(ex, ey, ang - spread, len * (0.62 + rnd() * 0.15), depth - 1);
    };
    const top = groundY - 1 - trunkH;
    branch(x, top, Math.PI / 2 + (rnd() - 0.5) * 0.2, h * 0.28, 4);

    const leaves = ['#e07438', '#f4a259', '#b5452b'];
    for (const [tx, ty] of tips) {
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        g.fillStyle = leaves[Math.floor(rnd() * leaves.length)];
        g.fillRect(Math.round(tx + (rnd() - 0.5) * 3), Math.round(ty + (rnd() - 0.5) * 3), 1, 1);
      }
    }

    const lanterns = [];
    if (lanternCount) {
      const candidates = joints.filter(([, jy]) => jy < top - 3).sort((a, b) => a[0] - b[0]);
      const picks = lanternCount === 1
        ? [candidates[Math.floor(candidates.length / 2)]]
        : [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates[candidates.length - 1]];
      for (const p of picks) {
        if (!p) continue;
        const hx = Math.round(p[0]);
        const hy = Math.round(p[1]);
        const len = 3 + Math.floor(rnd() * 4);
        g.fillStyle = '#5a4d70';
        g.fillRect(hx, hy + 1, 1, len);
        lanterns.push({ x: hx, y: hy + len + 1 });
      }
    }
    return lanterns;
  }

  function boot() {
    const calm = document.body.dataset.fx === 'calm';
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = !!(navigator.connection && navigator.connection.saveData);

    const canvas = mk(1, 1);
    canvas.className = 'pixel-fx';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;' +
      'image-rendering:pixelated;image-rendering:crisp-edges;opacity:0;transition:opacity .8s ease';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const art = {
      chest: bakeRows(SPRITES.chest),
      crystals: bakeRows(SPRITES.crystals),
      lamp: bakeRows(SPRITES.lamp),
      torch: bakeRows(SPRITES.torch),
      logs: bakeRows(SPRITES.logs),
      lantern: bakeRows(SPRITES.lantern),
      flame: bakeFrames(SPRITES.flame),
      torchFlame: bakeFrames(SPRITES.torchFlame),
      moon: bakeMoon(9),
      glowFire: bakeGlow(34, '255,150,60', 0.5),
      glowWarm: bakeGlow(20, '255,190,90', 0.45),
      glowLantern: bakeGlow(9, '255,170,190', 0.55),
      glowCyan: bakeGlow(20, '80,220,255', 0.45),
      glowMoon: bakeGlow(30, '190,205,255', 0.22)
    };

    let W = 0, H = 0, px = 3;
    let layer = null;
    let spots = null;
    let stars = [], flies = [], drops = [], clouds = [], sparks = [];

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
      // rebuild the scene when the width changes, so nothing jumps around.
      if (widthChanged) { bakeScene(); seed(); }
    }

    function bakeScene() {
      layer = mk(W, SCENE_H);
      const g = layer.getContext('2d');
      const rnd = seeded(24);
      const gy = SCENE_H - GROUND_H;
      const narrow = W < 260;

      // ground: grass lip, dirt, scattered stones, tufts
      g.fillStyle = '#211b30';
      g.fillRect(0, gy, W, GROUND_H);
      g.fillStyle = '#3e8948';
      g.fillRect(0, gy, W, 1);
      g.fillStyle = '#265c42';
      g.fillRect(0, gy + 1, W, 1);
      for (let i = 0; i < W / 5; i++) {
        g.fillStyle = rnd() < 0.5 ? '#3a3150' : '#2d2640';
        g.fillRect(Math.floor(rnd() * W), gy + 3 + Math.floor(rnd() * (GROUND_H - 4)),
          2 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
      }
      g.fillStyle = '#3e8948';
      for (let x = 0; x < W; x += 2 + Math.floor(rnd() * 6)) {
        g.fillRect(x, gy - 1, 1, 1);
        if (rnd() < 0.35) g.fillRect(x + 1, gy - 2, 1, 2);
      }

      const s = { fires: [], torches: [], lamps: [], lanterns: [], crystals: [], chests: [] };
      const put = (img, x) => { g.drawImage(img, x, gy - img.height); return gy - img.height; };

      // left group: lantern tree, lamp post, treasure chest
      const treeX = narrow ? 20 : Math.round(W * 0.04) + 22;
      s.lanterns = drawTree(g, treeX, gy, narrow ? 54 : 70, rnd, narrow ? 1 : 3);
      for (const ln of s.lanterns) g.drawImage(art.lantern, ln.x - 1, ln.y);
      // chest tucked against the trunk, lamp post just past it — kept close to
      // the screen edge so the centred content cards don't cover them
      const chestX = treeX + 4;
      const cy = put(art.chest, chestX);
      s.chests.push({ x: chestX + 2, y: cy });
      if (!narrow) {
        const lx = chestX + art.chest.width + 6;
        const ly = put(art.lamp, lx);
        s.lamps.push({ x: lx + 3, y: ly + 2 });
      }

      // right group: campfire, glowing crystals, torch (and a small tree on wide screens)
      let rx = W - 6;
      if (!narrow) {
        rx -= art.torch.width;
        const ty = put(art.torch, rx);
        s.torches.push({ x: rx, y: ty - 4 });
        rx -= 12;
      }
      rx -= art.crystals.width;
      const ky = put(art.crystals, rx);
      s.crystals.push({ x: rx + art.crystals.width / 2, y: ky + 3 });
      rx -= 14 + art.logs.width;
      const logY = put(art.logs, rx);
      s.fires.push({ x: rx + 3, y: logY - art.flame[0].height + 2 });
      if (W > 380) drawTree(g, rx - 26, gy, 46, rnd, 0);

      spots = s;
    }

    function seed() {
      const rnd = seeded(7);
      stars = Array.from({ length: Math.min(80, Math.round((W * H) / 650)) }, () => ({
        x: Math.floor(rand(0, W)), y: Math.floor(rand(0, H * 0.65)),
        phase: rand(0, Math.PI * 2), speed: rand(0.6, 1.8)
      }));
      const crystal = spots.crystals[0];
      const nFlies = calm ? 5 : Math.min(18, Math.round(W / 26));
      flies = Array.from({ length: nFlies }, (_, i) => {
        const cyan = i % 2 === 0;
        return cyan
          ? { cyan, x: crystal.x + rand(-35, 35), y: H - SCENE_H + rand(20, SCENE_H - 14), vx: rand(-2, 2), phase: rand(0, 6) }
          : { cyan, x: rand(0, W), y: rand(H * 0.25, H - 14), vx: rand(-3, 3), phase: rand(0, 6) };
      });
      drops = calm ? [] : Array.from({ length: Math.min(70, Math.round(W / 6)) }, () => ({
        x: rand(0, W + 30), y: rand(-H, H), v: rand(95, 135)
      }));
      clouds = Array.from({ length: W > 300 ? 4 : 2 }, (_, i) => {
        const img = bakeCloud(Math.round(40 + rnd() * 50), rnd);
        return { img, x: rnd() * W, y: 24 + i * 9 + rnd() * 12, v: 1 + rnd() * 2 };
      });
      sparks = [];
    }

    function update(dt) {
      for (const f of flies) {
        f.x += f.vx * dt;
        if (f.x < -2) f.x = W + 2;
        if (f.x > W + 2) f.x = -2;
      }
      const floor = H - GROUND_H;
      for (const d of drops) {
        d.y += d.v * dt;
        d.x -= d.v * 0.12 * dt;
        if (d.y > floor) { d.y = rand(-40, 0); d.x = rand(0, W + 30); }
      }
      for (const c of clouds) {
        c.x += c.v * dt;
        if (c.x > W) c.x = -c.img.width;
      }
      const top = H - SCENE_H;
      for (const f of spots.fires) {
        if (Math.random() < dt * 7) {
          const life = rand(0.8, 1.8);
          sparks.push({ x: f.x + 3 + rand(-2, 2), y: top + f.y + 3, vx: rand(-3, 3), vy: rand(-22, -12), life, max: life });
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life -= dt;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      const top = H - SCENE_H;

      // sky: moon, stars, clouds, rain
      const mx = Math.round(W * 0.86) - 9;
      const my = 30;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(art.glowMoon, mx + 9 - 30, my + 9 - 30);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(art.moon, mx, my);

      ctx.fillStyle = '#ffe1a0';
      for (const s of stars) {
        ctx.globalAlpha = 0.2 + 0.6 * Math.max(0, Math.sin(t * s.speed + s.phase));
        ctx.fillRect(s.x, s.y, 1, 1);
      }
      ctx.globalAlpha = 0.6;
      for (const c of clouds) ctx.drawImage(c.img, Math.round(c.x), Math.round(c.y));

      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#8fa3e0';
      for (const d of drops) ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      ctx.globalAlpha = 1;

      // the baked ground strip with all static props
      ctx.drawImage(layer, 0, top);

      // light sources (additive)
      ctx.globalCompositeOperation = 'lighter';
      for (const f of spots.fires) {
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 5.3);
        ctx.drawImage(art.glowFire, f.x + 3 - 34, top + f.y + 6 - 34);
      }
      for (const l of spots.lamps) {
        ctx.globalAlpha = 0.85 + 0.1 * Math.sin(t * 3);
        ctx.drawImage(art.glowWarm, l.x - 20, top + l.y - 20);
      }
      for (const tch of spots.torches) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 11 + 1) * Math.sin(t * 4.1);
        ctx.drawImage(art.glowWarm, tch.x + 1 - 20, top + tch.y + 2 - 20);
      }
      spots.lanterns.forEach((ln, i) => {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 2.2 + i * 1.7);
        ctx.drawImage(art.glowLantern, ln.x - 9, top + ln.y + 2 - 9);
      });
      for (const k of spots.crystals) {
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 1.4);
        ctx.drawImage(art.glowCyan, k.x - 20, top + k.y - 20);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // flames
      for (const f of spots.fires) ctx.drawImage(art.flame[Math.floor(t * 8) % 3], f.x, top + f.y);
      spots.torches.forEach((tch, i) => {
        ctx.drawImage(art.torchFlame[Math.floor(t * 9 + i) % 3], tch.x, top + tch.y);
      });

      // treasure-chest glint: a 4-point twinkle every ~3s
      for (const c of spots.chests) {
        const ph = (t % 3) / 3;
        if (ph < 0.15) {
          const a = Math.sin((ph / 0.15) * Math.PI);
          ctx.globalAlpha = a;
          ctx.fillStyle = '#fff6d0';
          const gx = c.x + 1, gyy = top + c.y + 1;
          ctx.fillRect(gx, gyy, 1, 1);
          if (a > 0.5) {
            ctx.fillRect(gx - 1, gyy, 3, 1);
            ctx.fillRect(gx, gyy - 1, 1, 3);
          }
          ctx.globalAlpha = 1;
        }
      }

      // sparks rising from the campfire
      for (const p of sparks) {
        const k = p.life / p.max;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = k > 0.66 ? '#fff3b0' : k > 0.33 ? '#ffb347' : '#d9442b';
        ctx.fillRect(Math.round(p.x + Math.sin(t * 4 + p.max * 10)), Math.round(p.y), 1, 1);
      }

      // fireflies
      for (const f of flies) {
        ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.3 + f.phase));
        ctx.fillStyle = f.cyan ? '#7fefff' : '#ffcd75';
        ctx.fillRect(Math.round(f.x), Math.round(f.y + Math.sin(t * 0.8 + f.phase) * 4), 1, 1);
      }
      ctx.globalAlpha = 1;
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

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
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
    requestAnimationFrame(() => { canvas.style.opacity = calm ? '0.75' : '1'; });
  }

  const idle = window.requestIdleCallback
    ? cb => requestIdleCallback(cb, { timeout: 1500 })
    : cb => setTimeout(cb, 200);
  if (document.readyState === 'complete') idle(boot);
  else window.addEventListener('load', () => idle(boot));
})();
