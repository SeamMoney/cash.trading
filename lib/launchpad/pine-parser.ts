/**
 * PineScript v5 Parser — Tokenizer + Recursive Descent Parser
 *
 * Produces a rich AST used by the Move transpiler and the backtest engine.
 *
 * Supported subset:
 *   - Variable assignments:    fast = ta.sma(close, 14)
 *   - Destructuring:           [macd, sig, hist] = ta.macd(close, 12, 26, 9)
 *   - Input params:            fast_len = input.int(12, "Fast Length", minval=1)
 *   - Conditions (complex):    ta.crossover(a, b) and rsi < 70
 *   - Strategy calls:          strategy.entry("Long", strategy.long, when=cond)
 *   - Historical access:       close[1], rsi[2]
 *   - Arithmetic / comparison / ternary operators
 *   - if / else blocks
 */

// ─── Token Types ────────────────────────────────────────────────────────────

export type TT =
  | "NUM" | "STR" | "BOOL" | "NA" | "ID"
  | "PLUS" | "MINUS" | "STAR" | "SLASH" | "PCT" | "POW"
  | "EQ" | "NEQ" | "LT" | "GT" | "LTE" | "GTE"
  | "AND" | "OR" | "NOT"
  | "ASSIGN" | "REASSIGN"
  | "LPAREN" | "RPAREN" | "LBRACKET" | "RBRACKET"
  | "COMMA" | "DOT" | "COLON" | "QUESTION"
  | "FOR" | "WHILE" | "TO" | "ARROW"
  | "NEWLINE" | "EOF";

export interface Token { type: TT; val: string; line: number }

// ─── Lexer ───────────────────────────────────────────────────────────────────

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0, line = 1;
  const peek = (n = 0) => src[i + n] ?? "";
  const adv = () => { const c = src[i++]; if (c === "\n") line++; return c; };
  const emit = (type: TT, val: string) => toks.push({ type, val, line });

  while (i < src.length) {
    const c = peek();

    if (c === " " || c === "\t" || c === "\r") { adv(); continue; }

    // Line comments
    if (c === "/" && peek(1) === "/") {
      while (i < src.length && peek() !== "\n") adv();
      continue;
    }

    // Block comments
    if (c === "/" && peek(1) === "*") {
      adv(); adv();
      while (i < src.length && !(peek() === "*" && peek(1) === "/")) adv();
      if (i < src.length) { adv(); adv(); }
      continue;
    }

    if (c === "\n") { adv(); emit("NEWLINE", "\n"); continue; }

    // Numbers
    if (/\d/.test(c) || (c === "." && /\d/.test(peek(1)))) {
      let num = "";
      while (/[\d._]/.test(peek())) { const ch = adv(); if (ch !== "_") num += ch; }
      if ((peek() === "e" || peek() === "E")) {
        num += adv();
        if (peek() === "+" || peek() === "-") num += adv();
        while (/\d/.test(peek())) num += adv();
      }
      emit("NUM", num);
      continue;
    }

    // Strings
    if (c === '"' || c === "'") {
      const q = adv();
      let s = "";
      while (i < src.length && peek() !== q && peek() !== "\n") {
        const ch = adv();
        s += ch === "\\" ? adv() : ch;
      }
      if (peek() === q) adv();
      emit("STR", s);
      continue;
    }

    // Identifiers, keywords, and operators
    if (/[a-zA-Z_]/.test(c)) {
      let id = "";
      while (i < src.length && /[\w]/.test(peek())) id += adv();
      if      (id === "true" || id === "false") emit("BOOL", id);
      else if (id === "na")                     emit("NA",   "na");
      else if (id === "and")                    emit("AND",  "and");
      else if (id === "or")                     emit("OR",   "or");
      else if (id === "not")                    emit("NOT",  "not");
      else if (id === "for")                    emit("FOR",  "for");
      else if (id === "while")                  emit("WHILE","while");
      else if (id === "to")                     emit("TO",   "to");
      else                                      emit("ID",   id);
      continue;
    }

    // Multi-char operators (must check before single-char)
    if (c === ":" && peek(1) === "=") { adv(); adv(); emit("REASSIGN", ":="); continue; }
    if (c === "=" && peek(1) === ">") { adv(); adv(); emit("ARROW",    "=>"); continue; }
    if (c === "=" && peek(1) === "=") { adv(); adv(); emit("EQ",       "=="); continue; }
    if (c === "!" && peek(1) === "=") { adv(); adv(); emit("NEQ",      "!="); continue; }
    if (c === "<" && peek(1) === "=") { adv(); adv(); emit("LTE",      "<="); continue; }
    if (c === ">" && peek(1) === "=") { adv(); adv(); emit("GTE",      ">="); continue; }

    const single: Partial<Record<string, TT>> = {
      "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH", "%": "PCT", "^": "POW",
      "<": "LT", ">": "GT", "=": "ASSIGN",
      "(": "LPAREN", ")": "RPAREN", "[": "LBRACKET", "]": "RBRACKET",
      ",": "COMMA", ".": "DOT", ":": "COLON", "?": "QUESTION",
    };
    if (single[c]) { emit(single[c]!, c); adv(); continue; }

    adv(); // skip unknown characters
  }

  emit("EOF", "");
  return toks;
}

