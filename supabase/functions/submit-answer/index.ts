// submit-answer — Supabase Edge Function
// Verifies a Challenge answer against the round issued by new-round and
// awards score server-side. The client never decides whether an answer
// is correct or how many points it's worth — it just submits the built
// expression and this function is the sole source of truth.
//
// Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
// → Via Editor → name it exactly "submit-answer" → paste this file's
// content → Deploy. Turn OFF "Verify JWT".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EPS = 1e-6;
const TARGET = 24;

// 0 = untimed (level 1, no time bonus). Keep in sync with new-round and
// js/scoring.js LEVEL_TIME_SECONDS.
const LEVEL_TIME_SECONDS: Record<number, number> = { 1: 0, 2: 60, 3: 45, 4: 30, 5: 20 };
const LEVEL_MULTIPLIER: Record<number, number> = { 1: 1, 2: 1.2, 3: 1.5, 4: 2, 5: 3 };
const BASE_SCORE = 100;
const MAX_TIME_BONUS = 50;
const STREAK_STEP = 10;
const STREAK_CAP = 10;
const MAX_WRONG_ATTEMPTS = 8;
const MAX_TOKENS = 40;
const MAX_FACTORIAL = 10;
const MAX_ABS = 1e9;

interface Token {
  type: 'num' | 'op' | 'paren' | 'func' | 'post';
  value: number | string;
}

// Same evaluator as js/puzzle.js (Practice) — keep the two in sync.
//   expr    := term (('+'|'-') term)*
//   term    := power (('*'|'/') power)*
//   power   := unary ('^' power)?          (^ is right-associative)
//   unary   := '√' unary | postfix
//   postfix := primary '!'*
//   primary := num | '(' expr ')'
// Throws on anything malformed or not computable (÷0, √ of a negative,
// n! of a non-whole/negative/>10 n, results beyond ±1e9). The token list
// comes from the client, so every token is validated here.
function evaluateTokens(tokens: Token[]): number {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > MAX_TOKENS) throw new Error('INVALID');
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, ...ops: string[]) => !!t && t.type === 'op' && ops.includes(t.value as string);
  const fail = (code = 'INVALID'): never => {
    throw new Error(code);
  };
  const check = (v: number) => {
    if (!Number.isFinite(v) || Math.abs(v) > MAX_ABS) fail('OUT_OF_RANGE');
    return v;
  };

  function parseExpr(): number {
    let v = parseTerm();
    while (isOp(peek(), '+', '-')) {
      const op = tokens[pos++].value;
      const r = parseTerm();
      v = check(op === '+' ? v + r : v - r);
    }
    return v;
  }

  function parseTerm(): number {
    let v = parsePower();
    while (isOp(peek(), '*', '/')) {
      const op = tokens[pos++].value;
      const r = parsePower();
      if (op === '/') {
        if (Math.abs(r) < EPS) fail('DIV_ZERO');
        v = check(v / r);
      } else {
        v = check(v * r);
      }
    }
    return v;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (!isOp(peek(), '^')) return base;
    pos++;
    const exp = parsePower();
    if (Math.abs(base) < EPS && exp < 0) fail('DIV_ZERO');
    return check(Math.pow(base, exp));
  }

  function parseUnary(): number {
    const t = peek();
    if (t && t.type === 'func' && t.value === 'sqrt') {
      pos++;
      const v = parseUnary();
      if (v < -EPS) fail('SQRT_NEGATIVE');
      return Math.sqrt(Math.max(0, v));
    }
    return parsePostfix();
  }

  function parsePostfix(): number {
    let v = parsePrimary();
    while (peek() && peek().type === 'post' && peek().value === '!') {
      pos++;
      const n = Math.round(v);
      if (Math.abs(v - n) > EPS || n < 0 || n > MAX_FACTORIAL) fail('FACTORIAL');
      let f = 1;
      for (let i = 2; i <= n; i++) f *= i;
      v = f;
    }
    return v;
  }

  function parsePrimary(): number {
    const t = tokens[pos++];
    if (t && t.type === 'num' && Number.isInteger(t.value)) return t.value as number;
    if (t && t.type === 'paren' && t.value === '(') {
      const v = parseExpr();
      const close = tokens[pos++];
      if (!close || close.type !== 'paren' || close.value !== ')') fail();
      return v;
    }
    return fail();
  }

  const value = parseExpr();
  if (pos !== tokens.length) fail();
  return value;
}

function isTwentyFour(value: number): boolean {
  return Math.abs(value - TARGET) < EPS;
}

