/** Syntax-only Pine types. No strategy inference, coercion, or TA substitution. */
export interface PineSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface PineDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  line: number;
  column: number;
}

export type PineExpr = (
  | { kind: "literal"; value: number | boolean | string | null; numericType?: "int" | "float"; colorLiteral?: boolean }
  | { kind: "identifier"; name: string }
  | { kind: "history"; source: PineExpr; offset: PineExpr }
  | { kind: "unary"; operator: string; operand: PineExpr }
  | { kind: "binary"; operator: string; left: PineExpr; right: PineExpr }
  | { kind: "conditional"; condition: PineExpr; whenTrue: PineExpr; whenFalse: PineExpr }
  | { kind: "call"; name: string; args: PineExpr[]; kwargs: Record<string, PineExpr> }
  | { kind: "tuple"; items: PineExpr[] }
) & { span: PineSpan };

export type PineStmt = (
  | {
      kind: "declare";
      names: string[];
      mode: "normal" | "var" | "varip";
      typeName?: string;
      value: PineExpr;
    }
  | {
      kind: "assign";
      name: string;
      operator: ":=" | "+=" | "-=" | "*=" | "/=" | "%=";
      value: PineExpr;
    }
  | { kind: "if"; condition: PineExpr; then: PineStmt[]; otherwise: PineStmt[] }
  | { kind: "for"; variable: string; from: PineExpr; to: PineExpr; step?: PineExpr; body: PineStmt[] }
  | { kind: "while"; condition: PineExpr; body: PineStmt[] }
  | { kind: "function"; name: string; params: string[]; body: PineStmt[] }
  | { kind: "expression"; expression: PineExpr }
) & { span: PineSpan };

export interface PineProgram {
  /** Pine's actual default is v1. Omitted or unsupported versions are errors. */
  version: number;
  statements: PineStmt[];
  diagnostics: PineDiagnostic[];
}