// ─── AST Types ───────────────────────────────────────────────────────────────

export type Expr =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "str"; v: string }
  | { k: "na" }
  | { k: "id"; name: string }
  | { k: "hist"; name: string; offset: number }                              // close[1]
  | { k: "call"; ns?: string; fn: string; args: Expr[]; kw: Record<string, Expr> }
  | { k: "binop"; op: string; l: Expr; r: Expr }
  | { k: "unop"; op: string; e: Expr }
  | { k: "ternary"; cond: Expr; yes: Expr; no: Expr };

export type Stmt =
  | { k: "assign"; targets: string[]; value: Expr; reDecl: boolean }        // a = expr or [a,b] = expr
  | { k: "if"; cond: Expr; then: Stmt[]; els?: Stmt[] }
  | { k: "for"; varName: string; start: Expr; end: Expr; step?: Expr; body: Stmt[] }
  | { k: "while"; cond: Expr; body: Stmt[] }
  | { k: "funcdef"; name: string; params: string[]; body: Stmt[] }
  | { k: "visual"; fn: string; args: Expr[]; kw: Record<string, Expr> }
  | { k: "expr"; e: Expr };

// ─── Parsed Output ───────────────────────────────────────────────────────────

export interface InputDef {
  type: "int" | "float" | "bool" | "string" | "source";
  default: number | boolean | string;
  title: string;
  minval?: number;
  maxval?: number;
}

export interface TACallInfo {
  fn: string;         // "sma", "ema", "rsi", "macd", "bb", "stoch", "atr", "cci", etc.
  source: string;     // "close", "open", "high", "low", "hl2", "hlc3"
  periods: number[];  // all numeric arguments after source
  rawArgs: Expr[];
  targets: string[];  // variable name(s) it was assigned to
}

