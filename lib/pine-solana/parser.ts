/**
 * Strict, bounded Pine v4-v6 syntax frontend for the Solana compiler.
 *
 * The older launchpad parser remains unchanged. Unlike that preview parser,
 * this parser preserves block ownership and assignment operators, rejects
 * every unconsumed token, and never invents a value during error recovery.
 * Unsupported grammar produces diagnostics; a caller must refuse codegen
 * whenever any diagnostic has severity "error".
 */
import type { PineDiagnostic, PineExpr, PineProgram, PineSpan, PineStmt } from "./types";
export type { PineDiagnostic, PineExpr, PineProgram, PineSpan, PineStmt } from "./types";

const MAX_SOURCE_LENGTH = 256_000;
const MAX_TOKENS = 50_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 96;
const MAX_DIAGNOSTICS = 50;

type TokenKind = "identifier" | "number" | "string" | "color" | "operator" | "newline" | "eof";
interface Token {
  kind: TokenKind;
  text: string;
  value?: number | string;
  span: PineSpan;
}

function spanAt(line: number, column: number): PineSpan {
  return { line, column, endLine: line, endColumn: column };
}

function through(start: PineSpan, end: PineSpan): PineSpan {
  return { line: start.line, column: start.column, endLine: end.endLine, endColumn: end.endColumn };
}

function diagnostic(code: string, message: string, span: PineSpan): PineDiagnostic {
  return { severity: "error", code, message, line: span.line, column: span.column };
}

