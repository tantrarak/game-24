/* scoring.js — score, time bonus, streak bonus, best-score persistence */
(function (global) {
  const BASE_SCORE = 100;
  const MAX_TIME_BONUS = 50;
  const STREAK_STEP = 10;
  const STREAK_CAP = 10;

  // Higher difficulty pays out more per correct answer — same effort curve
  // as the puzzle bands in puzzle.js (LEVELS 1-5).
  const LEVEL_MULTIPLIER = { 1: 1, 2: 1.1, 3: 1.2, 4: 1.4, 5: 1.6, 6: 1.8, 7: 2.2, 8: 2.6, 9: 3 };

  // Just display names — kept here (not in puzzle.js) so challenge.html
  // can show them without loading puzzle.js at all, which contains the
  // solving algorithm. Keep in sync with puzzle.js's LEVELS names.
  const LEVEL_NAMES = { 1: 'Beginner', 2: 'Novice', 3: 'Apprentice', 4: 'Adept', 5: 'Skilled', 6: 'Expert', 7: 'Master', 8: 'Grandmaster', 9: 'Legend' };

  // Time is the only thing that changes between levels (every level uses
  // digits 1–9). 0 = untimed. Mirrors the new-round / submit-answer Edge
  // Functions, which are the source of truth for Challenge.
  const LEVEL_TIME_SECONDS = { 1: 0, 2: 90, 3: 75, 4: 60, 5: 45, 6: 35, 7: 25, 8: 18, 9: 12 };

  // Levels are stages: points earned AT level n (this season) unlock n+1.
  // Mirrors the player_levels view in supabase/schema.sql.
  const LEVEL_REQ = { 1: 5000, 2: 10000, 3: 15000, 4: 20000, 5: 30000, 6: 40000, 7: 50000, 8: 60000 };
  const MAX_LEVEL = 9;

  function levelTimeLabel(level) {
    const s = LEVEL_TIME_SECONDS[level];
    return s ? `${s} วินาที/ข้อ` : 'ไม่จับเวลา';
  }

  // -> { level, points: {1..MAX_LEVEL} } for the signed-in player; level 1
  // / zero points when they haven't played yet this season.
  async function fetchPlayerLevel(userId) {
    const zeros = {};
    for (let n = 1; n <= MAX_LEVEL; n++) zeros[n] = 0;
    const empty = { level: 1, points: zeros };
    if (!global.SUPABASE_CONFIGURED || typeof sb === 'undefined' || !userId) return empty;
    const { data, error } = await sb.from('player_levels').select('*').eq('user_id', userId).maybeSingle();
    if (error) console.error('[GAME24] fetchPlayerLevel error', error);
    if (!data) return empty;
    const points = {};
    for (let n = 1; n <= MAX_LEVEL; n++) points[n] = Number(data[`level${n}_points`] || 0);
    return { level: data.player_level, points };
  }

  // Progress box: current stage, points toward the next unlock, and a bar.
  function renderLevelProgress(container, info) {
    if (!container || !info) return;
    const lv = info.level;
    const have = info.points[lv] || 0;
    if (lv >= MAX_LEVEL) {
      container.innerHTML = `
        <div class="lp-head"><span class="lp-level">LV.${lv}</span><span>ปลดล็อกครบทุกเลเวลแล้ว 👑</span></div>
        <div class="lp-bar"><div class="lp-fill" style="width:100%"></div></div>
        <div class="lp-note">คะแนนในเลเวล ${lv}: ${have.toLocaleString()}</div>`;
      return;
    }
    const need = LEVEL_REQ[lv];
    const pct = Math.min(100, Math.round((have / need) * 100));
    container.innerHTML = `
      <div class="lp-head"><span class="lp-level">LV.${lv}</span><span>${LEVEL_NAMES[lv]} · ${levelTimeLabel(lv)}</span></div>
      <div class="lp-bar"><div class="lp-fill" style="width:${pct}%"></div></div>
      <div class="lp-note">คะแนนในเลเวล ${lv}: <strong>${have.toLocaleString()} / ${need.toLocaleString()}</strong> · อีก ${(need - have).toLocaleString()} คะแนนปลดล็อกเลเวล ${lv + 1}</div>`;
  }

  function calcAnswerScore({ remainingMs, totalMs, streak, level }) {
    const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    const timeBonus = Math.round(MAX_TIME_BONUS * ratio);
    const streakBonus = Math.min(streak, STREAK_CAP) * STREAK_STEP;
    const multiplier = LEVEL_MULTIPLIER[level] || 1;
    const total = Math.round((BASE_SCORE + timeBonus + streakBonus) * multiplier);
    return { base: BASE_SCORE, timeBonus, streakBonus, multiplier, total };
  }

  function bestKey(mode) {
    return `game24_best_${mode}`;
  }

  function getBest(mode) {
    return parseInt(localStorage.getItem(bestKey(mode)) || '0', 10);
  }

  function setBest(mode, value) {
    if (value > getBest(mode)) {
      localStorage.setItem(bestKey(mode), String(value));
      return true;
    }
    return false;
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  global.Scoring24 = {
    BASE_SCORE,
    LEVEL_MULTIPLIER,
    LEVEL_NAMES,
    LEVEL_TIME_SECONDS,
    LEVEL_REQ,
    MAX_LEVEL,
    levelTimeLabel,
    fetchPlayerLevel,
    renderLevelProgress,
    calcAnswerScore,
    getBest,
    setBest,
    formatTime
  };
})(window);
