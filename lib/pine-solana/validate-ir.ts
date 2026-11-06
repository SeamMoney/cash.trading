import { IR_VERSION, SOLANA_COMPILER_VERSION } from "./ir";
import type { Node, Op, ProgramIR } from "./ir";
import { assertProgramCommitment } from "./commitment";

const fields = new Set<Op>(["open", "high", "low", "close", "volume", "time", "bar_index"]);
const numericUnary = new Set<Op>(["neg", "abs", "floor", "ceil", "round", "sqrt", "sign", "checked_int"]);
const numericBinary = new Set<Op>(["add", "sub", "mul", "div", "mod", "min", "max"]);
const comparisons = new Set<Op>(["eq", "ne", "lt", "le", "gt", "ge"]);
const averages = new Set<Op>(["sma", "wma", "stdev", "variance"]);
const periodic = new Set<Op>([...averages, "ema", "rma", "highest", "lowest", "sum"]);
const operations = new Set<Op>(["const", ...fields, ...numericUnary, ...numericBinary, ...comparisons,
  ...periodic, "is_na", "nz", "and", "or", "not", "select", "history", "persistent"]);
const encoder = new TextEncoder();
const utf8Length = (value: string) => encoder.encode(value).length;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
const programKeys = ["version", "compilerVersion", "pineVersion", "title", "sourceHash", "configHash", "nodes", "layouts", "orders", "outputs", "stateCells", "maxHistory", "inputs"];
const nodeKeys = ["op", "type", "a", "b", "c", "value", "period", "line"];
const layoutKeys = ["historyOffset", "historyLength", "auxOffset", "auxLength"];
const orderKeys = ["kind", "id", "side", "condition", "quantity"];
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function fail(message: string): never { throw new Error(`Invalid Pine IR: ${message}`); }

/** Validate serialized IR before interpreting it or emitting executable source.
 * Current-bar edges must be a DAG. Positive history edges and persistent reads
 * may point forward because they read the previous bar's final committed value.
 * The same structural invariants are enforced by the native Program validator.
 */
