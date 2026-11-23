/* admin.js — admin-only player management: search, ban/unban, permanent
   delete, and CSV export of scores (opens directly in Excel). */
(function (global) {
  const DELETE_FUNCTION = 'admin-delete-user';

  async function guardAdminPage(gateEl, panelEl) {
    if (!global.SUPABASE_CONFIGURED) {
      gateEl.textContent = 'ยังไม่ได้ตั้งค่า Supabase — แก้ไข js/supabaseClient.js ก่อนใช้งานหน้านี้';
      gateEl.classList.remove('hidden');
      return null;
    }

    const user = await Auth24.getCurrentUser();
    if (!user) {
      gateEl.innerHTML = 'กรุณา<a href="login">เข้าสู่ระบบ</a>ด้วยบัญชีผู้ดูแลระบบก่อน';
      gateEl.classList.remove('hidden');
      return null;
    }
    if (!user.profile || !user.profile.is_admin) {
      gateEl.textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าผู้ดูแลระบบ';
      gateEl.classList.remove('hidden');
      return null;
    }

    gateEl.classList.add('hidden');
    panelEl.classList.remove('hidden');
    return user;
  }

  async function loadUsers(searchTerm) {
    let query = sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
    const { data, error } = await query;
    if (error) {
      console.error('[GAME24] loadUsers error', error);
      return [];
    }
    return data;
  }

  function renderUsers(container, rows, handlers, currentUserId) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="admin-empty">ไม่พบผู้เล่น</p>';
      return;
    }

    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = `admin-row${row.is_banned ? ' banned' : ''}`;
      const joined = new Date(row.created_at).toLocaleDateString('th-TH');
      el.innerHTML = `
        <div class="admin-info">
          <div class="admin-name">
            ${UI24.escapeHtml(row.name)}
            ${row.is_admin ? '<span class="tag tag-admin">ADMIN</span>' : ''}
            ${row.is_banned ? '<span class="tag tag-banned">ระงับ</span>' : ''}
          </div>
          <div class="admin-meta">${UI24.escapeHtml(row.classroom) || '-'} · ${UI24.escapeHtml(row.school)} · สมัคร ${joined}</div>
        </div>
        <div class="admin-actions">
          <button class="btn btn-ghost btn-sm" data-action="view">ดูโปรไฟล์</button>
          ${row.id === currentUserId ? '' : `<button class="btn btn-outline btn-sm" data-action="ban">${row.is_banned ? 'เลิกระงับ' : 'ระงับผู้เล่น'}</button>`}
          ${row.is_admin ? '' : '<button class="btn btn-danger btn-sm" data-action="delete">ลบถาวร</button>'}
        </div>
      `;
      const viewBtn = el.querySelector('[data-action="view"]');
      if (viewBtn) viewBtn.addEventListener('click', () => handlers.onView(row));
      const banBtn = el.querySelector('[data-action="ban"]');
      if (banBtn) banBtn.addEventListener('click', () => handlers.onToggleBan(row));
      const delBtn = el.querySelector('[data-action="delete"]');
      if (delBtn) delBtn.addEventListener('click', () => handlers.onDelete(row));
      container.appendChild(el);
    });
  }

  async function getSeasonInfo() {
    const { data, error } = await sb.from('app_settings').select('current_season, season_started_at').eq('id', true).single();
    if (error) {
      console.error('[GAME24] getSeasonInfo error', error);
      return { current_season: 1, season_started_at: null };
    }
    return data;
  }

  async function startNewSeason(currentSeason) {
    const { error } = await sb
      .from('app_settings')
      .update({ current_season: currentSeason + 1, season_started_at: new Date().toISOString() })
      .eq('id', true);
    if (error) console.error('[GAME24] startNewSeason error', error);
    return !error;
  }

  async function updateProfileName(userId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return { ok: false, message: 'ชื่อห้ามเว้นว่าง' };
    const { error } = await sb.from('profiles').update({ name: trimmed }).eq('id', userId);
    if (error) {
      console.error('[GAME24] updateProfileName error', error);
      return { ok: false, message: 'แก้ไขชื่อไม่สำเร็จ' };
    }
    return { ok: true };
  }

  async function toggleBan(userId, currentlyBanned) {
    const { error } = await sb.from('profiles').update({ is_banned: !currentlyBanned }).eq('id', userId);
    if (error) console.error('[GAME24] toggleBan error', error);
    return !error;
  }

  async function deleteUserPermanently(userId) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };

    try {
      const res = await fetch(`${global.SUPABASE_URL}/functions/v1/${DELETE_FUNCTION}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ userId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.error || 'ลบไม่สำเร็จ' };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: 'เรียก Edge Function ไม่สำเร็จ — ตรวจสอบว่า deploy admin-delete-user แล้ว' };
    }
  }

  // ---------- CSV export ----------
  // Supabase returns at most 1,000 rows per request, so page through.
  async function fetchAllRows(makeQuery) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await makeQuery().range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  // Quote every field; prefix values that Excel would treat as a formula
  // (a player's name starting with = + - @) so a name can't run as one.
  function csvField(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, headers, rows) {
    const lines = [headers, ...rows].map(r => r.map(csvField).join(','));
    // BOM so Excel reads the file as UTF-8 and shows Thai correctly
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const thDate = d =>
    d ? new Date(d).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const today = () => new Date().toISOString().slice(0, 10);
  const byClassThenId = (a, b) =>
    (a.classroom || '').localeCompare(b.classroom || '', 'th', { numeric: true }) ||
    (a.student_id || '').localeCompare(b.student_id || '', 'th', { numeric: true }) ||
    (a.name || '').localeCompare(b.name || '', 'th');

  // One row per player for the current season: level, total, points per
  // level, games, answers, accuracy. Includes players who haven't played.
  // Row[0] is always the classroom (used to filter / split by class).
  async function buildSummary(season) {
    const [profiles, scores, levels] = await Promise.all([
      fetchAllRows(() => sb.from('profiles').select('id, name, grade, classroom, student_id, is_banned, is_admin')),
      fetchAllRows(() => sb.from('scores').select('user_id, level, score, correct, wrong, best_streak, created_at').eq('season', season)),
      fetchAllRows(() => sb.from('player_levels').select('*'))
    ]);
    const levelOf = new Map(levels.map(l => [l.user_id, l]));
    const agg = new Map();
    for (const s of scores) {
      const a = agg.get(s.user_id) || { total: 0, games: 0, correct: 0, wrong: 0, streak: 0, last: null, perLevel: {} };
      a.total += s.score;
      a.games += 1;
      a.correct += s.correct;
      a.wrong += s.wrong;
      a.streak = Math.max(a.streak, s.best_streak);
      a.perLevel[s.level] = (a.perLevel[s.level] || 0) + s.score;
      if (!a.last || s.created_at > a.last) a.last = s.created_at;
      agg.set(s.user_id, a);
    }
    const maxLevel = global.Scoring24 ? Scoring24.MAX_LEVEL : 9;
    const levelCols = Array.from({ length: maxLevel }, (_, i) => i + 1);
    const headers = ['ห้อง', 'ระดับชั้น', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'เลเวล', 'คะแนนรวมซีซันนี้',
      ...levelCols.map(n => `คะแนนในเลเวล ${n}`), 'จำนวนเกม', 'ตอบถูก', 'ตอบผิด', 'ความแม่นยำ %', 'สตรีคสูงสุด', 'เล่นล่าสุด', 'หมายเหตุ'];
    const rows = profiles
      .filter(p => !p.is_admin)
      .sort(byClassThenId)
      .map(p => {
        const a = agg.get(p.id) || { total: 0, games: 0, correct: 0, wrong: 0, streak: 0, last: null, perLevel: {} };
        const attempts = a.correct + a.wrong;
        const lv = levelOf.get(p.id);
        return [p.classroom || '', p.grade, p.student_id, p.name, lv ? lv.player_level : 1, a.total,
          ...levelCols.map(n => a.perLevel[n] || 0), a.games, a.correct, a.wrong,
          attempts ? Math.round((a.correct / attempts) * 100) : 0, a.streak, thDate(a.last), p.is_banned ? 'ถูกระงับ' : ''];
      });
    return { headers, rows };
  }

  // classroom '' = every class; filenames can't contain "/" so ม.4/1 -> ม.4_1
  const classTag = classroom => (classroom ? `-${classroom.replace(/[\\/:*?"<>|\[\]]/g, '_')}` : '');

  async function exportSeasonSummary(season, classroom) {
    const { headers, rows } = await buildSummary(season);
    const picked = classroom ? rows.filter(r => r[0] === classroom) : rows;
    downloadCsv(`game24-season${season}-summary${classTag(classroom)}-${today()}.csv`, headers, picked);
    return picked.length;
  }

  // Every Challenge game this season, newest first.
  async function exportSeasonGames(season, classroom) {
    const [profiles, scores] = await Promise.all([
      fetchAllRows(() => sb.from('profiles').select('id, name, classroom, student_id')),
      fetchAllRows(() => sb.from('scores').select('user_id, level, score, correct, wrong, best_streak, duration_ms, created_at')
        .eq('season', season).order('created_at', { ascending: false }))
    ]);
    const who = new Map(profiles.map(p => [p.id, p]));
    const headers = ['วันเวลา', 'ห้อง', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'เลเวล', 'คะแนน', 'ตอบถูก', 'ตอบผิด', 'สตรีคสูงสุด', 'ระยะเวลา (นาที:วินาที)'];
    const rows = scores
      .filter(s => !classroom || (who.get(s.user_id) || {}).classroom === classroom)
      .map(s => {
        const p = who.get(s.user_id) || {};
        const sec = Math.round((s.duration_ms || 0) / 1000);
        return [thDate(s.created_at), p.classroom, p.student_id, p.name, s.level, s.score, s.correct, s.wrong, s.best_streak,
          `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`];
      });
    downloadCsv(`game24-season${season}-games${classTag(classroom)}-${today()}.csv`, headers, rows);
    return rows.length;
  }

  // Classrooms that have at least one (non-admin) player, in school order.
  async function listClassrooms() {
    const profiles = await fetchAllRows(() => sb.from('profiles').select('classroom, is_admin'));
    const set = new Set(profiles.filter(p => !p.is_admin && p.classroom).map(p => p.classroom));
    return [...set].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  }

  // SheetJS (~880 KB) is only fetched when someone actually asks for .xlsx.
  let xlsxLoading = null;
  function loadSheetJs() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        tag.onload = () => resolve(global.XLSX);
        tag.onerror = () => {
          xlsxLoading = null;
          reject(new Error('could not load SheetJS'));
        };
        document.head.appendChild(tag);
      });
    }
    return xlsxLoading;
  }

  // One Excel file, one sheet per classroom (like the registrar's export).
  async function exportSummaryByClassXlsx(season) {
    const [XLSX, { headers, rows }] = await Promise.all([loadSheetJs(), buildSummary(season)]);
    const groups = new Map();
    for (const r of rows) {
      const key = r[0] || 'ไม่ระบุห้อง';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const wb = XLSX.utils.book_new();
    const used = new Set();
    for (const [classroom, classRows] of groups) {
      // sheet names: max 31 chars, no / \ ? * [ ] :
      let name = classroom.replace(/[\\/?*\[\]:]/g, '_').slice(0, 31);
      while (used.has(name)) name = `${name.slice(0, 28)}_${used.size}`;
      used.add(name);
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...classRows]);
      sheet['!cols'] = headers.map((h, i) => ({ wch: i === 3 ? 26 : Math.max(8, Math.min(16, h.length + 2)) }));
      XLSX.utils.book_append_sheet(wb, sheet, name);
    }
    XLSX.writeFile(wb, `game24-season${season}-by-class-${today()}.xlsx`);
    return rows.length;
  }

  global.Admin24 = {
    guardAdminPage,
    loadUsers,
    renderUsers,
    updateProfileName,
    toggleBan,
    deleteUserPermanently,
    getSeasonInfo,
    startNewSeason,
    exportSeasonSummary,
    exportSeasonGames,
    exportSummaryByClassXlsx,
    listClassrooms
  };
})(window);
