/**
 * Move v2 Code Generator — IndicatorIR → complete Move module
 *
 * Takes a structured IndicatorIR (from pine-ir.ts) and produces a syntactically
 * correct Move v2 module that can be compiled and deployed to Aptos. The generated
 * module follows the patterns from indicator.move (Object-based state, sliding
 * price buffer, signal detection, position tracking, events, view functions).
 *
 * The IR decouples the PineScript parser from Move output — any frontend that
 * produces an IndicatorIR can generate a deployable on-chain indicator.
 */

import type {
  IndicatorIR,
  IRStateField,
  IRTAOp,
  IRExpr,
  IRValue,
  IRSignalLogic,
} from "./pine-ir";

import { renderTAFunctions } from "./move-ta-lib";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(indent: number): string {
  return " ".repeat(indent);
}

function sanitizeModuleName(name: string): string {
  // Move module names: lowercase alphanumeric + underscores, must start with a letter
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^[^a-z]+/, "indicator_")
    .replace(/_+/g, "_")
    .replace(/_$/, "");
  return cleaned || "indicator_custom";
}

// ─── Main Entry ───────────────────────────────────────────────────────────────

/**
 * Generate a complete, syntactically correct Move v2 module from an IndicatorIR.
 */
export function generateMoveModule(ir: IndicatorIR): string {
  const lines: string[] = [];
  const moduleName = sanitizeModuleName(ir.moduleName);
  const creatorAddr = ir.creatorAddr || "0xcreator";

  // Module header
  lines.push(
    `module ${moduleName}::indicator {`,
  );
  lines.push(`    use std::vector;`);
  lines.push(`    use std::signer;`);
  lines.push(`    use aptos_framework::account;`);
  lines.push(`    use aptos_framework::event;`);
  lines.push(``);

  // Error codes
  lines.push(`    // ── Error Codes ────────────────────────────────────────────`);
  lines.push(`    const E_NOT_KEEPER: u64 = 1;`);
  lines.push(`    const E_INSUFFICIENT_DATA: u64 = 3;`);
  lines.push(``);

  // Signal constants
  lines.push(`    // ── Signal Constants ───────────────────────────────────────`);
  lines.push(`    const SIGNAL_NEUTRAL: u8 = 0;`);
  lines.push(`    const SIGNAL_BUY: u8 = 1;`);
  lines.push(`    const SIGNAL_SELL: u8 = 2;`);
  lines.push(``);

  // Scale
  lines.push(`    // ── Scale for fixed-point arithmetic (1e8) ─────────────────`);
  lines.push(`    const SCALE: u64 = 100_000_000;`);
  lines.push(``);

  // IndicatorState struct
  lines.push(generateStruct(ir.stateFields, 4));
  lines.push(``);

  // PriceBuffer struct
  lines.push(`    struct PriceBuffer has key {`);
  lines.push(`        prices: vector<u64>,`);
  lines.push(`        timestamps: vector<u64>,`);
  lines.push(`        capacity: u64,`);
  lines.push(`    }`);
  lines.push(``);

  // Events
  lines.push(generateEvents(ir, 4));
  lines.push(``);

  // init_module
  lines.push(generateInitModule(ir, 4));
  lines.push(``);

  // push_price
  lines.push(generatePushPrice(ir, 4));
  lines.push(``);

  // TA helper functions — merge op-derived and IR-explicit lists
  const collectedFuncs = collectNeededTAFunctions(ir.taOps);
  const irFuncs = ir.neededTAFunctions ?? [];
  const neededTAFuncs = [...new Set([...collectedFuncs, ...irFuncs])];
  if (neededTAFuncs.length > 0) {
    lines.push(
      `    // ── TA Helper Functions ────────────────────────────────────`,
    );
    lines.push(renderTAFunctions(neededTAFuncs, 4));
    lines.push(``);
  }

  // Emit custom functions from IR
  const funcDefs = (ir as any).funcDefs;
  if (funcDefs?.length) {
    lines.push(`    // ── Custom Functions ────────────────────────────────────`);
    for (const def of funcDefs) {
      lines.push(generateFuncDef(def, 4));
      lines.push(``);
    }
  }

  // View functions
  lines.push(generateViewFunctions(ir, 4));

  // Close module
  lines.push(`}`);

  return lines.join("\n");
}

// ─── Struct Generation ────────────────────────────────────────────────────────

function generateStruct(fields: IRStateField[], indent: number): string {
  const p = pad(indent);
  const lines: string[] = [];

  lines.push(`${p}struct IndicatorState has key {`);
  lines.push(`${p}    keeper: address,`);
  lines.push(`${p}    owner: address,`);

  // User-defined TA state fields from IR (exclude standard fields to avoid duplicates)
  const standardFields = new Set([
    "last_signal", "last_signal_time", "total_signals", "total_prices_pushed",
    "last_price", "in_position", "entry_price", "realized_gain_bps", "realized_loss_bps",
  ]);
  for (const field of fields) {
    if (!standardFields.has(field.name)) {
      lines.push(`${p}    ${field.name}: ${irTypeToMove(field.moveType)},`);
    }
  }

  // Standard tracking fields
  lines.push(`${p}    last_signal: u8,`);
  lines.push(`${p}    last_signal_time: u64,`);
  lines.push(`${p}    total_signals: u64,`);
  lines.push(`${p}    total_prices_pushed: u64,`);
  lines.push(`${p}    last_price: u64,`);
  lines.push(`${p}    in_position: bool,`);
  lines.push(`${p}    entry_price: u64,`);
  lines.push(`${p}    realized_gain_bps: u64,`);
  lines.push(`${p}    realized_loss_bps: u64,`);
  lines.push(`${p}}`);

  return lines.join("\n");
}