export function validateProgramIR(value: unknown): asserts value is ProgramIR {
  if (!record(value) || !exactKeys(value, programKeys) || value.version !== IR_VERSION || value.compilerVersion !== SOLANA_COMPILER_VERSION || ![4, 5, 6].includes(value.pineVersion as number)) fail("unsupported schema or version");
  if (typeof value.title !== "string" || utf8Length(value.title) > 128_000 || typeof value.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(value.sourceHash) || typeof value.configHash !== "string" || !/^[0-9a-f]{64}$/.test(value.configHash)) fail("invalid metadata or hashes");
  if (!uint(value.stateCells) || value.stateCells > 900 || !uint(value.maxHistory) || value.maxHistory < 1 || value.maxHistory > 1024) fail("unbounded state or history");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 256 || !Array.isArray(value.layouts) || value.layouts.length !== value.nodes.length || !Array.isArray(value.orders) || value.orders.length > 16) fail("invalid node, layout or order count");
  if (!record(value.outputs) || Object.keys(value.outputs).length > 20_000 || !record(value.inputs) || Object.keys(value.inputs).length > 128) fail("invalid output or input map");
  const n = value.nodes.length;
  const validIndex = (id: unknown): id is number => uint(id) && id < n;

  // Inspect every array index explicitly; sparse arrays must not evade checks.
  for (let i = 0; i < n; i++) {
    const node = value.nodes[i], layout = value.layouts[i];
    if (!record(node) || !exactKeys(node, nodeKeys) || !operations.has(node.op as Op) || !["number", "bool"].includes(node.type as string) || ![node.a, node.b, node.c].every(validIndex) || !uint(node.period) || node.period > value.maxHistory || !uint(node.line) || node.line === 0) fail(`invalid node ${i}`);
    if (node.value !== null && (typeof node.value !== "number" || !Number.isFinite(node.value))) fail(`invalid literal at node ${i}`);
    if (node.op !== "const" && node.value !== null) fail(`nonliteral node ${i} has a literal value`);
    if (node.op === "const" && node.type === "bool" && node.value !== 0 && node.value !== 1 && !(value.pineVersion !== 6 && node.value === null)) fail(`invalid boolean literal at node ${i}`);
    if (periodic.has(node.op as Op) ? node.period === 0 : node.op !== "history" && node.period !== 0) fail(`invalid period at node ${i}`);
    if (!record(layout) || !exactKeys(layout, layoutKeys) || ![layout.historyOffset, layout.historyLength, layout.auxOffset, layout.auxLength].every(uint) || (layout.historyLength as number) > value.maxHistory) fail(`invalid layout at node ${i}`);
  }

  // All required shapes are known now; graph references cannot access holes.
  const ir = value as unknown as ProgramIR;
  const used = new Uint8Array(ir.stateCells);
  for (let i = 0; i < n; i++) {
    const node = ir.nodes[i], layout = ir.layouts[i];
    const before = (id: number) => { if (id >= i) fail(`current-bar dependency of node ${i} is not earlier in the graph`); };
    const sameType = (id: number) => { if (ir.nodes[id].type !== node.type) fail(`type mismatch at node ${i}`); };
    const numeric = (...ids: number[]) => { if (node.type !== "number" || ids.some(id => ir.nodes[id].type !== "number")) fail(`numeric type mismatch at node ${i}`); };
    const boolean = (...ids: number[]) => { if (node.type !== "bool" || ids.some(id => ir.nodes[id].type !== "bool")) fail(`boolean type mismatch at node ${i}`); };
    if (fields.has(node.op)) numeric();
    else if (numericUnary.has(node.op) || periodic.has(node.op)) { before(node.a); numeric(node.a); }
    else if (numericBinary.has(node.op)) { before(node.a); before(node.b); numeric(node.a, node.b); }
    else if (comparisons.has(node.op)) {
      before(node.a); before(node.b);
      if (node.type !== "bool" || ir.nodes[node.a].type !== ir.nodes[node.b].type) fail(`comparison type mismatch at node ${i}`);
    } else if (node.op === "and" || node.op === "or") { before(node.a); before(node.b); boolean(node.a, node.b); }
    else if (node.op === "not") { before(node.a); boolean(node.a); }
    else if (node.op === "is_na") { before(node.a); boolean(); }
    else if (node.op === "nz") { before(node.a); before(node.b); sameType(node.a); sameType(node.b); }
    else if (node.op === "select") {
      // Numeric conditions are used only by the compiler's explicit truth cast.
      before(node.a); before(node.b); before(node.c); sameType(node.b); sameType(node.c);
    } else if (node.op === "history") {
      if (node.period === 0) before(node.a);
      sameType(node.a);
      if (ir.layouts[node.a].historyLength < node.period) fail(`history storage missing at node ${i}`);
    } else if (node.op === "persistent") {
      before(node.b); sameType(node.a); sameType(node.b);
      if (ir.layouts[node.a].historyLength < 1) fail(`persistent storage missing at node ${i}`);
    }
    if (node.op === "checked_int") {
      before(node.b);
      if (ir.nodes[node.b].type !== "bool") fail(`integer range guard is not boolean at node ${i}`);
    }
    if ((node.op === "ema" || node.op === "rma") && layout.historyLength < 1) fail(`recursive average storage missing at node ${i}`);
    if (["highest", "lowest", "sum"].includes(node.op) && ir.layouts[node.a].historyLength < node.period - 1) fail(`window history missing at node ${i}`);
    const aux = averages.has(node.op) ? node.period + 2 : node.op === "rma" ? 2 : 0;
    if (layout.auxLength !== aux) fail(`wrong auxiliary storage at node ${i}`);
    for (const [offset, length] of [[layout.historyOffset, layout.historyLength], [layout.auxOffset, layout.auxLength]]) {
      if (offset > ir.stateCells || length > ir.stateCells - offset) fail(`state range outside allocation at node ${i}`);
      for (let cell = offset; cell < offset + length; cell++) {
        if (used[cell]) fail(`overlapping state layout at node ${i}`);
        used[cell] = 1;
      }
    }
  }
  if (used.some(cell => cell === 0)) fail("state allocation contains unowned cells");
  for (let i = 0; i < ir.orders.length; i++) {
    const order: unknown = ir.orders[i];
    if (!record(order) || !exactKeys(order, orderKeys) || !["entry", "close", "close_all"].includes(order.kind as string) || typeof order.id !== "string" || utf8Length(order.id) > 64 || !validIndex(order.condition) || ir.nodes[order.condition].type !== "bool") fail(`invalid order ${i}`);
    if (order.kind === "entry") {
      if ((order.side !== -1 && order.side !== 1) || !validIndex(order.quantity) || ir.nodes[order.quantity].type !== "number") fail(`invalid entry ${i}`);
    } else if (order.side !== 0 || order.quantity !== null || (order.kind === "close_all" && order.id !== "")) fail(`invalid close ${i}`);
  }
  let outputBytes = 0;
  for (const [name, id] of Object.entries(ir.outputs)) {
    if (!identifier.test(name) || !validIndex(id)) fail("invalid output name or node reference");
    outputBytes += utf8Length(name);
    if (outputBytes > 128_000) fail("output names exceed the source-size limit");
  }
  let metadataBytes = 0;
  for (const [name, input] of Object.entries(ir.inputs)) {
    if (!identifier.test(name) || (typeof input !== "string" && typeof input !== "boolean" && (typeof input !== "number" || !Number.isFinite(input)))) fail("invalid resolved input");
    metadataBytes += utf8Length(name) + (typeof input === "string" ? utf8Length(input) : 0);
    if (metadataBytes > 65_536) fail("resolved input metadata exceeds the limit");
  }
  assertProgramCommitment(ir);
}

