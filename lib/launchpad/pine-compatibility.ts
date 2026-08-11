/**
 * Source-level execution compatibility checks for the sealed-vault compiler.
 *
 * The Pine parser intentionally supports a small, deterministic subset. These
 * checks run on the original source before an unsupported construct can be
 * skipped by tokenization or error recovery. Preview rendering may still use
 * richer Pine syntax; a committed vault may not silently drop any of it.
 */

interface LogicalLine {
  startLine: number;
  endLine: number;
  indent: number;
  text: string;
  physicalLines: number;
}

function sanitizePine(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line_comment" | "block_comment" | "single" | "double" = "code";

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1] ?? "";

    if (state === "code") {
      if (char === "/" && next === "/") {
        out += "  ";
        i += 2;
        state = "line_comment";
        continue;
      }
      if (char === "/" && next === "*") {
        out += "  ";
        i += 2;
        state = "block_comment";
        continue;
      }
      if (char === "'") {
        // Preserve a neutral value token so `name = "text"` remains a
        // complete logical statement after the literal contents are hidden.
        out += "0";
        i++;
        state = "single";
        continue;
      }
      if (char === '"') {
        out += "0";
        i++;
        state = "double";
        continue;
      }
      out += char;
      i++;
      continue;
    }

    if (state === "line_comment") {
      if (char === "\n") {
        out += "\n";
        state = "code";
      } else {
        out += " ";
      }
      i++;
      continue;
    }

    if (state === "block_comment") {
      if (char === "*" && next === "/") {
        out += "  ";
        i += 2;
        state = "code";
      } else {
        out += char === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    const quote = state === "single" ? "'" : '"';
    if (char === "\\") {
      out += next === "\n" ? " \n" : "  ";
      i += Math.min(2, source.length - i);
      continue;
    }
    if (char === quote) {
      out += " ";
      i++;
      state = "code";
      continue;
    }
    out += char === "\n" ? "\n" : " ";
    i++;
  }

  return out;
}

function delimiterDelta(text: string): number {
  let balance = 0;
  for (const char of text) {
    if (char === "(" || char === "[" || char === "{") balance++;
    if (char === ")" || char === "]" || char === "}") balance--;
  }
  return balance;
}

function continuesExpression(text: string): boolean {
  return /(?:\band|\bor|[+\-*/%^?:,=<>])\s*$/.test(text);
}

function leadingIndent(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width++;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function logicalLines(source: string): LogicalLine[] {
  const lines = sanitizePine(source).split("\n");
  const result: LogicalLine[] = [];
  let current: LogicalLine | null = null;
  let balance = 0;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!current && !trimmed) continue;

    if (!current) {
      current = {
        startLine: index + 1,
        endLine: index + 1,
        indent: leadingIndent(raw),
        text: trimmed,
        physicalLines: 1,
      };
      balance = delimiterDelta(trimmed);
    } else {
      current.endLine = index + 1;
      current.physicalLines++;
      current.text += ` ${trimmed}`;
      balance += delimiterDelta(trimmed);
    }

    if (balance <= 0 && !continuesExpression(current.text)) {
      result.push(current);
      current = null;
      balance = 0;
    }
  }

  if (current) result.push(current);
  return result;
}

/** Hard errors for source syntax the committed evaluator cannot reproduce. */
export function collectPineExecutionCompatibilityErrors(source: string): string[] {
  const sanitized = sanitizePine(source);
  const errors = new Set<string>();
  const add = (message: string) => errors.add(message);

  const sourceRules: Array<{ pattern: RegExp; message: string }> = [
    {
      pattern: /^\s*type\s+[A-Za-z_]\w*/m,
      message: "Custom Pine types are preview-only; sealed vault execution cannot commit type declarations or object state yet.",
    },
    {
      pattern: /^\s*method\b/m,
      message: "Pine methods are preview-only; sealed vault execution cannot reproduce method dispatch yet.",
    },
    {
      pattern: /^\s*(?:import|export|library)\b/m,
      message: "Pine imports, exports, and libraries are preview-only; committed vault programs must be self-contained.",
    },
    {
      pattern: /\brequest\s*\./,
      message: "request.* data is preview-only; the sealed vault trace currently contains one market's close-price series only.",
    },
    {
      pattern: /\b(?:array|map|matrix)\s*(?:\.|<)/,
      message: "Pine arrays, maps, and matrices are preview-only; the committed evaluator does not reproduce mutable collections yet.",
    },
    {
      pattern: /(?:^|[=:\s])switch\b/m,
      message: "Pine switch expressions are preview-only; sealed vault execution does not lower them yet.",
    },
    {
      pattern: /^\s*(?:break|continue)\b/m,
      message: "Loop break/continue control flow is preview-only and cannot be committed yet.",
    },
    {
      pattern: /\bbar_index\b/,
      message: "bar_index is preview-only; the sealed close-price trace does not expose Pine's chart index semantics.",
    },
    {
      pattern: /;/,
      message: "Semicolon-separated statements cannot be committed; the sealed parser would lose the original statement boundary.",
    },
  ];

  for (const rule of sourceRules) {
    if (rule.pattern.test(sanitized)) add(rule.message);
  }

  const lines = logicalLines(source);
  const blockHeader = /^(?:if\b|for\b|while\b|else\b|[A-Za-z_]\w*\s*\([^)]*\)\s*=>)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!blockHeader.test(line.text)) continue;

    const firstChild = lines[i + 1];
    if (!firstChild || firstChild.indent <= line.indent) continue;
    const childIndent = firstChild.indent;
    let directChildren = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j];
      if (candidate.indent <= line.indent) break;
      if (candidate.indent === childIndent) directChildren++;
    }
    if (directChildren > 1) {
      add(
        `The block beginning on line ${line.startLine} has ${directChildren} direct statements. `
        + "The sealed compiler currently supports one statement per indented block; accepting this source would silently drop later statements.",
      );
    }
  }

  const visualMultiline = /^(?:plot|plotshape|plotchar|plotarrow|fill|bgcolor|barcolor|hline|alertcondition|label\.new|line\.new|box\.new|table\.new)\s*\(/;
  for (const line of lines) {
    if (line.physicalLines <= 1 || visualMultiline.test(line.text)) continue;
    add(
      `The execution statement beginning on line ${line.startLine} spans multiple physical lines. `
      + "Multiline execution expressions are preview-only until the sealed parser can prove the full statement was consumed.",
    );
  }

  return [...errors];
}
