/* puzzle.js — 24-solver, puzzle generation, expression evaluation.
   Used by Practice only (Challenge puzzles come from the new-round Edge
   Function). The evaluator below is duplicated in
   supabase/functions/submit-answer — keep the two in sync. */
(function (global) {
  const EPS = 1e-6;
  const TARGET = 24;

  // Every level draws single digits 1–9; levels differ only by the time
  // limit per question (see Scoring24.LEVEL_TIME_SECONDS).
  const DIGIT_MIN = 1;
  const DIGIT_MAX = 9;

  // Guards for the extra operators so an answer can't blow up into
  // huge/NaN values: n! only for whole numbers 0–10, and any
  // intermediate result beyond ±1e9 is rejected.
  const MAX_FACTORIAL = 10;
  const MAX_ABS = 1e9;

  // Exhaustive search over all ways to combine 4 numbers with + - * / and
  // parentheses (implicit via recursive pairwise reduction). Returns every
  // expression string whose value is ~24. Puzzles are only issued if they
  // are solvable with these four basic operators — √ ! ^ are extra ways
  // to reach 24, never required.
  function search(items) {
    if (items.length === 1) {
      return Math.abs(items[0].val - TARGET) < EPS ? [items[0].expr] : [];
    }
    const results = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const a = items[i];
        const b = items[j];
        const rest = items.filter((_, idx) => idx !== i && idx !== j);
        const candidates = [
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

  function solve(numbers) {
    const items = numbers.map(n => ({ val: n, expr: String(n) }));
    const results = search(items);
    return { solvable: results.length > 0, count: results.length, examples: results };
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function drawNumbers() {
    return Array.from({ length: 4 }, () => randomInt(DIGIT_MIN, DIGIT_MAX));
  }

  function generatePuzzle(level) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const numbers = drawNumbers();
      const result = solve(numbers);
      if (result.solvable) {
        return { level, numbers, solutionExample: result.examples[0] };
      }
    }
    // Guaranteed-solvable last resort: (1+2+3)*4 = 24.
    return { level, numbers: [1, 2, 3, 4], solutionExample: '((1+2+3)*4)' };
  }

  // Evaluates a token list built by the game UI:
  //   {type:'num', value:Number}
  //   {type:'op', value:'+'|'-'|'*'|'/'|'^'}   binary operators
  //   {type:'paren', value:'('|')'}
  //   {type:'func', value:'sqrt'}              prefix √
  //   {type:'post', value:'!'}                 postfix factorial
  // Grammar (recursive descent, standard precedence, ^ right-associative):
  //   expr    := term (('+'|'-') term)*
  //   term    := power (('*'|'/') power)*
  //   power   := unary ('^' power)?
  //   unary   := '√' unary | postfix
  //   postfix := primary '!'*
  //   primary := num | '(' expr ')'
  // Throws on anything malformed or not computable (÷0, √ of a negative,
  // n! of a non-whole/negative/too-large n, overflow).
  function evaluateTokens(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('INVALID');
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (t, ...ops) => t && t.type === 'op' && ops.includes(t.value);
    const fail = code => {
      throw new Error(code || 'INVALID');
    };
    const check = v => {
      if (!Number.isFinite(v) || Math.abs(v) > MAX_ABS) fail('OUT_OF_RANGE');
      return v;
    };

    function parseExpr() {
      let v = parseTerm();
      while (isOp(peek(), '+', '-')) {
        const op = tokens[pos++].value;
        const r = parseTerm();
        v = check(op === '+' ? v + r : v - r);
      }
      return v;
    }

    function parseTerm() {
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

    function parsePower() {
      const base = parseUnary();
      if (!isOp(peek(), '^')) return base;
      pos++;
      const exp = parsePower();
      if (Math.abs(base) < EPS && exp < 0) fail('DIV_ZERO');
      return check(Math.pow(base, exp));
    }

    function parseUnary() {
      const t = peek();
      if (t && t.type === 'func' && t.value === 'sqrt') {
        pos++;
        const v = parseUnary();
        if (v < -EPS) fail('SQRT_NEGATIVE');
        return Math.sqrt(Math.max(0, v));
      }
      return parsePostfix();
    }

    function parsePostfix() {
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

    function parsePrimary() {
      const t = tokens[pos++];
      if (t && t.type === 'num' && Number.isInteger(t.value)) return t.value;
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

  function isTwentyFour(value) {
    return Math.abs(value - TARGET) < EPS;
  }

  global.Puzzle24 = { EPS, TARGET, solve, generatePuzzle, evaluateTokens, isTwentyFour };
})(window);