/** Detach the interpreter from caller-owned mutable arrays and maps. */
export function copyProgramIR(ir: ProgramIR): ProgramIR {
  return { ...ir, nodes: ir.nodes.map(node => ({ ...node })), layouts: ir.layouts.map(layout => ({ ...layout })),
    orders: ir.orders.map(order => ({ ...order })), outputs: Object.assign(Object.create(null), ir.outputs),
    inputs: Object.assign(Object.create(null), ir.inputs) };
}

/** State shape validation, not proof of historical candle provenance. */
export function validateRuntimeData(ir: ProgramIR, bars: number, data: number[]): void {
  const invalid = (): never => { throw new Error("Invalid Pine runtime state"); };
  if (!Number.isSafeInteger(bars) || bars < 0 || data.length !== ir.stateCells) invalid();
  for (const value of data) if (typeof value !== "number" || (!Number.isFinite(value) && !Number.isNaN(value))) invalid();
  for (let i = 0; i < ir.nodes.length; i++) {
    const node: Node = ir.nodes[i], layout = ir.layouts[i];
    for (let k = 0; k < layout.historyLength; k++) {
      const value = data[layout.historyOffset + k], written = bars >= layout.historyLength || k < bars;
      if (!written && !Number.isNaN(value)) invalid();
      if (written && node.type === "bool" && value !== 0 && value !== 1 && !(ir.pineVersion < 6 && Number.isNaN(value))) invalid();
    }
    if (averages.has(node.op)) {
      const base = layout.auxOffset, count = data[base], head = data[base + 1];
      if (bars === 0) {
        for (let k = 0; k < layout.auxLength; k++) if (!Number.isNaN(data[base + k])) invalid();
        continue;
      }
      if (!Number.isInteger(count) || count < 0 || count > Math.min(bars, node.period) || !Number.isInteger(head) || head < 0 || head >= node.period || (count < node.period && head !== count)) invalid();
      for (let k = 0; k < node.period; k++) {
        const sample = data[base + 2 + k];
        if (k < count ? !Number.isFinite(sample) : !Number.isNaN(sample)) invalid();
      }
    } else if (node.op === "rma") {
      const count = data[layout.auxOffset], sum = data[layout.auxOffset + 1];
      const previous = bars === 0 ? NaN : data[layout.historyOffset + (bars - 1) % layout.historyLength];
      if (Number.isNaN(count)) {
        if (!Number.isNaN(sum) || !Number.isNaN(previous)) invalid();
      } else if (!Number.isInteger(count) || count < 1 || count > Math.min(bars, node.period) || !Number.isFinite(sum) || (count < node.period ? !Number.isNaN(previous) : !Number.isFinite(previous))) invalid();
    }
  }
}