function lex(source: string): { tokens: Token[]; diagnostics: PineDiagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: PineDiagnostic[] = [];
  const delimiters: Array<{ char: string; span: PineSpan }> = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const peek = (n = 0): string => source[offset + n] ?? "";
  const advance = (): string => {
    const char = source[offset++] ?? "";
    if (char === "\n") { line++; column = 1; }
    else if (char === "\t") column += 4;
    else column++;
    return char;
  };
  const emit = (kind: TokenKind, text: string, start: PineSpan, value?: number | string): void => {
    tokens.push({ kind, text, value, span: through(start, spanAt(line, column)) });
  };
  const fail = (code: string, message: string, at: PineSpan): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic(code, message, at));
  };
  const digit = (char: string): boolean => char.length === 1 && char >= "0" && char <= "9";
  const identifierStart = (char: string): boolean => /^[A-Za-z_]$/.test(char);
  const identifierPart = (char: string): boolean => /^[A-Za-z_0-9]$/.test(char);

  while (offset < source.length) {
    if (tokens.length >= MAX_TOKENS) {
      fail("PINE_RESOURCE_LIMIT", `Source exceeds the ${MAX_TOKENS} token limit.`, spanAt(line, column));
      break;
    }
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
    const char = peek();
    const start = spanAt(line, column);

    if (char === " " || char === "\t" || char === "\r") { advance(); continue; }
    if (char === "\n") {
      advance();
      if (delimiters.length === 0) emit("newline", "\n", start);
      continue;
    }
    if (char === "/" && peek(1) === "/") {
      while (offset < source.length && peek() !== "\n") advance();
      continue;
    }
    if (char === "/" && peek(1) === "*") {
      fail("PINE_UNSUPPORTED_SYNTAX", "Block comments are outside the supported Pine grammar; use // comments.", start);
      advance(); advance();
      while (offset < source.length && !(peek() === "*" && peek(1) === "/")) advance();
      if (offset < source.length) { advance(); advance(); }
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = advance();
      let value = "";
      let closed = false;
      while (offset < source.length && peek() !== "\n") {
        const next = advance();
        if (next === quote) { closed = true; break; }
        if (next !== "\\") { value += next; continue; }
        if (offset >= source.length || peek() === "\n") break;
        const escaped = advance();
        // Pine's control escapes are newline and tab. Other escaped letters
        // retain their literal meaning; JavaScript's \r/\b/\f rules differ.
        const escapes: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' };
        if (Object.prototype.hasOwnProperty.call(escapes, escaped)) value += escapes[escaped];
        else value += escaped;
      }
      if (!closed) fail("PINE_UNTERMINATED_STRING", "String literal is not closed on this line.", start);
      emit("string", value, start, value);
      continue;
    }
    if (digit(char) || (char === "." && digit(peek(1)))) {
      let raw = "";
      while (digit(peek())) raw += advance();
      if (peek() === ".") {
        raw += advance();
        while (digit(peek())) raw += advance();
      }
      if (peek() === "e" || peek() === "E") {
        raw += advance();
        if (peek() === "+" || peek() === "-") raw += advance();
        if (!digit(peek())) fail("PINE_INVALID_NUMBER", "Exponent must contain at least one digit.", start);
        while (digit(peek())) raw += advance();
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) fail("PINE_INVALID_NUMBER", "Numeric literal must be finite.", start);
      if (/^\d+$/.test(raw) && !Number.isSafeInteger(value)) {
        fail("PINE_NUMBER_RANGE", "Integer literal exceeds the frontend's exact integer range (2^53 - 1).", start);
      }
      emit("number", raw, start, value);
      continue;
    }
    if (identifierStart(char)) {
      let text = "";
      while (identifierPart(peek())) text += advance();
      emit("identifier", text, start);
      continue;
    }
    if (char === "#") {
      let raw = advance();
      while (/^[A-Fa-f0-9]$/.test(peek())) raw += advance();
      if (raw.length !== 7 && raw.length !== 9) fail("PINE_INVALID_COLOR", "A color literal must have six or eight hexadecimal digits.", start);
      emit("color", raw, start, raw);
      continue;
    }
    const pair = char + peek(1);
    if (["=>", ":=", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">="].includes(pair)) {
      advance(); advance(); emit("operator", pair, start); continue;
    }
    if ("()[],.:?+-*/%=<>".includes(char)) {
      advance();
      if (char === "(" || char === "[") {
        delimiters.push({ char, span: start });
        if (delimiters.length > MAX_DEPTH) {
          fail("PINE_RESOURCE_LIMIT", `Delimiter nesting exceeds ${MAX_DEPTH}.`, start);
          break;
        }
      }
      if (char === ")" || char === "]") {
        const previous = delimiters.pop();
        if (!previous || previous.char !== (char === ")" ? "(" : "[")) {
          fail("PINE_DELIMITER", `Unmatched closing delimiter '${char}'.`, start);
        }
      }
      emit("operator", char, start);
      continue;
    }
    fail("PINE_UNKNOWN_CHARACTER", `Unexpected character ${JSON.stringify(char)}. No token was silently discarded.`, start);
    advance();
  }

  for (const delimiter of delimiters.slice(0, MAX_DIAGNOSTICS - diagnostics.length)) {
    fail("PINE_DELIMITER", `Unclosed delimiter '${delimiter.char}'.`, delimiter.span);
  }
  tokens.push({ kind: "eof", text: "", span: spanAt(line, column) });
  return { tokens, diagnostics };
}

class ParseFailure extends Error {
  readonly diagnostic: PineDiagnostic;
  constructor(issue: PineDiagnostic) {
    super(issue.message);
    this.diagnostic = issue;
  }
}

const PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  or: 1, and: 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
});
const ASSIGNMENTS = new Set([":=", "+=", "-=", "*=", "/=", "%="]);
const UNSUPPORTED_STATEMENTS = new Set(["type", "method", "import", "export", "enum", "switch", "break", "continue"]);
const RESERVED = new Set(["if", "else", "for", "to", "by", "while", "var", "varip", "true", "false", "na", "and", "or", "not", ...UNSUPPORTED_STATEMENTS]);
// Pine v5 added these restrictions on user-defined variable/function names.
// They do not forbid built-in argument names (e.g. plotshape(text = "buy"))
// or the text.* namespace, and they must not invalidate v4 identifiers.
const V5_RESERVED_NAMES = new Set(["catch", "class", "do", "ellipse", "in", "is", "polygon", "range", "return", "struct", "text", "throw", "try"]);

class Parser {
  private readonly tokens: Token[];
  private position = 0;
  private depth = 0;
  private nodes = 0;
  private expressionIndent = 0;
  readonly diagnostics: PineDiagnostic[] = [];
  constructor(tokens: Token[], private readonly version: number) { this.tokens = tokens; }

