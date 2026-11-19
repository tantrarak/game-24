/* leaderboard.js — public ranking page.
   Reads public.leaderboard_view (season total + unlocked level per
   non-banned player) when Supabase is configured; falls back to mock data
   otherwise so the page still works before setup is finished.
   Ranking: higher level first, then higher total score. */
(function (global) {
  const SCHOOL_NAME = 'TANTRARAK SCHOOL';

  const MOCK_DATA = [
    { name: 'Player A', grade: 'ม.6', classroom: 'ม.6/1', score: 12450, level: 5 },
    { name: 'Player B', grade: 'ม.5', classroom: 'ม.5/2', score: 11980, level: 4 },
    { name: 'Player C', grade: 'ม.6', classroom: 'ม.6/3', score: 11320, level: 4 },
    { name: 'Player D', grade: 'ม.4', classroom: 'ม.4/1', score: 10870, level: 3 },
    { name: 'Player E', grade: 'ม.3', classroom: 'ม.3/1', score: 9850, level: 3 },
    { name: 'Player F', grade: 'ม.3', classroom: 'ม.3/2', score: 9420, level: 3 },
    { name: 'Player G', grade: 'ม.5', classroom: 'ม.5/1', score: 9250, level: 3 },
    { name: 'Player H', grade: 'ม.2', classroom: 'ม.2/1', score: 9180, level: 2 },
    { name: 'Player I', grade: 'ม.4', classroom: 'ม.4/2', score: 8890, level: 2 },
    { name: 'Player J', grade: 'ม.1', classroom: 'ม.1/3', score: 8760, level: 2 },
    { name: 'Player K', grade: 'ม.3', classroom: 'ม.3/1', score: 8420, level: 2 },
    { name: 'Player L', grade: 'ม.6', classroom: 'ม.6/2', score: 8150, level: 2 },
    { name: 'Player M', grade: 'ม.2', classroom: 'ม.2/4', score: 8005, level: 1 },
    { name: 'Player N', grade: 'ม.1', classroom: 'ม.1/1', score: 7650, level: 1 },
    { name: 'Player O', grade: 'ม.4', classroom: 'ม.4/3', score: 7480, level: 1 },
    { name: 'Player P', grade: 'ม.2', classroom: 'ม.2/2', score: 7300, level: 1 },
    { name: 'Player Q', grade: 'ม.5', classroom: 'ม.5/3', score: 7120, level: 1 },
    { name: 'Player R', grade: 'ม.3', classroom: 'ม.3/3', score: 6980, level: 1 },
    { name: 'Player S', grade: 'ม.1', classroom: 'ม.1/2', score: 6540, level: 1 },
    { name: 'Player T', grade: 'ม.6', classroom: 'ม.6/4', score: 6210, level: 1 }
  ].map(row => ({ ...row, school: SCHOOL_NAME }));

  async function fetchLeaderboard({ grade = 'all', classroom = '' } = {}) {
    if (!global.SUPABASE_CONFIGURED) {
      let rows = [...MOCK_DATA];
      if (grade !== 'all') rows = rows.filter(r => r.grade === grade);
      if (classroom) rows = rows.filter(r => r.classroom.toLowerCase().includes(classroom.toLowerCase()));
      return rows.sort((a, b) => b.level - a.level || b.score - a.score);
    }

    let query = sb
      .from('leaderboard_view')
      .select('*')
      .order('player_level', { ascending: false })
      .order('total_score', { ascending: false })
      .order('first_played_at', { ascending: true }) // ties: whoever started accumulating first ranks higher
      .limit(50);
    if (grade !== 'all') query = query.eq('grade', grade);
    if (classroom) query = query.ilike('classroom', `%${classroom}%`);
    const { data, error } = await query;
    if (error) {
      console.error('[GAME24] fetchLeaderboard error', error);
      return [];
    }
    return data.map(row => ({
      name: row.name,
      grade: row.grade,
      classroom: row.classroom,
      school: row.school,
      score: row.total_score,
      level: row.player_level || 1
    }));
  }

  const prefersReducedMotion = () =>
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateCount(el, target, duration = 700) {
    if (prefersReducedMotion() || target === 0) {
      el.textContent = target.toLocaleString();
      return;
    }
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(target * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function renderLeaderboard(container, rows) {
    const isFirstRender = container.children.length === 0;
    if (!isFirstRender) container.classList.add('leaderboard-fading');

    setTimeout(() => {
      container.innerHTML = '';
      container.classList.remove('leaderboard-fading');

      if (!rows.length) {
        container.innerHTML = '<p class="leaderboard-note">ยังไม่มีข้อมูลผู้เล่นในระดับชั้นนี้</p>';
        return;
      }

      rows.forEach((row, idx) => {
        const rank = idx + 1;
        const el = document.createElement('div');
        el.className = `rank-row rank-enter${rank <= 3 ? ` top-${rank}` : ''}`;
        el.style.animationDelay = `${Math.min(idx, 12) * 45}ms`;
        el.innerHTML = `
          <div class="rank">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
          <div>
            <div class="rank-name"><span class="rank-level">LV.${Number(row.level) || 1}</span>${UI24.escapeHtml(row.name)}</div>
            <div class="rank-class">${UI24.escapeHtml(row.classroom)} · ${UI24.escapeHtml(row.school)}</div>
          </div>
          <div class="rank-score">0</div>
        `;
        container.appendChild(el);
        animateCount(el.querySelector('.rank-score'), row.score);
      });
    }, isFirstRender ? 0 : 120);
  }

  global.Leaderboard24 = { SCHOOL_NAME, fetchLeaderboard, renderLeaderboard };
})(window);
