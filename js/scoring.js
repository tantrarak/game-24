/* scoring.js — score, time bonus, streak bonus, best-score persistence */
(function (global) {
  const BASE_SCORE = 100;
  const MAX_TIME_BONUS = 50;
  const STREAK_STEP = 10;
  const STREAK_CAP = 10;

  // Higher difficulty pays out more per correct answer — same effort curve
  // as the puzzle bands in puzzle.js (LEVELS 1-5).
  const LEVEL_MULTIPLIER = { 1: 1, 2: 1.2, 3: 1.5, 4: 2, 5: 3 };

  // Just display names — kept here (not in puzzle.js) so challenge.html
  // can show them without loading puzzle.js at all, which contains the
  // solving algorithm. Keep in sync with puzzle.js's LEVELS names.
  const LEVEL_NAMES = { 1: 'Beginner', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Expert' };

  // Time is the only thing that changes between levels (every level uses
  // digits 1–9). 0 = untimed. Mirrors the new-round / submit-answer Edge
  // Functions, which are the source of truth for Challenge.
  const LEVEL_TIME_SECONDS = { 1: 0, 2: 60, 3: 45, 4: 30, 5: 20 };

  // Levels are stages: points earned AT level n (this season) unlock n+1.
  // Mirrors the player_levels view in supabase/schema.sql.
  const LEVEL_REQ = { 1: 5000, 2: 15000, 3: 30000, 4: 50000 };
  const MAX_LEVEL = 5;

  function levelTimeLabel(level) {
    const s = LEVEL_TIME_SECONDS[level];
    return s ? `${s} วินาที/ข้อ` : 'ไม่จับเวลา';
  }

  // -> { level, points: {1..5} } for the signed-in player; level 1 / zero
  // points when they haven't played yet this season.
  async function fetchPlayerLevel(userId) {
    const empty = { level: 1, points: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    if (!global.SUPABASE_CONFIGURED || typeof sb === 'undefined' || !userId) return empty;
    const { data, error } = await sb.from('player_levels').select('*').eq('user_id', userId).maybeSingle();
    if (error) console.error('[GAME24] fetchPlayerLevel error', error);
    if (!data) return empty;
    return {
      level: data.player_level,
      points: {
        1: Number(data.level1_points),
        2: Number(data.level2_points),
        3: Number(data.level3_points),
        4: Number(data.level4_points),
        5: Number(data.level5_points)
      }
    };
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