  private current(n = 0): Token { return this.tokens[Math.min(this.position + n, this.tokens.length - 1)]; }
  private previous(): Token { return this.tokens[Math.max(0, this.position - 1)]; }
  private is(text: string): boolean {
    const token = this.current();
    return (token.kind === "identifier" || token.kind === "operator") && token.text === text;
  }
  private consume(): Token { const token = this.current(); if (token.kind !== "eof") this.position++; return token; }
  private failure(code: string, message: string, token = this.current()): never {
    throw new ParseFailure(diagnostic(code, message, token.span));
  }
  private expect(text: string): Token {
    if (!this.is(text)) this.failure("PINE_SYNTAX", `Expected '${text}', found ${this.describe(this.current())}.`);
    return this.consume();
  }
  private describe(token: Token): string {
    return token.kind === "eof" ? "end of source" : token.kind === "newline" ? "end of line" : `'${token.text}'`;
  }
  private bindingName(token: Token): void {
    if (this.version >= 5 && V5_RESERVED_NAMES.has(token.text)) {
      this.failure("PINE_RESERVED_IDENTIFIER", `'${token.text}' is reserved in Pine v5 and v6 and cannot name a variable, parameter, or function.`, token);
    }
  }
  private identifier(binding = false): Token {
    const token = this.current();
    if (token.kind !== "identifier" || RESERVED.has(token.text)) this.failure("PINE_SYNTAX", `Expected an identifier, found ${this.describe(token)}.`);
    if (binding) this.bindingName(token);
    return this.consume();
  }
  private skipNewlines(): void { while (this.current().kind === "newline") this.consume(); }
  private enter<T>(run: () => T): T {
    if (++this.depth > MAX_DEPTH) this.failure("PINE_RESOURCE_LIMIT", `Syntax nesting exceeds ${MAX_DEPTH}.`);
    try { return run(); } finally { this.depth--; }
  }
  private node<T extends PineExpr | PineStmt>(node: T): T {
    if (++this.nodes > MAX_NODES) this.failure("PINE_RESOURCE_LIMIT", `AST exceeds ${MAX_NODES} nodes.`);
    return node;
  }
  private endStatement(): void {
    if (this.current().kind !== "newline" && this.current().kind !== "eof") {
      this.failure("PINE_TRAILING_TOKEN", `Unexpected ${this.describe(this.current())} after the statement; the entire source must be consumed.`);
    }
  }
  private nextLineTokenIndex(): number {
    let index = this.position;
    while (this.tokens[index]?.kind === "newline") index++;
    return Math.min(index, this.tokens.length - 1);
  }
  private requiredContinuation(): void {
    if (this.current().kind !== "newline") return;
    const next = this.nextLineTokenIndex();
    if (this.tokens[next].kind === "eof" || this.tokens[next].span.column - 1 <= this.expressionIndent) {
      this.failure("PINE_SYNTAX", "An expression continuation must be indented after this operator.");
    }
    if ((this.tokens[next].span.column - 1) % 4 === 0) {
      this.failure("PINE_INDENTATION", "A wrapped expression outside parentheses or brackets cannot begin at a four-space block boundary.", this.tokens[next]);
    }
    this.position = next;
  }
  private optionalContinuation(): void {
    if (this.current().kind !== "newline") return;
    const next = this.nextLineTokenIndex();
    const token = this.tokens[next];
    if (token.span.column - 1 <= this.expressionIndent) return;
    if ((token.kind === "operator" || token.kind === "identifier") &&
        (Object.prototype.hasOwnProperty.call(PRECEDENCE, token.text) || token.text === "?" || token.text === ":")) {
      if ((token.span.column - 1) % 4 === 0) {
        // +x/-x may instead start a block's expression (notably a return).
        // Every other leading binary/ternary operator here is an invalid
        // line wrap. Newlines inside delimiters are suppressed by lex().
        if (token.text === "+" || token.text === "-") return;
        this.failure("PINE_INDENTATION", "A wrapped expression outside parentheses or brackets cannot begin at a four-space block boundary.", token);
      }
      this.position = next;
    }
  }

  parse(): PineStmt[] { return this.block(0); }