function irTypeToMove(t: string): string {
  switch (t) {
    case "u64":
      return "u64";
    case "u128":
      return "u128";
    case "bool":
      return "bool";
    case "u8":
      return "u8";
    default:
      return "u64";
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function generateEvents(ir: IndicatorIR, indent: number): string {
  const p = pad(indent);
  const lines: string[] = [];

  // Determine the two main TA fields for the SignalEvent
  const taFields = getTAFieldNames(ir);

  lines.push(`${p}#[event]`);
  lines.push(`${p}struct SignalEvent has drop, store {`);
  lines.push(`${p}    signal: u8,`);
  lines.push(`${p}    price: u64,`);
  lines.push(`${p}    ${taFields.fast}: u64,`);
  lines.push(`${p}    ${taFields.slow}: u64,`);
  lines.push(`${p}    timestamp: u64,`);
  lines.push(`${p}}`);
  lines.push(``);

  lines.push(`${p}#[event]`);
  lines.push(`${p}struct PricePushed has drop, store {`);
  lines.push(`${p}    price: u64,`);
  lines.push(`${p}    signal: u8,`);
  lines.push(`${p}    prices_buffered: u64,`);
  lines.push(`${p}    timestamp: u64,`);
  lines.push(`${p}}`);

  return lines.join("\n");
}

// ─── Init Module ──────────────────────────────────────────────────────────────

function generateInitModule(ir: IndicatorIR, indent: number): string {
  const p = pad(indent);
  const p2 = pad(indent + 4);
  const p3 = pad(indent + 8);
  const lines: string[] = [];

  lines.push(`${p}/// Called once on publish. Creates a resource account with a unique`);
  lines.push(`${p}/// address derived from the deployer + module name seed.`);
  lines.push(`${p}fun init_module(deployer: &signer) {`);
  lines.push(`${p2}let creator_addr = signer::address_of(deployer);`);
  lines.push(`${p2}// Resource account: indicator gets its own unique on-chain address`);
  lines.push(`${p2}let (resource_signer, _signer_cap) = account::create_resource_account(deployer, b"${ir.moduleName}");`);
  lines.push(`${p2}let obj_signer = &resource_signer;`);
  lines.push(``);

  // IndicatorState init
  lines.push(`${p2}move_to(obj_signer, IndicatorState {`);
  lines.push(`${p3}keeper: creator_addr,`);
  lines.push(`${p3}owner: creator_addr,`);

  // IR state fields with their init values
  const standardFieldsInit = new Set([
    "last_signal", "last_signal_time", "total_signals", "total_prices_pushed",
    "last_price", "in_position", "entry_price", "realized_gain_bps", "realized_loss_bps",
  ]);
  for (const field of ir.stateFields) {
    if (!standardFieldsInit.has(field.name)) {
      lines.push(`${p3}${field.name}: ${field.initValue},`);
    }
  }

  // Standard tracking fields
  lines.push(`${p3}last_signal: SIGNAL_NEUTRAL,`);
  lines.push(`${p3}last_signal_time: 0,`);
  lines.push(`${p3}total_signals: 0,`);
  lines.push(`${p3}total_prices_pushed: 0,`);
  lines.push(`${p3}last_price: 0,`);
  lines.push(`${p3}in_position: false,`);
  lines.push(`${p3}entry_price: 0,`);
  lines.push(`${p3}realized_gain_bps: 0,`);
  lines.push(`${p3}realized_loss_bps: 0,`);
  lines.push(`${p2}});`);
  lines.push(``);

  // PriceBuffer init
  lines.push(`${p2}move_to(obj_signer, PriceBuffer {`);
  lines.push(`${p3}prices: vector::empty<u64>(),`);
  lines.push(`${p3}timestamps: vector::empty<u64>(),`);
  lines.push(`${p3}capacity: ${ir.bufferCapacity},`);
  lines.push(`${p2}});`);

  lines.push(`${p}}`);

  return lines.join("\n");
}

// ─── Push Price ───────────────────────────────────────────────────────────────

function generatePushPrice(ir: IndicatorIR, indent: number): string {
  const p = pad(indent);
  const p2 = pad(indent + 4);
  const p3 = pad(indent + 8);
  const lines: string[] = [];

  const taFields = getTAFieldNames(ir);

  // Caller-supplied prices stay keeper-gated; the oracle crank path (which
  // reads the price on-chain) goes through push_price_unchecked instead.
  // NOTE: under object publish, init_module's creator is the package object —
  // an unsignable address — so for rail-deployed packages the keeper gate
  // means "never": the oracle is the only price source, by design.
  lines.push(`${p}public entry fun push_price(`);
  lines.push(`${p2}keeper_signer: &signer,`);
  lines.push(`${p2}indicator_addr: address,`);
  lines.push(`${p2}price: u64,`);
  lines.push(`${p2}ts: u64,`);
  lines.push(`${p}) acquires IndicatorState, PriceBuffer {`);
  lines.push(
    `${p2}assert!(signer::address_of(keeper_signer) == borrow_global<IndicatorState>(indicator_addr).keeper, E_NOT_KEEPER);`,
  );
  lines.push(`${p2}push_price_unchecked(indicator_addr, price, ts);`);
  lines.push(`${p}}`);
  lines.push(``);
  lines.push(`${p}fun push_price_unchecked(`);
  lines.push(`${p2}indicator_addr: address,`);
  lines.push(`${p2}price: u64,`);
  lines.push(`${p2}ts: u64,`);
  lines.push(`${p}) acquires IndicatorState, PriceBuffer {`);

  // Borrow state
  lines.push(
    `${p2}let state = borrow_global_mut<IndicatorState>(indicator_addr);`,
  );
  lines.push(
    `${p2}let buf = borrow_global_mut<PriceBuffer>(indicator_addr);`,
  );
  lines.push(``);

  // Sliding window
  lines.push(`${p2}// Sliding window`);
  lines.push(
    `${p2}if (vector::length(&buf.prices) >= buf.capacity) {`,
  );
  lines.push(`${p3}vector::remove(&mut buf.prices, 0);`);
  lines.push(`${p3}vector::remove(&mut buf.timestamps, 0);`);
  lines.push(`${p2}};`);
  lines.push(`${p2}vector::push_back(&mut buf.prices, price);`);
  lines.push(`${p2}vector::push_back(&mut buf.timestamps, ts);`);
  lines.push(
    `${p2}state.total_prices_pushed = state.total_prices_pushed + 1;`,
  );
  lines.push(``);

  lines.push(`${p2}let buf_len = vector::length(&buf.prices);`);
  lines.push(``);

  // Snapshot previous values for crossover detection
  const prevFields = collectPrevFields(ir);
  if (prevFields.length > 0) {
    lines.push(`${p2}// Snapshot previous values for crossover detection`);
    for (const fieldName of prevFields) {
      lines.push(
        `${p2}let prev_${fieldName} = state.${fieldName};`,
      );
    }
    lines.push(``);
  }

  // Warmup check and TA computation
  lines.push(`${p2}// Warmup check`);
  lines.push(`${p2}if (buf_len >= ${ir.warmupMinBars}) {`);

  // TA operations
  lines.push(`${p3}// TA computations`);
  for (const op of ir.taOps) {
    lines.push(generateTAOp(op, indent + 8));
  }
  lines.push(``);

  // Signal detection
  lines.push(`${p3}// Signal detection`);
  lines.push(generateSignalDetection(ir.signalLogic, indent + 8));
  lines.push(``);

  // Signal change handling
  lines.push(`${p3}// Signal change handling`);
  lines.push(
    `${p3}if (new_signal != state.last_signal && (new_signal == SIGNAL_BUY || new_signal == SIGNAL_SELL)) {`,
  );
  const p4 = pad(indent + 12);
  lines.push(
    `${p4}state.total_signals = state.total_signals + 1;`,
  );
  lines.push(`${p4}state.last_signal_time = ts;`);
  lines.push(``);

  // Position tracking
  lines.push(`${p4}// Position tracking`);
  lines.push(`${p4}if (new_signal == SIGNAL_BUY) {`);
  const p5 = pad(indent + 16);
  lines.push(`${p5}state.in_position = true;`);
  lines.push(`${p5}state.entry_price = price;`);
  lines.push(
    `${p4}} else if (new_signal == SIGNAL_SELL && state.in_position) {`,
  );
  lines.push(`${p5}// P&L calculation`);
  lines.push(`${p5}if (state.entry_price > 0) {`);
  const p6 = pad(indent + 20);
  lines.push(`${p6}if (price > state.entry_price) {`);
  const p7 = pad(indent + 24);
  lines.push(
    `${p7}state.realized_gain_bps = state.realized_gain_bps + (price - state.entry_price) * 10000 / state.entry_price;`,
  );
  lines.push(`${p6}} else {`);
  lines.push(
    `${p7}state.realized_loss_bps = state.realized_loss_bps + (state.entry_price - price) * 10000 / state.entry_price;`,
  );
  lines.push(`${p6}};`);
  lines.push(`${p5}};`);
  lines.push(`${p5}state.in_position = false;`);
  lines.push(`${p4}};`);
  lines.push(``);

  // Emit SignalEvent
  lines.push(`${p4}event::emit(SignalEvent {`);
  const p5e = pad(indent + 16);
  lines.push(`${p5e}signal: new_signal,`);
  lines.push(`${p5e}price,`);
  lines.push(
    `${p5e}${taFields.fast}: state.${taFields.fast},`,
  );
  lines.push(
    `${p5e}${taFields.slow}: state.${taFields.slow},`,
  );
  lines.push(`${p5e}timestamp: ts,`);
  lines.push(`${p4}});`);

  // Close signal change block
  lines.push(`${p3}};`);
  lines.push(``);
  lines.push(`${p3}state.last_signal = new_signal;`);

  // Close warmup check
  lines.push(`${p2}};`);
  lines.push(``);

  // Update last_price and emit PricePushed
  lines.push(`${p2}state.last_price = price;`);
  lines.push(`${p2}event::emit(PricePushed {`);
  lines.push(`${p3}price,`);
  lines.push(`${p3}signal: state.last_signal,`);
  lines.push(`${p3}prices_buffered: buf_len,`);
  lines.push(`${p3}timestamp: ts,`);
  lines.push(`${p2}});`);

  lines.push(`${p}}`);

  return lines.join("\n");
}

// ─── TA Op Generation ─────────────────────────────────────────────────────────

function renderIRValue(v: IRValue): string {
  return v.kind === "literal" ? String(v.value) : `state.${v.name}`;
}

function generateTAOp(op: IRTAOp, indent: number): string {
  const p = pad(indent);
  const lines: string[] = [];

  switch (op.kind) {
    case "sma":
      lines.push(`${p}let ${op.target} = compute_sma(&buf.prices, ${renderIRValue(op.period)});`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    case "ema":
      lines.push(`${p}let ${op.target} = compute_ema(&buf.prices, ${renderIRValue(op.period)});`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    case "rsi":
      lines.push(`${p}let ${op.target} = compute_rsi(&buf.prices, ${renderIRValue(op.period)});`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    case "macd": {
      const fastP = renderIRValue(op.fast);
      const slowP = renderIRValue(op.slow);
      const sigP = renderIRValue(op.signal);
      lines.push(`${p}// MACD computation`);
      lines.push(`${p}let macd_fast_ema = compute_ema(&buf.prices, ${fastP});`);
      lines.push(`${p}let macd_slow_ema = compute_ema(&buf.prices, ${slowP});`);
      lines.push(`${p}let ${op.targetLine}: u64 = if (macd_fast_ema >= macd_slow_ema) {`);
      lines.push(`${p}    100_000_000_000_000 + (macd_fast_ema - macd_slow_ema)`);
      lines.push(`${p}} else {`);
      lines.push(`${p}    let diff = macd_slow_ema - macd_fast_ema;`);
      lines.push(`${p}    if (diff >= 100_000_000_000_000) { 1 } else { 100_000_000_000_000 - diff }`);
      lines.push(`${p}};`);
      lines.push(`${p}let k_scaled: u128 = 2_000_000 / ((${sigP} + 1) as u128);`);
      lines.push(`${p}let k_inv: u128 = 1_000_000 - k_scaled;`);
      lines.push(`${p}let ${op.targetSignal}: u64 = if (state.${op.targetSignal} == 0) { ${op.targetLine} } else {`);
      lines.push(`${p}    let updated = ((${op.targetLine} as u128) * k_scaled + (state.${op.targetSignal} as u128) * k_inv) / 1_000_000;`);
      lines.push(`${p}    (updated as u64)`);
      lines.push(`${p}};`);
      lines.push(`${p}state.${op.targetLine} = ${op.targetLine};`);
      lines.push(`${p}state.${op.targetSignal} = ${op.targetSignal};`);
      break;
    }

    case "bb": {
      const bbPeriod = renderIRValue(op.period);
      const bbMult = renderIRValue(op.multiplier);
      lines.push(`${p}// Bollinger Bands`);
      lines.push(`${p}let ${op.targetMid} = compute_sma(&buf.prices, ${bbPeriod});`);
      lines.push(`${p}let (${op.targetUpper}, ${op.targetLower}) = compute_bollinger_bands(&buf.prices, ${bbPeriod}, ${op.targetMid}, ${bbMult});`);
      lines.push(`${p}state.${op.targetUpper} = ${op.targetUpper};`);
      lines.push(`${p}state.${op.targetLower} = ${op.targetLower};`);
      break;
    }

    case "stoch": {
      const kP = renderIRValue(op.kPeriod);
      const dP = renderIRValue(op.dPeriod);
      lines.push(`${p}// Stochastic %K and %D`);
      lines.push(`${p}// (simplified: uses highest/lowest of price buffer)`);
      lines.push(`${p}let stoch_hh = compute_highest(&buf.prices, ${kP});`);
      lines.push(`${p}let stoch_ll = compute_lowest(&buf.prices, ${kP});`);
      lines.push(`${p}let ${op.targetK}: u64 = if (stoch_hh == stoch_ll) { 50_00000000 } else {`);
      lines.push(`${p}    (((price - stoch_ll) as u128) * 100_00000000u128 / ((stoch_hh - stoch_ll) as u128)) as u64`);
      lines.push(`${p}};`);
      lines.push(`${p}// %D = smoothed %K (simplified as EMA-like blend with previous)`);
      lines.push(`${p}let ${op.targetD}: u64 = if (state.${op.targetD} == 0) { ${op.targetK} } else {`);
      lines.push(`${p}    ((${op.targetK} as u128 + state.${op.targetD} as u128 * (${dP} as u128 - 1)) / (${dP} as u128)) as u64`);
      lines.push(`${p}};`);
      lines.push(`${p}state.${op.targetK} = ${op.targetK};`);
      lines.push(`${p}state.${op.targetD} = ${op.targetD};`);
      break;
    }

    case "supertrend": {
      const stAtr = renderIRValue(op.atrPeriod);
      const stMult = renderIRValue(op.multiplier);
      lines.push(`${p}// SuperTrend`);
      lines.push(`${p}let st_atr = compute_sma(&buf.prices, ${stAtr}); // ATR approximation`);
      lines.push(`${p}let band_offset = ((st_atr as u128) * (${stMult} as u128) / 10) as u64;`);
      lines.push(`${p}let upper_band = price + band_offset;`);
      lines.push(`${p}let lower_band = if (price >= band_offset) { price - band_offset } else { 0 };`);
      lines.push(`${p}let ${op.targetDir}: u64 = if (price > upper_band) { 1 }`);
      lines.push(`${p}    else if (lower_band > 0 && price < lower_band) { 2 }`);
      lines.push(`${p}    else if (state.${op.targetDir} == 0) { 0 }`);
      lines.push(`${p}    else { state.${op.targetDir} };`);
      lines.push(`${p}state.${op.targetDir} = ${op.targetDir};`);
      lines.push(`${p}state.${op.targetLine} = st_atr;`);
      break;
    }

    case "highest":
      lines.push(`${p}let ${op.target} = compute_highest(&buf.prices, ${renderIRValue(op.period)});`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    case "lowest":
      lines.push(`${p}let ${op.target} = compute_lowest(&buf.prices, ${renderIRValue(op.period)});`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    case "atr": {
      const atrP = renderIRValue(op.period);
      lines.push(`${p}// ATR (Wilder's smoothing)`);
      lines.push(`${p}let ${op.target}: u64 = if (state.${op.target} == 0) {`);
      lines.push(`${p}    compute_sma(&buf.prices, ${atrP}) // cold start`);
      lines.push(`${p}} else {`);
      lines.push(`${p}    let prev_close = *vector::borrow(&buf.prices, buf_len - 2) as u128;`);
      lines.push(`${p}    let tr = if (price as u128 >= prev_close) { ((price as u128) - prev_close) * 2 } else { (prev_close - (price as u128)) * 2 };`);
      lines.push(`${p}    (((state.${op.target} as u128) * ((${atrP} - 1) as u128) + tr) / (${atrP} as u128)) as u64`);
      lines.push(`${p}};`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;
    }

    case "crossover":
      lines.push(`${p}let ${op.target} = (state.prev_${op.seriesA} <= state.prev_${op.seriesB}) && (state.${op.seriesA} > state.${op.seriesB});`);
      break;

    case "crossunder":
      lines.push(`${p}let ${op.target} = (state.prev_${op.seriesA} >= state.prev_${op.seriesB}) && (state.${op.seriesA} < state.${op.seriesB});`);
      break;

    case "assign":
      lines.push(`${p}let ${op.target} = ${generateIRExpr(op.expr)};`);
      lines.push(`${p}state.${op.target} = ${op.target};`);
      break;

    // V3: statement-level nodes
    case "if": {
      const op2 = op as any;
      lines.push(`${p}if (${generateIRExpr(op2.cond)}) {`);
      for (const s of op2.then) lines.push(generateTAOp(s, indent + 4));
      if (op2.els?.length) {
        lines.push(`${p}} else {`);
        for (const s of op2.els) lines.push(generateTAOp(s, indent + 4));
      }
      lines.push(`${p}};`);
      break;
    }

    case "while": {
      const op2 = op as any;
      const iterVar = `_iter_${Date.now() % 1000}`;
      lines.push(`${p}let ${iterVar}: u64 = 0;`);
      lines.push(`${p}while (${generateIRExpr(op2.cond)} && ${iterVar} < ${op2.maxIters}) {`);
      for (const s of op2.body) lines.push(generateTAOp(s, indent + 4));
      lines.push(`${pad(indent + 4)}${iterVar} = ${iterVar} + 1;`);
      lines.push(`${p}};`);
      break;
    }

    case "for": {
      const op2 = op as any;
      const iterVar = `_iter_${Date.now() % 1000}`;
      lines.push(`${p}let ${op2.varName}: u64 = ${generateIRExpr(op2.start)};`);
      lines.push(`${p}let ${iterVar}: u64 = 0;`);
      lines.push(`${p}while (${op2.varName} < ${generateIRExpr(op2.end)} && ${iterVar} < ${op2.maxIters}) {`);
      for (const s of op2.body) lines.push(generateTAOp(s, indent + 4));
      lines.push(`${pad(indent + 4)}${op2.varName} = ${op2.varName} + ${generateIRExpr(op2.step)};`);
      lines.push(`${pad(indent + 4)}${iterVar} = ${iterVar} + 1;`);
      lines.push(`${p}};`);
      break;
    }

    case "let": {
      const op2 = op as any;
      lines.push(`${p}let ${op2.name}: ${op2.moveType} = ${generateIRExpr(op2.expr)};`);
      break;
    }

    case "state_update": {
      const op2 = op as any;
      lines.push(`${p}state.${op2.field} = ${generateIRExpr(op2.expr)};`);
      break;
    }

    case "noop": {
      const op2 = op as any;
      if (op2.comment) lines.push(`${p}// ${op2.comment}`);
      break;
    }
  }

  return lines.join("\n");
}

// ─── Expression Generation ────────────────────────────────────────────────────

function generateIRExpr(expr: IRExpr): string {
  switch (expr.kind) {
    case "lit_u64":
      return String(expr.value);

    case "lit_bool":
      return expr.value ? "true" : "false";

    case "field_ref":
      return `state.${expr.field}`;

    case "price":
      return "price";

    case "prev_field":
      return `prev_${expr.field}`;

    case "binop": {
      const left = generateIRExpr(expr.left);
      const right = generateIRExpr(expr.right);
      switch (expr.op) {
        case "+":
          return `(${left} + ${right})`;
        case "-":
          return `(${left} - ${right})`;
        case "*":
          return `(${left} * ${right})`;
        case "/":
          return `(${left} / ${right})`;
        case ">":
          return `(${left} > ${right})`;
        case "<":
          return `(${left} < ${right})`;
        case ">=":
          return `(${left} >= ${right})`;
        case "<=":
          return `(${left} <= ${right})`;
        case "==":
          return `(${left} == ${right})`;
        case "!=":
          return `(${left} != ${right})`;
        case "&&":
          return `(${left} && ${right})`;
        case "||":
          return `(${left} || ${right})`;
        default:
          return `(${left} ${expr.op} ${right})`;
      }
    }

    case "scaled_mul": {
      const left = generateIRExpr(expr.left);
      const right = generateIRExpr(expr.right);
      // Outer parens required: `as` and if-expressions bind looser than the
      // operators callers embed this into (`a / X as u64` casts only X).
      return `(((((${left}) as u128) * ((${right}) as u128)) / (SCALE as u128)) as u64)`;
    }

    case "safe_sub": {
      const left = generateIRExpr(expr.left);
      const right = generateIRExpr(expr.right);
      return `(if (${left} >= ${right}) { ${left} - ${right} } else { 0 })`;
    }

    case "ternary": {
      const cond = generateIRExpr(expr.cond);
      const yes = generateIRExpr(expr.yes);
      const no = generateIRExpr(expr.no);
      return `(if (${cond}) { ${yes} } else { ${no} })`;
    }

    case "unop":
      return `${expr.op === "!" ? "!" : "-"}(${generateIRExpr(expr.expr)})`;

    case "call": {
      const args = expr.args.map(generateIRExpr);
      // TA compute functions need &buf.prices as first arg
      if (expr.fn.startsWith("compute_") && !args[0]?.includes("buf.prices")) {
        args.unshift("&buf.prices");
      }
      return `${expr.fn}(${args.join(", ")})`;
    }

    // V3: extended expressions
    case "series_index": {
      const e = expr as any;
      if (e.name === "close" || e.name === "price") {
        return `*vector::borrow(&buf.prices, buf_len - 1 - ${e.offset})`;
      }
      return `*vector::borrow(&buf.prices, buf_len - 1 - ${e.offset})`;
    }

    case "div": {
      const e = expr as any;
      const l = generateIRExpr(e.left);
      const r = generateIRExpr(e.right);
      return `(if (${r} == 0) { 0 } else { ((((${l}) as u128) * (SCALE as u128) / ((${r}) as u128)) as u64) })`;
    }

    case "abs": {
      const inner = generateIRExpr((expr as any).expr);
      return `${inner}`;  // u64 is always non-negative
    }

    case "max": {
      const e = expr as any;
      const l = generateIRExpr(e.left);
      const r = generateIRExpr(e.right);
      return `if (${l} >= ${r}) { ${l} } else { ${r} }`;
    }

    case "min": {
      const e = expr as any;
      const l = generateIRExpr(e.left);
      const r = generateIRExpr(e.right);
      return `if (${l} <= ${r}) { ${l} } else { ${r} }`;
    }

    case "neg":
      return `0`;

    case "na_check":
      return `(${generateIRExpr((expr as any).expr)} == 0)`;

    case "not_na":
      return `(${generateIRExpr((expr as any).expr)} > 0)`;

    default:
      return `0 /* unknown expr: ${(expr as { kind: string }).kind} */`;
  }
}

// ─── Function Definition Generation ──────────────────────────────────────────

function generateFuncDef(def: { name: string; params: Array<{ name: string; moveType: string }>; returnType: string; body: any[] }, indent: number): string {
  const p = pad(indent);
  const lines: string[] = [];
  const paramStr = def.params.map(p => `${p.name}: ${p.moveType}`).join(", ");
  lines.push(`${p}fun ${def.name}(${paramStr}): ${def.returnType} {`);
  for (const stmt of def.body) {
    lines.push(generateTAOp(stmt, indent + 4));
  }
  lines.push(`${p}}`);
  return lines.join("\n");
}

// ─── Signal Detection ─────────────────────────────────────────────────────────

function generateSignalDetection(
  logic: IRSignalLogic,
  indent: number,
): string {
  const p = pad(indent);
  const lines: string[] = [];

  const buyExpr = generateIRExpr(logic.buyCondition);
  const sellExpr = generateIRExpr(logic.sellCondition);

  lines.push(`${p}let new_signal: u8 = if (${buyExpr}) {`);
  lines.push(`${p}    SIGNAL_BUY`);
  lines.push(`${p}} else if (${sellExpr}) {`);
  lines.push(`${p}    SIGNAL_SELL`);
  lines.push(`${p}} else {`);
  lines.push(`${p}    SIGNAL_NEUTRAL`);
  lines.push(`${p}};`);

  return lines.join("\n");
}

// ─── View Functions ───────────────────────────────────────────────────────────

function generateViewFunctions(ir: IndicatorIR, indent: number): string {
  const p = pad(indent);
  const p2 = pad(indent + 4);
  const lines: string[] = [];

  const taFields = getTAFieldNames(ir);

  lines.push(
    `${p}// ── View Functions ──────────────────────────────────────────`,
  );
  lines.push(``);

  // get_signal
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_signal(indicator_addr: address): u8 acquires IndicatorState {`,
  );
  lines.push(
    `${p2}borrow_global<IndicatorState>(indicator_addr).last_signal`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_ta_state
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_ta_state(indicator_addr: address): (u64, u64, u8, bool, u64) acquires IndicatorState {`,
  );
  lines.push(
    `${p2}let s = borrow_global<IndicatorState>(indicator_addr);`,
  );
  lines.push(
    `${p2}(s.${taFields.fast}, s.${taFields.slow}, s.last_signal, s.in_position, s.last_price)`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_signal_view — shape the /api/launchpad/on-chain reader expects:
  // (signal, fast_line, slow_line, last_price, last_signal_time).
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_signal_view(indicator_addr: address): (u8, u64, u64, u64, u64) acquires IndicatorState {`,
  );
  lines.push(
    `${p2}let s = borrow_global<IndicatorState>(indicator_addr);`,
  );
  lines.push(
    `${p2}(s.last_signal, s.${taFields.fast}, s.${taFields.slow}, s.last_price, s.last_signal_time)`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_position
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_position(indicator_addr: address): (bool, u64, u64, u64) acquires IndicatorState {`,
  );
  lines.push(
    `${p2}let s = borrow_global<IndicatorState>(indicator_addr);`,
  );
  lines.push(
    `${p2}(s.in_position, s.entry_price, s.realized_gain_bps, s.realized_loss_bps)`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_stats
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_stats(indicator_addr: address): (u64, u64) acquires IndicatorState {`,
  );
  lines.push(
    `${p2}let s = borrow_global<IndicatorState>(indicator_addr);`,
  );
  lines.push(`${p2}(s.total_prices_pushed, s.total_signals)`);
  lines.push(`${p}}`);
  lines.push(``);

  // get_prices
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_prices(indicator_addr: address): vector<u64> acquires PriceBuffer {`,
  );
  lines.push(
    `${p2}borrow_global<PriceBuffer>(indicator_addr).prices`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_timestamps — parallels get_prices for the chart reader.
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_timestamps(indicator_addr: address): vector<u64> acquires PriceBuffer {`,
  );
  lines.push(
    `${p2}borrow_global<PriceBuffer>(indicator_addr).timestamps`,
  );
  lines.push(`${p}}`);
  lines.push(``);

  // get_buffer_size
  lines.push(`${p}#[view]`);
  lines.push(
    `${p}public fun get_buffer_size(indicator_addr: address): u64 acquires PriceBuffer {`,
  );
  lines.push(
    `${p2}vector::length(&borrow_global<PriceBuffer>(indicator_addr).prices)`,
  );
  lines.push(`${p}}`);

  return lines.join("\n");
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Get the primary TA field names used in events and views.
 * Returns { fast, slow } based on the first two state fields from the IR,
 * falling back to "fast_line" / "slow_line".
 */
function getTAFieldNames(ir: IndicatorIR): {
  fast: string;
  slow: string;
} {
  const taStateFields = ir.stateFields.filter(
    (f) => f.moveType === "u64" && !f.name.startsWith("_"),
  );
  return {
    fast: taStateFields[0]?.name || "fast_line",
    slow: taStateFields[1]?.name || "slow_line",
  };
}

/**
 * Collect field names that need prev_* snapshots for crossover detection.
 */
function collectPrevFields(ir: IndicatorIR): string[] {
  const prevFields = new Set<string>();

  // Walk all expressions in the signal logic looking for prev_field references
  function walkExpr(expr: IRExpr): void {
    if (expr.kind === "prev_field") {
      prevFields.add(expr.field);
    }
    // Walk children based on expression kind
    if (expr.kind === "binop" || expr.kind === "scaled_mul" || expr.kind === "safe_sub") {
      walkExpr(expr.left);
      walkExpr(expr.right);
    }
    if (expr.kind === "ternary") {
      walkExpr(expr.cond);
      walkExpr(expr.yes);
      walkExpr(expr.no);
    }
    if (expr.kind === "unop") {
      walkExpr(expr.expr);
    }
  }

  walkExpr(ir.signalLogic.buyCondition);
  walkExpr(ir.signalLogic.sellCondition);

  return Array.from(prevFields);
}

/**
 * Collect the set of TA function names used across all TAOps,
 * so we know which helper functions to emit.
 */
function collectNeededTAFunctions(ops: IRTAOp[]): string[] {
  const needed = new Set<string>();

  for (const op of ops) {
    switch (op.kind) {
      case "sma": needed.add("compute_sma"); break;
      case "ema": needed.add("compute_ema"); break;
      case "rsi": needed.add("compute_rsi"); break;
      case "macd": needed.add("compute_ema"); break;
      case "bb":
        needed.add("compute_sma");
        needed.add("compute_bollinger_bands");
        needed.add("isqrt");
        break;
      case "highest": needed.add("compute_highest"); break;
      case "lowest": needed.add("compute_lowest"); break;
      case "stoch":
        needed.add("compute_highest");
        needed.add("compute_lowest");
        break;
      case "supertrend": needed.add("compute_sma"); break;
      case "atr": break; // inlined
      case "crossover": break;
      case "crossunder": break;
      case "assign": break;
    }
  }

  return Array.from(needed);
}

// ─── Strategy-Vault Target ─────────────────────────────────────────────────────
//
// Emits ONE self-contained module: the generated indicator (above) PLUS the
// trustless Decibel strategy-vault pattern proven live on testnet in
// contracts/strategy-vaults/sources/strategy_vault.move — tick_oracle reads
// Decibel's mark price inside the contract (un-spoofable), orders are
// NAV-sized via SizingConfig and placed on a delegated vault subaccount.
// Compile against the interface packages in contracts/strategy-vaults/deps.

export interface StrategyVaultOpts {
  /** Decibel perp-market Object address this strategy trades. */
  marketAddr: string;
  /** Engine lot size — sizes are floored to a multiple (testnet BTC = 10). */
  lotSize?: number;
  /** Engine minimum order size — NAV sizes clamp up (testnet BTC = 100000). */
  minSize?: number;
  /** 10^sizeDecimals for the market (BTC = 1e8). */
  szDecimalsPow?: string;
  /** Mark px decimals (1e6) → indicator scale (1e8) multiplier. */
  priceScaleMult?: number;
}

const VAULT_IMPORTS = [
  `    use std::option;`,
  `    use aptos_framework::object::{Self, Object, ExtendRef};`,
  `    use decibel::dex_accounts::{Self, Subaccount};`,
  `    use decibel::perp_engine;`,
  `    use decibel::perp_market::PerpMarket;`,
  `    use decibel::perp_order;`,
  `    use order_book::order_book_types;`,
].join("\n");

export function generateStrategyVaultModule(ir: IndicatorIR, opts: StrategyVaultOpts): string {
  const base = generateMoveModule(ir);
  const withImports = base.replace(
    `    use aptos_framework::event;`,
    `    use aptos_framework::event;\n${VAULT_IMPORTS}`,
  );
  const closing = withImports.lastIndexOf("\n}");
  return (
    withImports.slice(0, closing) +
    "\n\n" +
    vaultSection(opts) +
    "\n}\n"
  );
}

function vaultSection(opts: StrategyVaultOpts): string {
  const lot = opts.lotSize ?? 10;
  const minSize = opts.minSize ?? 100000;
  const szPow = opts.szDecimalsPow ?? "100000000";
  const scaleMult = opts.priceScaleMult ?? 100;

  return `    // ── Trustless Strategy Vault ───────────────────────────────
    // Binds THIS indicator to a Decibel vault: the only code that can move the
    // vault's positions is this module. tick_oracle prices from Decibel's own
    // perp engine, so the cranker contributes nothing but gas + a timestamp.

    const E_SV_NOT_CREATOR: u64 = 10;
    const E_SV_PAUSED:      u64 = 11;
    const E_SV_ZERO_SIZE:   u64 = 12;
    const E_SV_BAD_BPS:     u64 = 13;
    const E_SV_NO_NAV:      u64 = 14;

    const SV_PRICE_SCALE: u64 = ${scaleMult};
    const SV_SIZE_POW: u128 = ${szPow};
    const SV_BPS_DENOM: u128 = 10000;
    const SV_LOT_SIZE: u128 = ${lot};
    const SV_MIN_SIZE: u128 = ${minSize};

    struct StrategyVault has key {
        creator: address,
        indicator_addr: address,
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        order_size: u64,
        extend_ref: ExtendRef,
        last_signal: u8,
        is_long: bool,
        in_position: bool,
        paused: bool,
        trades: u64,
    }

    struct SizingConfig has key {
        pct_bps: u64,
    }

    #[event]
    struct VaultTraded has drop, store {
        strategy_vault: address,
        decibel_vault: address,
        signal: u8,
        is_buy: bool,
        reduce_only: bool,
        size: u64,
        price: u64,
        timestamp: u64,
    }

    public entry fun create_strategy_vault(
        creator: &signer,
        indicator_addr: address,
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        order_size: u64,
    ) {
        assert!(order_size > 0, E_SV_ZERO_SIZE);
        let ctor = object::create_object(signer::address_of(creator));
        let obj_signer = object::generate_signer(&ctor);
        let extend_ref = object::generate_extend_ref(&ctor);
        move_to(&obj_signer, StrategyVault {
            creator: signer::address_of(creator),
            indicator_addr,
            decibel_vault_addr,
            market,
            order_size,
            extend_ref,
            last_signal: SIGNAL_NEUTRAL,
            is_long: false,
            in_position: false,
            paused: false,
            trades: 0,
        });
    }

    /// Permissionless crank: anyone pays gas; the price is read from Decibel's
    /// perp engine inside the transaction, so the caller can't spoof it.
    public entry fun tick_oracle(_cranker: &signer, sv_addr: address, ts: u64)
        acquires StrategyVault, SizingConfig, IndicatorState, PriceBuffer
    {
        let market = borrow_global<StrategyVault>(sv_addr).market;
        let mark_px = perp_engine::get_mark_price(market);
        sv_tick_internal(sv_addr, mark_px * SV_PRICE_SCALE, ts);
    }

    /// Keeper-gated tick with an explicit 1e8-scaled price. On rail-published
    /// packages the keeper is the unsignable package object, so this entry is
    /// intentionally dead there — the oracle is the only price source.
    public entry fun tick(keeper: &signer, sv_addr: address, price: u64, ts: u64)
        acquires StrategyVault, SizingConfig, IndicatorState, PriceBuffer
    {
        let ind = borrow_global<StrategyVault>(sv_addr).indicator_addr;
        assert!(signer::address_of(keeper) == borrow_global<IndicatorState>(ind).keeper, E_NOT_KEEPER);
        sv_tick_internal(sv_addr, price, ts);
    }

    fun sv_tick_internal(sv_addr: address, price: u64, ts: u64)
        acquires StrategyVault, SizingConfig, IndicatorState, PriceBuffer
    {
        let sv = borrow_global_mut<StrategyVault>(sv_addr);
        assert!(!sv.paused, E_SV_PAUSED);

        push_price_unchecked(sv.indicator_addr, price, ts);
        let sig = get_signal(sv.indicator_addr);
        if (sig == SIGNAL_NEUTRAL || sig == sv.last_signal) {
            sv.last_signal = sig;
            return
        };

        let size = sv_resolve_size(sv_addr, sv.decibel_vault_addr, sv.order_size, price);
        let want_long = sig == SIGNAL_BUY;
        let trader = object::generate_signer_for_extending(&sv.extend_ref);
        let subaccount = dex_accounts::primary_subaccount_object(sv.decibel_vault_addr);

        if (sv.in_position && sv.is_long != want_long) {
            sv_place(&trader, subaccount, sv.market, !sv.is_long, size, price, true);
            sv_emit(sv_addr, sv.decibel_vault_addr, size, sig, !sv.is_long, true, price, ts);
        };

        sv_place(&trader, subaccount, sv.market, want_long, size, price, false);
        sv_emit(sv_addr, sv.decibel_vault_addr, size, sig, want_long, false, price, ts);

        sv.in_position = true;
        sv.is_long = want_long;
        sv.last_signal = sig;
        sv.trades = sv.trades + 1;
    }

    fun sv_resolve_size(sv_addr: address, vault_addr: address, fixed_size: u64, price_1e8: u64): u64
        acquires SizingConfig
    {
        if (!exists<SizingConfig>(sv_addr)) return fixed_size;
        let pct_bps = borrow_global<SizingConfig>(sv_addr).pct_bps;
        let nav = perp_engine::get_account_net_asset_value(
            dex_accounts::primary_subaccount(vault_addr)
        );
        assert!(nav > 0, E_SV_NO_NAV);
        let nav_u = (nav as u128);
        let mark_px = ((price_1e8 / SV_PRICE_SCALE) as u128);
        if (mark_px == 0) return fixed_size;
        let size = nav_u * (pct_bps as u128) * SV_SIZE_POW / (SV_BPS_DENOM * mark_px);
        size = size / SV_LOT_SIZE * SV_LOT_SIZE;
        if (size < SV_MIN_SIZE) size = SV_MIN_SIZE;
        (size as u64)
    }

    fun sv_place(
        trader: &signer,
        subaccount: Object<Subaccount>,
        market: Object<PerpMarket>,
        is_buy: bool,
        size: u64,
        price: u64,
        reduce_only: bool,
    ) {
        let tif = order_book_types::immediate_or_cancel();
        let common = perp_order::new_order_common_args(price, size, is_buy, tif, option::none());
        let tpsl = perp_order::new_empty_order_tp_sl_args();
        dex_accounts::place_perp_order_to_subaccount(
            trader, subaccount, market, common, reduce_only,
            option::none(), tpsl, option::none(),
        );
    }

    fun sv_emit(
        sv_addr: address, decibel_vault: address, size: u64,
        signal: u8, is_buy: bool, reduce_only: bool, price: u64, ts: u64,
    ) {
        event::emit(VaultTraded {
            strategy_vault: sv_addr,
            decibel_vault,
            signal,
            is_buy,
            reduce_only,
            size,
            price,
            timestamp: ts,
        });
    }

    public entry fun set_paused(creator: &signer, sv_addr: address, paused: bool) acquires StrategyVault {
        let sv = borrow_global_mut<StrategyVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_SV_NOT_CREATOR);
        sv.paused = paused;
    }

    public entry fun set_nav_sizing(creator: &signer, sv_addr: address, pct_bps: u64)
        acquires StrategyVault, SizingConfig
    {
        assert!(pct_bps > 0 && pct_bps <= 10000, E_SV_BAD_BPS);
        let sv = borrow_global<StrategyVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_SV_NOT_CREATOR);
        if (exists<SizingConfig>(sv_addr)) {
            borrow_global_mut<SizingConfig>(sv_addr).pct_bps = pct_bps;
        } else {
            let obj_signer = object::generate_signer_for_extending(&sv.extend_ref);
            move_to(&obj_signer, SizingConfig { pct_bps });
        }
    }

    #[view]
    public fun get_vault_state(sv_addr: address): (address, address, u64, bool, bool, bool, u64) acquires StrategyVault {
        let sv = borrow_global<StrategyVault>(sv_addr);
        (sv.indicator_addr, sv.decibel_vault_addr, sv.order_size, sv.in_position, sv.is_long, sv.paused, sv.trades)
    }`;
}