export interface ParsedPine {
  inputs: Record<string, InputDef>;
  taCalls: TACallInfo[];
  assignments: Record<string, Expr>;    // all non-input assignments
  statements: Stmt[];
  strategyEntries: Array<{              // strategy.entry() calls
    id: string;
    direction: "long" | "short" | "both";
    whenExpr?: Expr;
    condLine: string;                   // raw string condition for display
  }>;
  strategyCloses: Array<{ id?: string; whenExpr?: Expr }>;
  buyExpr?: Expr;
  sellExpr?: Expr;
  params: Record<string, number>;       // all numeric input defaults by varname
  /** HARD errors from malformed TA-call arguments (missing/extra/non-numeric
   *  periods). These must reject the transpile — silently substituting a
   *  default would deploy a different strategy than the user wrote. */
  argErrors: string[];
  varDeclarations?: Map<string, { initExpr: Expr; isVarip: boolean }>;
  visualCalls?: string[];
  alertConditions?: Array<{ condition: Expr; title: string; message: string }>;
  // Pattern detection result
  detectedPattern:
    | "sma_cross" | "ema_cross" | "rsi" | "macd" | "bb"
    | "stoch" | "supertrend" | "donchian" | "cci" | "williams" | "atr_band" | "custom" | "unknown";
  moveConfig: {
    indicatorType: number;   // 0=SMA, 1=EMA, 2=RSI, 3=MACD, 4=BB, 5=Stoch, 6=SuperTrend, 7=Donchian
    shortPeriod: number;
    longPeriod: number;
    thirdPeriod: number;     // signal line / d period
    description: string;
  };
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parsePine(src: string): ParsedPine {
  // Collapse sequences of newlines to single newlines
  const toks: Token[] = [];
  let prevNewline = false;
  for (const t of tokenize(src)) {
    if (t.type === "NEWLINE") {
      if (!prevNewline) toks.push(t);
      prevNewline = true;
    } else {
      prevNewline = false;
      toks.push(t);
    }
  }

  let pos = 0;
  const at  = (n = 0): Token => toks[Math.min(pos + n, toks.length - 1)];
  const adv = (): Token => toks[pos < toks.length ? pos++ : pos];
  const is  = (type: TT, val?: string) => at().type === type && (val === undefined || at().val === val);
  const isId = (name: string) => is("ID", name);
  const eat = (type: TT): Token => {
    if (!is(type)) throw new Error(`Expected ${type}, got ${at().type}('${at().val}') at line ${at().line}`);
    return adv();
  };
  const skip = () => { while (is("NEWLINE")) adv(); };

  const result: ParsedPine = {
    inputs: {}, taCalls: [], assignments: {}, statements: [],
    strategyEntries: [], strategyCloses: [],
    params: {},
    argErrors: [],
    varDeclarations: new Map(),
    visualCalls: [],
    alertConditions: [],
    detectedPattern: "unknown",
    moveConfig: { indicatorType: 0, shortPeriod: 10, longPeriod: 30, thirdPeriod: 9, description: "SMA Crossover" },
  };

  // ── Expression Parsing ─────────────────────────────────────────────────────

  function parseExpr(): Expr { return parseTernary(); }

  function parseTernary(): Expr {
    const e = parseOr();
    if (is("QUESTION")) {
      adv();
      const yes = parseExpr();
      eat("COLON");
      const no = parseExpr();
      return { k: "ternary", cond: e, yes, no };
    }
    return e;
  }

  function parseOr(): Expr {
    let l = parseAnd();
    while (is("OR")) { adv(); l = { k: "binop", op: "or", l, r: parseAnd() }; }
    return l;
  }

  function parseAnd(): Expr {
    let l = parseNot();
    while (is("AND")) { adv(); l = { k: "binop", op: "and", l, r: parseNot() }; }
    return l;
  }

  function parseNot(): Expr {
    if (is("NOT")) { adv(); return { k: "unop", op: "not", e: parseNot() }; }
    return parseComparison();
  }

  function parseComparison(): Expr {
    let l = parseAddSub();
    const ops: TT[] = ["EQ", "NEQ", "LT", "GT", "LTE", "GTE"];
    while (ops.includes(at().type)) {
      const op = adv().val;
      l = { k: "binop", op, l, r: parseAddSub() };
    }
    return l;
  }

  function parseAddSub(): Expr {
    let l = parseMulDiv();
    while (is("PLUS") || is("MINUS")) {
      const op = adv().val;
      l = { k: "binop", op, l, r: parseMulDiv() };
    }
    return l;
  }

  function parseMulDiv(): Expr {
    let l = parseUnary();
    while (is("STAR") || is("SLASH") || is("PCT")) {
      const op = adv().val;
      l = { k: "binop", op, l, r: parseUnary() };
    }
    return l;
  }

  function parseUnary(): Expr {
    if (is("MINUS")) { adv(); return { k: "unop", op: "-", e: parsePow() }; }
    if (is("PLUS"))  { adv(); return parsePow(); }
    return parsePow();
  }

  function parsePow(): Expr {
    let l = parsePostfix();
    if (is("POW")) { adv(); l = { k: "binop", op: "^", l, r: parseUnary() }; }
    return l;
  }

  function parsePostfix(): Expr {
    let e = parsePrimary();

    // Historical access: expr[N]
    while (is("LBRACKET")) {
      adv();
      const idx = parseExpr();
      eat("RBRACKET");
      if (e.k === "id" && idx.k === "num") {
        e = { k: "hist", name: e.name, offset: idx.v };
      } else {
        e = { k: "binop", op: "index", l: e, r: idx };
      }
    }

    return e;
  }

  function parsePrimary(): Expr {
    const t = at();

    if (t.type === "NUM")  { adv(); return { k: "num", v: parseFloat(t.val) }; }
    if (t.type === "BOOL") { adv(); return { k: "bool", v: t.val === "true" }; }
    if (t.type === "STR")  { adv(); return { k: "str", v: t.val }; }
    if (t.type === "NA") {
      adv();
      // Pine uses both `na` as a literal and `na(expr)` as a built-in test.
      // Keep the literal form, but parse the call form so the Move compiler can
      // lower it explicitly instead of losing the trailing expression.
      if (is("LPAREN")) {
        adv();
        const args: Expr[] = [];
        const kw: Record<string, Expr> = {};

        while (!is("RPAREN") && !is("EOF") && !is("NEWLINE")) {
          if (at().type === "ID" && at(1).type === "ASSIGN") {
            const key = adv().val;
            adv();
            kw[key] = parseExpr();
          } else {
            args.push(parseExpr());
          }
          if (is("COMMA")) adv();
        }
        if (is("RPAREN")) adv();

        return { k: "call", fn: "na", args, kw };
      }
      return { k: "na" };
    }

    if (t.type === "LPAREN") {
      adv();
      const e = parseExpr();
      eat("RPAREN");
      return e;
    }

    if (t.type === "ID") {
      adv();
      let name = t.val;
      let ns: string | undefined;

      // Namespace chain: ta.sma, strategy.entry, math.abs, input.int
      if (is("DOT")) {
        adv();
        if (!is("ID")) return { k: "id", name };
        ns = name;
        name = adv().val;
        // Extra chain: strategy.long → keep as ns.name
        if (is("DOT")) {
          adv();
          const sub = at().type === "ID" ? adv().val : "";
          // Treat "ta.bb.upper" or similar as a single identifier
          name = name + "." + sub;
        }
      }

      // Function call
      if (is("LPAREN")) {
        adv();
        const args: Expr[] = [];
        const kw: Record<string, Expr> = {};

        while (!is("RPAREN") && !is("EOF") && !is("NEWLINE")) {
          // Check for keyword argument: ident=value
          if (at().type === "ID" && at(1).type === "ASSIGN") {
            const key = adv().val;
            adv(); // consume =
            kw[key] = parseExpr();
          } else {
            args.push(parseExpr());
          }
          if (is("COMMA")) adv();
        }
        if (is("RPAREN")) adv();

        return { k: "call", ns, fn: name, args, kw };
      }

      // Namespace reference without call (e.g., strategy.long)
      if (ns) return { k: "call", ns, fn: name, args: [], kw: {} };

      return { k: "id", name };
    }

    // Skip unknown token
    adv();
    return { k: "na" };
  }

  // ── Statement Parsing ──────────────────────────────────────────────────────

  function parseBlock(): Stmt[] {
    const stmts: Stmt[] = [];
    // Indented block until dedent (simplified: collect until we see un-indented content)
    // For our purposes, we'll collect statements while indented (4 spaces or 1 tab)
    while (!is("EOF")) {
      skip();
      if (is("EOF")) break;
      // Simple heuristic: if we see another statement at this level, stop
      const stmt = tryParseStatement();
      if (!stmt) break;
      stmts.push(stmt);
    }
    return stmts;
  }

  function tryParseStatement(): Stmt | null {
    skip();
    if (is("EOF")) return null;

    try {
      return parseStatement();
    } catch {
      // Skip to next newline on error
      while (!is("NEWLINE") && !is("EOF")) adv();
      return null;
    }
  }

  // Visual function names that produce plot output (not executable logic)
  const VISUAL_FNS = new Set([
    "plot", "plotshape", "plotchar", "plotarrow", "fill",
    "bgcolor", "barcolor", "hline",
  ]);
  // Compound visual function names (namespace.method style)
  const VISUAL_NS_FNS = new Set([
    "label.new", "line.new", "box.new", "table.new",
  ]);

  function parseStatement(): Stmt {
    skip();

    // Destructuring assignment: [a, b, c] = expr
    if (is("LBRACKET")) {
      adv();
      const targets: string[] = [];
      while (!is("RBRACKET") && !is("EOF")) {
        if (is("ID")) targets.push(adv().val);
        if (is("COMMA")) adv();
      }
      if (is("RBRACKET")) adv();
      eat("ASSIGN");
      const value = parseExpr();
      const stmt: Stmt = { k: "assign", targets, value, reDecl: true };
      // Extract TA call info from destructured assignments
      extractTAFromAssign(targets, value);
      return stmt;
    }

    // var/varip declarations — track them
    let reDecl = false;
    let isVarip = false;
    if (isId("var") || isId("varip")) {
      isVarip = at().val === "varip";
      adv();
      reDecl = true;
    }
    // Type annotations: int x = ..., float x = ...
    if ((isId("int") || isId("float") || isId("bool") || isId("string") || isId("color")) && at(1).type === "ID") {
      adv(); // skip type annotation
    }

    // for loop: for i = start to end [by step]
    if (is("FOR")) {
      adv();
      const varName = eat("ID").val;
      eat("ASSIGN");
      const start = parseExpr();
      eat("TO");
      const end = parseExpr();
      let step: Expr | undefined;
      if (isId("by")) {
        adv(); // consume "by"
        step = parseExpr();
      }
      skip();
      const body = parseIndentedBlock();
      const stmt: Stmt = { k: "for", varName, start, end, step, body };
      result.statements.push(stmt);
      return stmt;
    }

    // while loop: while condition
    if (is("WHILE")) {
      adv();
      const cond = parseExpr();
      skip();
      const body = parseIndentedBlock();
      const stmt: Stmt = { k: "while", cond, body };
      result.statements.push(stmt);
      return stmt;
    }

    // if statement
    if (isId("if")) {
      adv();
      const cond = parseExpr();
      skip();
      // Collect then-block (indented lines)
      const then = parseIndentedBlock();
      skip();
      let els: Stmt[] | undefined;
      if (isId("else")) {
        adv();
        skip();
        els = parseIndentedBlock();
      }
      const stmt: Stmt = { k: "if", cond, then, els };
      result.statements.push(stmt);
      // Extract strategy calls from if blocks
      analyzeIfBlock(cond, then, els);
      return stmt;
    }

    // Assignment, function def, or expression statement
    if (at().type === "ID") {
      const name = adv().val;

      // Function definition: myFunc(a, b) =>
      if (is("LPAREN") && !reDecl) {
        // Peek ahead to see if this is funcName(params) =>
        const savedPos = pos;
        adv(); // consume (
        const params: string[] = [];
        let isFuncDef = false;
        while (at().type === "ID" || is("COMMA")) {
          if (at().type === "ID") params.push(adv().val);
          if (is("COMMA")) adv();
        }
        if (is("RPAREN")) {
          adv();
          if (is("ARROW")) {
            adv(); // consume =>
            isFuncDef = true;
          }
        }
        if (isFuncDef) {
          skip();
          const body = parseIndentedBlock();
          const stmt: Stmt = { k: "funcdef", name, params, body };
          result.statements.push(stmt);
          return stmt;
        }
        // Not a function definition — backtrack and parse as call expression
        pos = savedPos;
      }

      // Visual function calls: plot(...), plotshape(...), etc.
      if (VISUAL_FNS.has(name) && is("LPAREN")) {
        pos--; // backtrack to re-parse as expression
        const e = parseExpr();
        const args = e.k === "call" ? e.args : [];
        const kw = e.k === "call" ? (e.kw ?? {}) : {};
        const stmt: Stmt = { k: "visual", fn: name, args, kw };
        result.statements.push(stmt);
        result.visualCalls!.push(name);
        return stmt;
      }

      // alertcondition() call
      if (name === "alertcondition" && is("LPAREN")) {
        pos--; // backtrack
        const e = parseExpr();
        if (e.k === "call") {
          const condition = e.args[0] ?? { k: "na" as const };
          const titleExpr = e.kw["title"] ?? e.args[1];
          const msgExpr = e.kw["message"] ?? e.args[2];
          const title = titleExpr?.k === "str" ? titleExpr.v : "Alert";
          const message = msgExpr?.k === "str" ? msgExpr.v : "";
          result.alertConditions!.push({ condition, title, message });
        }
        const stmt: Stmt = { k: "expr", e };
        result.statements.push(stmt);
        return stmt;
      }

      if (is("ASSIGN") || is("REASSIGN")) {
        adv();
        const value = parseExpr();
        const stmt: Stmt = { k: "assign", targets: [name], value, reDecl };
        result.statements.push(stmt);
        result.assignments[name] = value;
        // Track var/varip declarations
        if (reDecl) {
          result.varDeclarations!.set(name, { initExpr: value, isVarip });
        }
        extractFromAssignment(name, value);
        return stmt;
      }

      // Namespace call: ta.sma(...), strategy.entry(...)
      // Also check for visual namespace calls: label.new(...), line.new(...), etc.
      let ns: string | undefined;
      let fn = name;
      if (is("DOT")) {
        adv();
        ns = name;
        fn = at().type === "ID" ? adv().val : "";
      }

      // Check for namespace visual functions (label.new, line.new, box.new, table.new)
      if (ns && VISUAL_NS_FNS.has(`${ns}.${fn}`) && is("LPAREN")) {
        const fullName = `${ns}.${fn}`;
        pos -= 2; // backtrack to ns
        const e = parseExpr();
        const args = e.k === "call" ? e.args : [];
        const kw = e.k === "call" ? (e.kw ?? {}) : {};
        const stmt: Stmt = { k: "visual", fn: fullName, args, kw };
        result.statements.push(stmt);
        result.visualCalls!.push(fullName);
        return stmt;
      }

      if (is("LPAREN")) {
        // Re-parse as expression
        pos -= (ns ? 2 : 1); // backtrack
        const e = parseExpr();
        const stmt: Stmt = { k: "expr", e };
        result.statements.push(stmt);
        processTopLevelCall(e);
        return stmt;
      }

      // Bare identifier — not really a statement, skip
      return { k: "expr", e: { k: "id", name } };
    }

    // Expression statement (e.g., strategy.entry on its own line)
    const e = parseExpr();
    const stmt: Stmt = { k: "expr", e };
    result.statements.push(stmt);
    processTopLevelCall(e);
    return stmt;
  }

  // Parse 1 or more indented statements (simple: just parse next few non-empty statements)
  function parseIndentedBlock(): Stmt[] {
    const stmts: Stmt[] = [];
    skip();
    // Collect statements until we see something that looks like a top-level line
    const startPos = pos;
    let attempts = 0;
    while (!is("EOF") && attempts < 20) {
      attempts++;
      skip();
      if (is("EOF")) break;
      // Stop if we hit a top-level keyword
      if (isId("if") || isId("else") || is("FOR") || is("WHILE")) {
        // Check if this is at the same or higher indentation level
        // Simplified: we just collect one statement
        if (stmts.length > 0) break;
      }
      try {
        const stmt = parseStatement();
        stmts.push(stmt);
      } catch {
        while (!is("NEWLINE") && !is("EOF")) adv();
      }
      skip();
      // Stop after first statement (PineScript uses indentation we can't fully track)
      if (stmts.length > 0) break;
    }
    if (stmts.length === 0) pos = startPos; // backtrack if nothing parsed
    return stmts;
  }

  // ── Extraction Helpers ─────────────────────────────────────────────────────

  function extractFromAssignment(name: string, value: Expr) {
    if (value.k !== "call") return;
    const { ns, fn, args, kw } = value;

    // input.int / input.float / input() / input.bool / input.source
    if (ns === "input" || (fn === "input" && !ns)) {
      const inType = fn === "int" || fn === "input" ? "int"
                   : fn === "float"  ? "float"
                   : fn === "bool"   ? "bool"
                   : fn === "string" ? "string"
                   : fn === "source" ? "source" : "float";
      const defVal = kw["defval"] ?? args[0] ?? { k: "num", v: 0 };
      const titleExpr = kw["title"] ?? args[1] ?? { k: "str", v: name };
      const defNum = defVal.k === "num" ? defVal.v : defVal.k === "bool" ? (defVal.v ? 1 : 0) : 0;
      const title = titleExpr.k === "str" ? titleExpr.v : name;
      const minExpr = kw["minval"] ?? args[2];
      const maxExpr = kw["maxval"];

      result.inputs[name] = {
        type: inType as InputDef["type"],
        default: defNum,
        title,
        minval: minExpr?.k === "num" ? minExpr.v : undefined,
        maxval: maxExpr?.k === "num" ? maxExpr.v : undefined,
      };
      result.params[name] = defNum;
      return;
    }

    // TA function calls (namespace ta.* or bare known TA functions)
    if (ns === "ta" || (!ns && KNOWN_TA_FNS.has(fn))) {
      extractTAFromAssign([name], value);
    }
  }

  // Known TA functions (including newly added ones)
  const KNOWN_TA_FNS = new Set([
    "sma", "ema", "wma", "hma", "vwma", "rma", "swma", "alma",
    "rsi", "macd", "bb", "bbands", "stoch", "atr", "cci",
    "supertrend", "donchian", "crossover", "crossunder",
    "highest", "lowest", "highestbars", "lowestbars",
    // Newly recognized TA functions
    "pivothigh", "pivotlow", "valuewhen", "barssince",
    "change", "cum", "tr", "stdev", "variance", "median",
  ]);

  function extractTAFromAssign(targets: string[], value: Expr) {
    if (value.k !== "call") return;
    // Accept ta.fn() calls and also bare calls to known TA functions
    if (value.ns !== "ta" && !(value.ns === undefined && KNOWN_TA_FNS.has(value.fn))) return;
    const { fn, args } = value;

    // Determine source series (first arg if it's close/open/high/low/hl2 etc.)
    const SOURCES = new Set(["close", "open", "high", "low", "volume", "hl2", "hlc3", "ohlc4", "hlcc4", "vwap"]);
    let source = "close";
    let startIdx = 0;
    if (args[0]?.k === "id" && SOURCES.has(args[0].name)) {
      source = args[0].name;
      startIdx = 1;
    } else if (args[0]?.k === "call" && args[0].ns === "ta") {
      source = "ta_series"; // TA of TA (e.g., MACD applied to RSI)
      startIdx = 1;
    }

    const periods = args.slice(startIdx).map(a => a.k === "num" ? a.v : (a.k === "id" && result.params[a.name] !== undefined ? result.params[a.name] : 0));

    // ── Strict argument validation ──────────────────────────────────────────
    // Malformed args must be HARD errors, never silent defaults: substituting
    // e.g. period 14 for a typo deploys a different strategy than written.
    // Expected count of numeric/period args after the source, per function.
    const TA_PERIOD_ARITY: Record<string, { min: number; max: number }> = {
      sma: { min: 1, max: 1 }, ema: { min: 1, max: 1 }, wma: { min: 1, max: 1 },
      hma: { min: 1, max: 1 }, vwma: { min: 1, max: 1 }, rma: { min: 1, max: 1 },
      alma: { min: 1, max: 3 }, rsi: { min: 1, max: 1 }, atr: { min: 1, max: 1 },
      cci: { min: 1, max: 1 }, stdev: { min: 1, max: 1 }, variance: { min: 1, max: 1 },
      median: { min: 1, max: 1 }, change: { min: 0, max: 1 },
      highest: { min: 1, max: 1 }, lowest: { min: 1, max: 1 },
      highestbars: { min: 1, max: 1 }, lowestbars: { min: 1, max: 1 },
      macd: { min: 3, max: 3 }, bb: { min: 2, max: 2 }, bbands: { min: 2, max: 2 },
      stoch: { min: 1, max: 3 }, supertrend: { min: 2, max: 2 }, donchian: { min: 1, max: 1 },
      pivothigh: { min: 2, max: 2 }, pivotlow: { min: 2, max: 2 },
    };
    const arity = TA_PERIOD_ARITY[fn];
    if (arity) {
      // Series-variable first arg (TA-of-variable) keeps legacy handling for
      // the source slot; everything after a recognized source must be a
      // numeric literal or a declared input.
      const seriesVarSource = startIdx === 0 && args.length > 0 && args[0].k !== "num";
      const periodArgs = args.slice(seriesVarSource ? 1 : startIdx);
      periodArgs.forEach((a, i) => {
        const ok = a.k === "num" || (a.k === "id" && result.params[a.name] !== undefined);
        if (!ok) {
          const what = a.k === "id" ? `'${a.name}' is not a numeric literal or declared input()` : `argument is not numeric`;
          result.argErrors.push(`ta.${fn}: argument ${i + (seriesVarSource || startIdx ? 2 : 1)} invalid — ${what}.`);
        }
      });
      if (!seriesVarSource && (periodArgs.length < arity.min || periodArgs.length > arity.max)) {
        result.argErrors.push(
          `ta.${fn}: expected ${arity.min === arity.max ? arity.min : `${arity.min}-${arity.max}`} period argument(s) after the source, got ${periodArgs.length}. Missing or extra arguments are rejected — defaults are never substituted.`,
        );
      }
      const nonPositive = periodArgs.some((a) => a.k === "num" && a.v <= 0);
      if (nonPositive) {
        result.argErrors.push(`ta.${fn}: period arguments must be positive integers.`);
      }
    }

    result.taCalls.push({ fn, source, periods, rawArgs: args, targets });
  }

  function processTopLevelCall(e: Expr) {
    if (e.k !== "call") return;
    const { ns, fn, args, kw } = e;

    if (ns === "strategy" && fn === "entry") {
      const idStr = args[0]?.k === "str" ? args[0].v : "Long";
      const dirExpr = args[1] ?? kw["direction"];
      const dir = dirExpr?.k === "call" && dirExpr.fn === "long" ? "long"
                : dirExpr?.k === "call" && dirExpr.fn === "short" ? "short"
                : "long";
      const whenExpr = kw["when"] ?? args[2];
      result.strategyEntries.push({ id: idStr, direction: dir, whenExpr, condLine: exprToString(whenExpr) });
      if (dir === "long" && whenExpr) result.buyExpr = whenExpr;
      if (dir === "short" && whenExpr) result.sellExpr = whenExpr;
    }

    if ((ns === "strategy" && (fn === "close" || fn === "close_all" || fn === "exit"))) {
      const whenExpr = kw["when"] ?? args[1];
      result.strategyCloses.push({ id: args[0]?.k === "str" ? args[0].v : undefined, whenExpr });
      if (whenExpr && !result.sellExpr) result.sellExpr = whenExpr;
    }
  }

  function analyzeIfBlock(cond: Expr, then: Stmt[], els?: Stmt[]) {
    // Check if this if block contains strategy.entry/close calls
    const allStmts = [...(then || []), ...(els || [])];
    let hasLongEntry = false, hasShortEntry = false, hasClose = false;

    for (const s of allStmts) {
      if (s.k === "expr" && s.e.k === "call") {
        if (s.e.ns === "strategy" && s.e.fn === "entry") {
          const dir = s.e.args[1]?.k === "call" && s.e.args[1].fn === "short" ? "short" : "long";
          if (dir === "long") { hasLongEntry = true; result.buyExpr = cond; }
          if (dir === "short") { hasShortEntry = true; result.sellExpr = cond; }
        }
        if (s.e.ns === "strategy" && (s.e.fn === "close" || s.e.fn === "close_all")) {
          hasClose = true;
          if (!result.sellExpr) result.sellExpr = cond;
        }
      }
    }

    // Also handle multi-line strategy calls outside if blocks
    if (hasLongEntry && !hasShortEntry && !hasClose) {
      result.buyExpr = cond;
    }
  }

  // ── Main Parse Loop ────────────────────────────────────────────────────────

  while (!is("EOF")) {
    skip();
    if (is("EOF")) break;
    try {
      parseStatement();
    } catch {
      while (!is("NEWLINE") && !is("EOF")) adv();
    }
    skip();
  }

  // ── Pattern Detection ──────────────────────────────────────────────────────

  detectPattern();
  return result;

  // ── Pattern Detection Logic ────────────────────────────────────────────────

  function detectPattern() {
    const ta = result.taCalls;
    const fns = ta.map(t => t.fn);

    // MACD — most specific first
    if (fns.includes("macd")) {
      const macdCall = ta.find(t => t.fn === "macd")!;
      const fast = macdCall.periods[0] || 12;
      const slow = macdCall.periods[1] || 26;
      const sig  = macdCall.periods[2] || 9;
      result.detectedPattern = "macd";
      result.moveConfig = { indicatorType: 3, shortPeriod: fast, longPeriod: slow, thirdPeriod: sig, description: `MACD(${fast},${slow},${sig})` };
      return;
    }

    // Bollinger Bands
    if (fns.includes("bb") || fns.includes("bbands")) {
      const bbCall = ta.find(t => t.fn === "bb" || t.fn === "bbands")!;
      const period = bbCall.periods[0] || 20;
      const mult   = bbCall.periods[1] || 2;
      result.detectedPattern = "bb";
      result.moveConfig = { indicatorType: 4, shortPeriod: period, longPeriod: period, thirdPeriod: Math.round(mult * 10), description: `BB(${period}, ${mult})` };
      return;
    }

    // Stochastic Oscillator (TYPE_STOCH = 5)
    if (fns.includes("stoch")) {
      const stCall = ta.find(t => t.fn === "stoch")!;
      const k = stCall.periods[0] || 14;
      const d = stCall.periods[1] || 3;
      result.detectedPattern = "stoch";
      result.moveConfig = { indicatorType: 5, shortPeriod: k, longPeriod: d, thirdPeriod: 0, description: `Stoch(%K=${k}, %D=${d})` };
      return;
    }

    // SuperTrend (TYPE_SUPERTREND = 6)
    // Matches: ta.supertrend(), or bare identifier "supertrend" in function calls
    if (fns.includes("supertrend") || fns.some(f => f.toLowerCase().includes("supertrend"))) {
      const stCall = ta.find(t => t.fn === "supertrend" || t.fn.toLowerCase().includes("supertrend"))!;
      // Pine's signature is ta.supertrend(factor, atrPeriod).
      const multiplier  = stCall.periods[0] || 3;   // multiplier (e.g. 3.0)
      const atrPeriod   = stCall.periods[1] || 10;
      result.detectedPattern = "supertrend";
      // long_period stores multiplier * 10 (integer encoding: 3.0 → 30)
      result.moveConfig = { indicatorType: 6, shortPeriod: atrPeriod, longPeriod: Math.round(multiplier * 10), thirdPeriod: 0, description: `SuperTrend(ATR=${atrPeriod}, mult=${multiplier})` };
      return;
    }

    // Donchian Channels (TYPE_DONCHIAN = 7)
    // Matches: ta.donchian(), or identifiers containing "donchian"
    if (fns.includes("donchian") || fns.some(f => f.toLowerCase().includes("donchian"))) {
      const dcCall = ta.find(t => t.fn === "donchian" || t.fn.toLowerCase().includes("donchian"))!;
      const period = dcCall.periods[0] || 20;
      result.detectedPattern = "donchian";
      result.moveConfig = { indicatorType: 7, shortPeriod: period, longPeriod: 0, thirdPeriod: 0, description: `Donchian(${period})` };
      return;
    }

    // RSI
    if (fns.includes("rsi")) {
      const rsiCall = ta.find(t => t.fn === "rsi")!;
      const period = rsiCall.periods[0] || 14;
      result.detectedPattern = "rsi";
      result.moveConfig = { indicatorType: 2, shortPeriod: period, longPeriod: period, thirdPeriod: 0, description: `RSI(${period})` };
      return;
    }

    // EMA crossover: two EMA calls
    const emaCalls = ta.filter(t => t.fn === "ema");
    if (emaCalls.length >= 2) {
      const fast = emaCalls[0].periods[0] || 12;
      const slow = emaCalls[1].periods[0] || 26;
      result.detectedPattern = "ema_cross";
      result.moveConfig = { indicatorType: 1, shortPeriod: Math.min(fast, slow), longPeriod: Math.max(fast, slow), thirdPeriod: 0, description: `EMA(${Math.min(fast,slow)}) × EMA(${Math.max(fast,slow)})` };
      return;
    }

    // EMA single — crossover with price
    if (emaCalls.length === 1) {
      const p = emaCalls[0].periods[0] || 20;
      result.detectedPattern = "ema_cross";
      result.moveConfig = { indicatorType: 1, shortPeriod: p, longPeriod: p * 2, thirdPeriod: 0, description: `EMA(${p}) crossover` };
      return;
    }

    // SMA crossover: two SMA calls
    const smaCalls = ta.filter(t => t.fn === "sma" || t.fn === "wma" || t.fn === "hma");
    if (smaCalls.length >= 2) {
      const fast = smaCalls[0].periods[0] || 10;
      const slow = smaCalls[1].periods[0] || 30;
      result.detectedPattern = "sma_cross";
      result.moveConfig = { indicatorType: 0, shortPeriod: Math.min(fast, slow), longPeriod: Math.max(fast, slow), thirdPeriod: 0, description: `SMA(${Math.min(fast,slow)}) × SMA(${Math.max(fast,slow)})` };
      return;
    }

    // SMA single
    if (smaCalls.length === 1) {
      const p = smaCalls[0].periods[0] || 14;
      result.detectedPattern = "sma_cross";
      result.moveConfig = { indicatorType: 0, shortPeriod: p, longPeriod: p * 3, thirdPeriod: 0, description: `SMA(${p}) price cross` };
      return;
    }

    // CCI
    if (fns.includes("cci")) {
      result.detectedPattern = "cci";
      const p = ta.find(t => t.fn === "cci")!.periods[0] || 20;
      result.moveConfig = { indicatorType: 2, shortPeriod: p, longPeriod: p, thirdPeriod: 0, description: `CCI(${p}) → RSI approx` };
      return;
    }

    // ATR band
    if (fns.includes("atr")) {
      result.detectedPattern = "atr_band";
      const p = ta.find(t => t.fn === "atr")!.periods[0] || 14;
      result.moveConfig = { indicatorType: 4, shortPeriod: p, longPeriod: p, thirdPeriod: 20, description: `ATR(${p}) bands → BB approx` };
      return;
    }

    result.detectedPattern = "custom";
    result.moveConfig = { indicatorType: 0, shortPeriod: 10, longPeriod: 30, thirdPeriod: 0, description: "SMA Crossover (default)" };
  }
}

// ─── Utility: Expr → String ───────────────────────────────────────────────────

export function exprToString(e: Expr | undefined): string {
  if (!e) return "none";
  switch (e.k) {
    case "num":    return String(e.v);
    case "bool":   return String(e.v);
    case "str":    return `"${e.v}"`;
    case "na":     return "na";
    case "id":     return e.name;
    case "hist":   return `${e.name}[${e.offset}]`;
    case "call":   return `${e.ns ? e.ns + "." : ""}${e.fn}(${e.args.map(exprToString).join(", ")})`;
    case "binop":  return `(${exprToString(e.l)} ${e.op} ${exprToString(e.r)})`;
    case "unop":   return `${e.op}${exprToString(e.e)}`;
    case "ternary": return `${exprToString(e.cond)} ? ${exprToString(e.yes)} : ${exprToString(e.no)}`;
    default:       return "?";
  }
}

// ─── Convenience Re-exports ───────────────────────────────────────────────────

/** Quick summary of what TA indicators a Pine script uses */
export function summarizeIndicators(src: string): string[] {
  const { taCalls } = parsePine(src);
  return [...new Set(taCalls.map(t => t.fn))];
}