  private block(indent: number): PineStmt[] {
    return this.enter(() => {
      const result: PineStmt[] = [];
      while (this.current().kind !== "eof") {
        this.skipNewlines();
        if (this.current().kind === "eof") break;
        const actualIndent = this.current().span.column - 1;
        if (actualIndent < indent) break;
        if (this.diagnostics.length >= MAX_DIAGNOSTICS) break;
        const before = this.position;
        try {
          if (actualIndent > indent) this.failure("PINE_INDENTATION", `Unexpected indentation: expected ${indent} spaces, found ${actualIndent}.`);
          this.expressionIndent = indent;
          result.push(this.statement(indent));
        } catch (error) {
          if (!(error instanceof ParseFailure)) throw error;
          this.diagnostics.push(error.diagnostic);
          if (error.diagnostic.code === "PINE_RESOURCE_LIMIT") {
            this.position = this.tokens.length - 1;
            break;
          }
          while (this.current().kind !== "newline" && this.current().kind !== "eof") this.consume();
        }
        if (this.position === before && this.current().kind !== "eof") this.consume();
      }
      return result;
    });
  }

  private childBlock(parentIndent: number): PineStmt[] {
    this.endStatement();
    this.skipNewlines();
    if (this.current().kind === "eof" || this.current().span.column - 1 <= parentIndent) {
      this.failure("PINE_EMPTY_BLOCK", "Expected an indented block containing at least one statement.");
    }
    const childIndent = this.current().span.column - 1;
    if (childIndent !== parentIndent + 4) {
      this.failure("PINE_INDENTATION", `Pine blocks require four spaces or one tab: expected ${parentIndent + 4} spaces, found ${childIndent}.`);
    }
    const body = this.block(childIndent);
    this.expressionIndent = parentIndent;
    return body;
  }

  private statement(indent: number): PineStmt {
    return this.enter(() => {
      const token = this.current();
      if (token.kind === "identifier" && UNSUPPORTED_STATEMENTS.has(token.text)) {
        this.failure("PINE_UNSUPPORTED_SYNTAX", `'${token.text}' is not implemented in the strict compiler grammar yet.`);
      }
      if (this.is("if")) return this.ifStatement(indent);
      if (this.is("else")) this.failure("PINE_SYNTAX", "'else' must follow an 'if' at the same indentation.");
      if (this.is("for")) return this.forStatement(indent);
      if (this.is("while")) {
        const start = this.consume().span;
        const condition = this.expression();
        const body = this.childBlock(indent);
        return this.node({ kind: "while", condition, body, span: through(start, body[body.length - 1]?.span ?? condition.span) });
      }
      if (token.kind === "identifier" && this.looksLikeFunction()) return this.functionStatement(indent);
      return this.simpleStatement();
    });
  }

  private ifStatement(indent: number): PineStmt {
    const start = this.expect("if").span;
    const condition = this.expression();
    const then = this.childBlock(indent);
    let otherwise: PineStmt[] = [];
    this.skipNewlines();
    if (this.is("else") && this.current().span.column - 1 === indent) {
      this.consume();
      if (this.is("if")) {
        otherwise = [this.enter(() => this.ifStatement(indent))];
      } else {
        otherwise = this.childBlock(indent);
      }
    }
    const end = otherwise[otherwise.length - 1]?.span ?? then[then.length - 1]?.span ?? condition.span;
    return this.node({ kind: "if", condition, then, otherwise, span: through(start, end) });
  }

  private forStatement(indent: number): PineStmt {
    const start = this.expect("for").span;
    const variable = this.identifier(true).text;
    if (this.is("in")) this.failure("PINE_UNSUPPORTED_SYNTAX", "Collection for-in loops require the collection runtime, which is not implemented yet.");
    this.expect("=");
    const from = this.expression();
    this.expect("to");
    const to = this.expression();
    let step: PineExpr | undefined;
    if (this.is("by")) { this.consume(); step = this.expression(); }
    const body = this.childBlock(indent);
    return this.node({ kind: "for", variable, from, to, ...(step ? { step } : {}), body, span: through(start, body[body.length - 1]?.span ?? to.span) });
  }

