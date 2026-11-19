// new-round — Supabase Edge Function
// Generates a solvable 24-game puzzle server-side and returns ONLY the 4
// numbers (and the level's time limit) to the caller — never the solution. This is the fix for the
// puzzle solver being shipped to (and callable from) the browser: the
// solving algorithm now only ever runs here, server-side.
//
// Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
// → Via Editor → name it exactly "new-round" → paste this file's content
// → Deploy. Turn OFF "Verify JWT" (this function checks the caller's
// token itself).
//
// Game logic below is intentionally duplicated from submit-answer's copy
// (and from js/puzzle.js on the frontend) rather than imported from a
// shared file, because the Dashboard's browser-based function editor
// deploys one self-contained file at a time.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EPS = 1e-6;
const TARGET = 24;

// Every level draws single digits 1–9; levels differ ONLY by the time
// limit per question. 0 = untimed (level 1). Keep in sync with
// submit-answer and js/scoring.js LEVEL_TIME_SECONDS.
const LEVEL_TIME_SECONDS: Record<number, number> = { 1: 0, 2: 60, 3: 45, 4: 30, 5: 20 };
const TIME_GRACE_MS = 5000; // same allowance as submit-answer
const DIGIT_MIN = 1;
const DIGIT_MAX = 9;

interface Item {
  val: number;
  expr: string;
}

function search(items: Item[]): string[] {
  if (items.length === 1) {
    return Math.abs(items[0].val - TARGET) < EPS ? [items[0].expr] : [];
  }
  const results: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i];
      const b = items[j];
      const rest = items.filter((_, idx) => idx !== i && idx !== j);
      const candidates: Item[] = [
        { val: a.val + b.val, expr: `(${a.expr}+${b.expr})` },
        { val: a.val - b.val, expr: `(${a.expr}-${b.expr})` },
        { val: a.val * b.val, expr: `(${a.expr}*${b.expr})` }
      ];
      if (Math.abs(b.val) > EPS) {
        candidates.push({ val: a.val / b.val, expr: `(${a.expr}/${b.expr})` });
      }
      for (const c of candidates) {
        results.push(...search([c, ...rest]));
      }
    }
  }
  return results;
}

function solvable(numbers: number[]): boolean {
  return search(numbers.map(n => ({ val: n, expr: String(n) }))).length > 0;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function drawNumbers(): number[] {
  return Array.from({ length: 4 }, () => randomInt(DIGIT_MIN, DIGIT_MAX));
}

// Only puzzles solvable with + − × ÷ alone are issued, so there is always
// an answer; √ ! ^ are extra routes to 24, never required.
function generatePuzzle(level: number) {
  const timeSeconds = LEVEL_TIME_SECONDS[level] ?? 0;
  for (let attempt = 0; attempt < 400; attempt++) {
    const numbers = drawNumbers();
    if (solvable(numbers)) return { level, numbers, timeSeconds };
  }
  return { level, numbers: [1, 2, 3, 4], timeSeconds };
}

Deno.serve(async req => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing bearer token' }), { status: 401, headers: cors });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const {
      data: { user },
      error: userErr
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
    }

    const body = await req.json();
    const lvl = Number(body.level);
    const sessionId = body.sessionId;
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) {
      return new Response(JSON.stringify({ error: 'invalid level' }), { status: 400, headers: cors });
    }
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: cors });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: session, error: sessionErr } = await adminClient
      .from('scores')
      .select('id, user_id, level')
      .eq('id', sessionId)
      .single();
    if (sessionErr || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid session' }), { status: 403, headers: cors });
    }
    if (session.level !== lvl) {
      return new Response(JSON.stringify({ error: 'level does not match session' }), { status: 400, headers: cors });
    }

    // Levels are stages: refuse rounds above the level this player has
    // unlocked this season (see the player_levels view in schema.sql).
    // This is the server-side gate — the locked buttons in the UI are
    // just a convenience.
    const { data: progress } = await adminClient
      .from('player_levels')
      .select('player_level')
      .eq('user_id', user.id)
      .maybeSingle();
    const unlockedLevel = progress?.player_level ?? 1;
    if (lvl > unlockedLevel) {
      return new Response(JSON.stringify({ error: 'level locked', unlockedLevel }), { status: 403, headers: cors });
    }

    // Time up = game over on timed levels. If this session's latest round
    // was never solved and its time limit (plus grace) has passed, the
    // session is finished — don't hand out another puzzle for it. (Skips
    // and the 8-wrong-tries cutoff request the next round well within the
    // limit, so they aren't caught by this.)
    const limitMs = (LEVEL_TIME_SECONDS[lvl] ?? 0) * 1000;
    if (limitMs > 0) {
      const { data: lastRound } = await adminClient
        .from('rounds')
        .select('created_at, correct')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRound && lastRound.correct !== true) {
        const ageMs = Date.now() - new Date(lastRound.created_at).getTime();
        if (ageMs > limitMs + TIME_GRACE_MS) {
          return new Response(JSON.stringify({ error: 'session over' }), { status: 403, headers: cors });
        }
      }
    }

    const puzzle = generatePuzzle(lvl);

    const { data: round, error: insertErr } = await adminClient
      .from('rounds')
      .insert({
        user_id: user.id,
        session_id: sessionId,
        level: lvl,
        numbers: puzzle.numbers
      })
      .select('id')
      .single();
    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: cors });
    }

    return new Response(
      JSON.stringify({ roundId: round.id, numbers: puzzle.numbers, timeSeconds: puzzle.timeSeconds }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
