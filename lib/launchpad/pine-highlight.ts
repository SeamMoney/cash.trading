export type PineTokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "builtin"
  | "function"
  | "operator";

export interface PineToken {
  kind: PineTokenKind;
  text: string;
}

const KEYWORDS = new Set([
  "and", "as", "break", "by", "const", "continue", "else", "export",
  "false", "for", "if", "import", "in", "indicator", "library", "method",
  "na", "not", "or", "return", "strategy", "switch", "to", "true", "type",
  "var", "varip", "while",
]);

const TYPES = new Set([
  "array", "bool", "box", "chart", "color", "float", "int", "label", "line",
  "linefill", "map", "matrix", "polyline", "string", "table",
]);

const BUILTINS = new Set([
  "alert", "bar_index", "barstate", "close", "dayofmonth", "dayofweek", "fill",
  "high", "hline", "hour", "input", "log", "low", "math", "minute", "month",
  "open", "plot", "plotchar", "plotshape", "request", "runtime", "second",
  "str", "syminfo", "ta", "time", "timeframe", "timestamp", "volume", "weekofyear",
  "year",
]);

function push(tokens: PineToken[], kind: PineTokenKind, text: string) {
  const previous = tokens.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else tokens.push({ kind, text });
}

/**
 * Lightweight, non-evaluating Pine lexer for the read-only source viewer.
 * It deliberately returns text tokens instead of HTML so React keeps source
 * code escaped and author-provided scripts can never inject markup.
 */
export function tokenizePineLine(line: string): PineToken[] {
  const tokens: PineToken[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const rest = line.slice(cursor);

    if (rest.startsWith("//")) {
      push(tokens, "comment", rest);
      break;
    }

    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) {
      push(tokens, "plain", whitespace);
      cursor += whitespace.length;
      continue;
    }

    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === "\\") {
          end += 2;
          continue;
        }
        end += 1;
        if (rest[end - 1] === quote) break;
      }
      push(tokens, "string", rest.slice(0, end));
      cursor += end;
      continue;
    }

    const hexColor = rest.match(/^#[0-9a-fA-F]{6,8}\b/)?.[0];
    if (hexColor) {
      push(tokens, "number", hexColor);
      cursor += hexColor.length;
      continue;
    }

    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
    if (number) {
      push(tokens, "number", number);
      cursor += number.length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_]\w*/)?.[0];
    if (identifier) {
      const after = rest.slice(identifier.length);
      const kind: PineTokenKind = KEYWORDS.has(identifier)
        ? "keyword"
        : TYPES.has(identifier)
          ? "type"
          : BUILTINS.has(identifier)
            ? "builtin"
            : /^\s*\(/.test(after)
              ? "function"
              : "plain";
      push(tokens, kind, identifier);
      cursor += identifier.length;
      continue;
    }

    const operator = rest.match(/^(?:=>|:=|==|!=|<=|>=|\+=|-=|\*=|\/=|[+\-*/%<>=?:])/u)?.[0];
    if (operator) {
      push(tokens, "operator", operator);
      cursor += operator.length;
      continue;
    }

    push(tokens, "plain", rest[0]);
    cursor += 1;
  }

  return tokens;
}