  private looksLikeFunction(): boolean {
    if (this.current(1).text !== "(") return false;
    let level = 0;
    for (let index = this.position + 1; index < this.tokens.length; index++) {
      const token = this.tokens[index];
      if (token.kind === "newline" || token.kind === "eof") return false;
      if (token.kind !== "operator") continue;
      if (token.text === "(") level++;
      else if (token.text === ")" && --level === 0) return this.tokens[index + 1]?.text === "=>";
    }
    return false;
  }

  private functionStatement(indent: number): PineStmt {
    const start = this.identifier(true);
    this.expect("(");
    const params: string[] = [];
    while (!this.is(")")) {
      if (this.current().kind === "eof") this.failure("PINE_SYNTAX", "Unterminated function parameter list.");
      const name = this.identifier(true);
      if (this.current().kind === "identifier") {
        this.failure("PINE_UNSUPPORTED_SYNTAX", "Typed or qualified function parameters are not implemented; parameter type information must not be silently discarded.", name);
      }
      if (this.is("=")) this.failure("PINE_UNSUPPORTED_SYNTAX", "Default function parameters are not implemented yet.");
      if (params.includes(name.text)) this.failure("PINE_DUPLICATE_PARAMETER", `Duplicate parameter '${name.text}'.`, name);
      params.push(name.text);
      if (this.is(")")) break;
      this.expect(",");
      if (this.is(")")) this.failure("PINE_SYNTAX", "A parameter is required after ','.");
    }
    this.expect(")");
    this.expect("=>");
    const body = this.current().kind === "newline" ? this.childBlock(indent) : [this.simpleStatement()];
    if (!body.length) this.failure("PINE_EMPTY_BLOCK", "A function requires a body.");
    return this.node({ kind: "function", name: start.text, params, body, span: through(start.span, body[body.length - 1].span) });
  }

  private simpleStatement(): PineStmt {
    const start = this.current().span;
    let mode: "normal" | "var" | "varip" = "normal";
    if (this.is("var") || this.is("varip")) mode = this.consume().text as "var" | "varip";
    let typeName: string | undefined;
    if (this.current().kind === "identifier" && this.current(1).kind === "identifier" &&
        this.current(2).text === "=") {
      typeName = this.identifier().text;
    }
    if (this.current().kind === "identifier" && this.current(1).text === "=") {
      const name = this.identifier(true).text;
      this.expect("=");
      this.requiredContinuation();
      const value = this.expression();
      this.endStatement();
      return this.node({ kind: "declare", names: [name], mode, ...(typeName ? { typeName } : {}), value, span: through(start, value.span) });
    }
    if (this.is("[")) {
      const saved = this.position;
      this.consume();
      const targets: Token[] = [];
      let isDeclaration = true;
      while (!this.is("]") && this.current().kind !== "eof") {
        if (this.current().kind !== "identifier" || RESERVED.has(this.current().text)) { isDeclaration = false; break; }
        targets.push(this.consume());
        if (this.is("]")) break;
        if (!this.is(",")) { isDeclaration = false; break; }
        this.consume();
        if (this.is("]")) { isDeclaration = false; break; }
      }
      if (this.is("]")) this.consume();
      else isDeclaration = false;
      if (isDeclaration && this.is("=")) {
        targets.forEach(target => this.bindingName(target));
        const names = targets.map(target => target.text);
        if (!names.length) this.failure("PINE_SYNTAX", "A tuple declaration cannot be empty.");
        const unique = names.filter(name => name !== "_");
        if (new Set(unique).size !== unique.length) this.failure("PINE_DUPLICATE_TARGET", "Tuple declaration names must be distinct; '_' may be repeated.");
        this.consume();
        this.requiredContinuation();
        const value = this.expression();
        this.endStatement();
        return this.node({ kind: "declare", names, mode, ...(typeName ? { typeName } : {}), value, span: through(start, value.span) });
      }
      this.position = saved;
    }
    if (mode !== "normal" || typeName) this.failure("PINE_SYNTAX", "A variable declaration requires a name and '=' initializer.");
    if (this.current().kind === "identifier" && ASSIGNMENTS.has(this.current(1).text)) {
      const name = this.identifier(true).text;
      const operator = this.consume().text as Extract<PineStmt, { kind: "assign" }>["operator"];
      this.requiredContinuation();
      const value = this.expression();
      this.endStatement();
      return this.node({ kind: "assign", name, operator, value, span: through(start, value.span) });
    }
    const expression = this.expression();
    this.endStatement();
    return this.node({ kind: "expression", expression, span: expression.span });
  }