function calcAnswerScore(remainingMs: number, totalMs: number, streak: number, level: number) {
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const timeBonus = Math.round(MAX_TIME_BONUS * ratio);
  const streakBonus = Math.min(streak, STREAK_CAP) * STREAK_STEP;
  const multiplier = LEVEL_MULTIPLIER[level] || 1;
  return Math.round((BASE_SCORE + timeBonus + streakBonus) * multiplier);
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
    const roundId = body.roundId;
    const tokens: Token[] = Array.isArray(body.tokens) ? body.tokens : [];
    if (!roundId || !tokens.length) {
      return new Response(JSON.stringify({ error: 'roundId and tokens are required' }), { status: 400, headers: cors });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: round, error: roundErr } = await adminClient
      .from('rounds')
      .select('*')
      .eq('id', roundId)
      .single();
    if (roundErr || !round || round.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid round' }), { status: 403, headers: cors });
    }
    if (round.used) {
      return new Response(JSON.stringify({ error: 'round already answered' }), { status: 400, headers: cors });
    }

    const submittedNums = tokens
      .filter(t => t.type === 'num')
      .map(t => t.value as number)
      .sort((a, b) => a - b);
    const issuedNums = [...(round.numbers as number[])].sort((a, b) => a - b);
    const numbersMatch =
      submittedNums.length === issuedNums.length && submittedNums.every((n, i) => n === issuedNums[i]);

    let result: number | null = null;
    if (numbersMatch) {
      try {
        result = evaluateTokens(tokens);
      } catch {
        result = null;
      }
    }
    const correct = numbersMatch && result !== null && isTwentyFour(result);

    // Only a CORRECT answer consumes the round. A wrong guess does NOT
    // set used=true — the frontend lets a player retry the same question
    // after a wrong answer (timer keeps running), so the round must stay
    // submittable until it's actually solved.
    //
    // The claim itself is atomic (UPDATE ... WHERE used = false): if two
    // requests for the same round race each other, only one can flip
    // used to true and get rows back — the loser sees claimed === null
    // and must not award points, closing a double-submit race that a
    // SELECT-then-UPDATE sequence would be vulnerable to.
    if (correct) {
      const { data: claimed, error: claimErr } = await adminClient
        .from('rounds')
        .update({ used: true, correct: true, answered_at: new Date().toISOString() })
        .eq('id', roundId)
        .eq('used', false)
        .select('id')
        .maybeSingle();
      if (claimErr || !claimed) {
        return new Response(JSON.stringify({ error: 'round already answered' }), { status: 400, headers: cors });
      }
    }

    const { data: session, error: sessionErr } = await adminClient
      .from('scores')
      .select('*')
      .eq('id', round.session_id)
      .single();
    if (sessionErr || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid session' }), { status: 403, headers: cors });
    }

    const durationMs = Date.now() - new Date(session.created_at).getTime();

    if (!correct) {
      // Wrong guesses don't consume the round (a genuine player can keep
      // retrying) — but with no cap, a script could brute-force every
      // possible expression from the 4 visible numbers by hammering this
      // endpoint until one happens to be correct, using the server as a
      // free solver. A real player essentially never needs more than a
      // handful of wrong tries on one puzzle, so capping it forces the
      // round to end (and the player to move on) long before brute force
      // could explore a meaningful fraction of the search space.
      const newWrongAttempts = (round.wrong_attempts || 0) + 1;
      const roundOver = newWrongAttempts >= MAX_WRONG_ATTEMPTS;

      await adminClient
        .from('rounds')
        .update(
          roundOver
            ? { wrong_attempts: newWrongAttempts, used: true, correct: false, answered_at: new Date().toISOString() }
            : { wrong_attempts: newWrongAttempts }
        )
        .eq('id', roundId);

      await adminClient
        .from('scores')
        .update({ wrong: session.wrong + 1, current_streak: 0, duration_ms: durationMs })
        .eq('id', session.id);

      // value = what the submitted expression actually came to (null if it
      // couldn't be computed, e.g. ÷0) so the player can see how far off
      // they were. Safe to reveal: it's just their own expression's value.
      return new Response(JSON.stringify({ correct: false, roundOver, value: result }), { status: 200, headers: cors });
    }

    const totalMs = (LEVEL_TIME_SECONDS[round.level] ?? 0) * 1000;
    const elapsedMs = Date.now() - new Date(round.created_at).getTime();
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const newStreak = session.current_streak + 1;
    const gained = calcAnswerScore(remainingMs, totalMs, newStreak, round.level);

    const newScore = session.score + gained;
    const newBestStreak = Math.max(session.best_streak, newStreak);

    await adminClient
      .from('scores')
      .update({
        score: newScore,
        correct: session.correct + 1,
        current_streak: newStreak,
        best_streak: newBestStreak,
        duration_ms: durationMs
      })
      .eq('id', session.id);

    // Report the player's unlocked level after this answer so the client
    // can celebrate the moment a new stage opens up.
    const { data: progress } = await adminClient
      .from('player_levels')
      .select('player_level')
      .eq('user_id', user.id)
      .maybeSingle();
    const unlockedLevel = progress?.player_level ?? 1;

    return new Response(JSON.stringify({ correct: true, gained, newScore, newStreak, unlockedLevel, value: result }), {
      status: 200,
      headers: cors
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