  private expression(): PineExpr {
    return this.enter(() => {
      const condition = this.binary(1);
      this.optionalContinuation();
      if (!this.is("?")) return condition;
      this.consume(); this.requiredContinuation();
      const whenTrue = this.expression();
      this.optionalContinuation();
      this.expect(":"); this.requiredContinuation();
      const whenFalse = this.expression();
      return this.node({ kind: "conditional", condition, whenTrue, whenFalse, span: through(condition.span, whenFalse.span) });
    });
  }

  private binary(minimum: number): PineExpr {
    return this.enter(() => {
      let left = this.unary();
      while (true) {
        this.optionalContinuation();
        const token = this.current();
        const precedence = (token.kind === "identifier" || token.kind === "operator") && Object.prototype.hasOwnProperty.call(PRECEDENCE, token.text)
          ? PRECEDENCE[token.text] : undefined;
        if (precedence === undefined || precedence < minimum) break;
        const operator = this.consume().text;
        this.requiredContinuation();
        const right = this.binary(precedence + 1);
        left = this.node({ kind: "binary", operator, left, right, span: through(left.span, right.span) });
      }
      return left;
    });
  }

  private unary(): PineExpr {
    return this.enter(() => {
      if (this.is("-") || this.is("+") || this.is("not")) {
        const start = this.consume();
        this.requiredContinuation();
        const operand = this.unary();
        return this.node({ kind: "unary", operator: start.text, operand, span: through(start.span, operand.span) });
      }
      return this.postfix();
    });
  }

  private postfix(): PineExpr {
    let expression = this.primary();
    while (true) {
      if (this.is(".")) {
        if (expression.kind !== "identifier") this.failure("PINE_UNSUPPORTED_SYNTAX", "Member access on a computed value requires object semantics, which are not implemented yet.");
        this.consume();
        const member = this.identifier();
        expression = this.node({ kind: "identifier", name: `${expression.name}.${member.text}`, span: through(expression.span, member.span) });
      } else if (this.is("(")) {
        if (expression.kind !== "identifier") this.failure("PINE_UNSUPPORTED_SYNTAX", "Only named function calls are supported.");
        this.consume();
        const args: PineExpr[] = [];
        const kwargs: Record<string, PineExpr> = Object.create(null) as Record<string, PineExpr>;
        let sawKeyword = false;
        while (!this.is(")")) {
          if (this.current().kind === "eof" || this.current().kind === "newline") this.failure("PINE_SYNTAX", "Unterminated function call.");
          if (this.current().kind === "identifier" && this.current(1).text === "=") {
            const keyword = this.identifier();
            if (Object.prototype.hasOwnProperty.call(kwargs, keyword.text)) this.failure("PINE_DUPLICATE_ARGUMENT", `Duplicate named argument '${keyword.text}'.`, keyword);
            this.expect("=");
            kwargs[keyword.text] = this.expression();
            sawKeyword = true;
          } else {
            if (sawKeyword) this.failure("PINE_ARGUMENT_ORDER", "Positional arguments cannot follow named arguments.");
            args.push(this.expression());
          }
          if (this.is(")")) break;
          this.expect(",");
          if (this.is(")")) this.failure("PINE_SYNTAX", "An argument is required after ','.");
        }
        const close = this.expect(")");
        expression = this.node({ kind: "call", name: expression.name, args, kwargs, span: through(expression.span, close.span) });
      } else if (this.is("[")) {
        if (expression.kind === "history") {
          this.failure("PINE_HISTORY_CHAIN", "The history operator cannot be applied twice to the same value. Declare an intermediate series before referencing its history.");
        }
        this.consume();
        const offset = this.expression();
        const close = this.expect("]");
        expression = this.node({ kind: "history", source: expression, offset, span: through(expression.span, close.span) });
      } else break;
    }
    return expression;
  }

  private primary(): PineExpr {
    const token = this.current();
    if (token.kind === "number" || token.kind === "string" || token.kind === "color") {
      this.consume();
      return this.node({ kind: "literal", value: token.value!, ...(token.kind === "number" ? { numericType: /[.eE]/.test(token.text) ? "float" as const : "int" as const } : {}), ...(token.kind === "color" ? { colorLiteral: true } : {}), span: token.span });
    }
    if (this.is("true") || this.is("false")) {
      this.consume();
      return this.node({ kind: "literal", value: token.text === "true", span: token.span });
    }
    if (this.is("na") && this.current(1).text !== "(") {
      this.consume();
      return this.node({ kind: "literal", value: null, span: token.span });
    }
    if (this.is("(")) {
      const start = this.consume();
      const expression = this.expression();
      const close = this.expect(")");
      return { ...expression, span: through(start.span, close.span) };
    }
    if (this.is("[")) {
      const start = this.consume();
      const items: PineExpr[] = [];
      if (this.is("]")) this.failure("PINE_SYNTAX", "An empty tuple is not a Pine expression.");
      while (!this.is("]")) {
        items.push(this.expression());
        if (this.is("]")) break;
        this.expect(",");
        if (this.is("]")) this.failure("PINE_SYNTAX", "A tuple item is required after ','.");
      }
      const close = this.expect("]");
      return this.node({ kind: "tuple", items, span: through(start.span, close.span) });
    }
    if (token.kind === "identifier") {
      if (UNSUPPORTED_STATEMENTS.has(token.text)) this.failure("PINE_UNSUPPORTED_SYNTAX", `'${token.text}' expressions are not implemented yet.`);
      if (RESERVED.has(token.text) && token.text !== "na") this.failure("PINE_SYNTAX", `Expected an expression, found '${token.text}'.`);
      if (!(token.text === "text" && this.current(1).text === ".")) this.bindingName(token);
      this.consume();
      return this.node({ kind: "identifier", name: token.text, span: token.span });
    }
    this.failure("PINE_SYNTAX", `Expected an expression, found ${this.describe(token)}.`);
  }
}

/** Parse source without side effects. Syntax failures are returned, never thrown. */
export function parseStrictPine(source: string): PineProgram {
  const result: PineProgram = { version: 1, statements: [], diagnostics: [] };
  try {
    if (typeof source !== "string") {
      result.diagnostics.push(diagnostic("PINE_SOURCE_TYPE", "Pine source must be a string.", spanAt(1, 1)));
      return result;
    }
    if (source.length > MAX_SOURCE_LENGTH) {
      result.diagnostics.push(diagnostic("PINE_RESOURCE_LIMIT", `Source exceeds ${MAX_SOURCE_LENGTH} characters.`, spanAt(1, 1)));
      return result;
    }
    const normalized = source.replace(/\r\n?/g, "\n");
    const declarations = [...normalized.matchAll(/^\s*\/\/\s*@version\s*=\s*(\d+)\s*$/gm)];
    if (declarations.length > 0) result.version = Number(declarations[0][1]);
    if (declarations.length > 1) {
      result.diagnostics.push(diagnostic("PINE_VERSION", "Only one //@version directive is allowed.", spanAt(1, 1)));
    }
    if (![4, 5, 6].includes(result.version)) {
      result.diagnostics.push(diagnostic("PINE_VERSION", "Specify //@version=4, //@version=5, or //@version=6. Omitted versions use Pine v1 and are not silently upgraded.", spanAt(1, 1)));
    }
    const scanned = lex(normalized);
    result.diagnostics.push(...scanned.diagnostics);
    if (scanned.diagnostics.length) return result;
    const parser = new Parser(scanned.tokens, result.version);
    result.statements = parser.parse();
    result.diagnostics.push(...parser.diagnostics);
  } catch (error) {
    if (error instanceof ParseFailure) result.diagnostics.push(error.diagnostic);
    else result.diagnostics.push(diagnostic("PINE_PARSE_FAILURE", "Source could not be parsed safely; no executable artifact may be emitted.", spanAt(1, 1)));
  }
  return result;
}
