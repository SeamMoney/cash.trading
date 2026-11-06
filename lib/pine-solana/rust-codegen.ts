import type { ProgramIR, Op } from "./ir";
import { validateProgramIR } from "./validate-ir";
import { RUST_RUNTIME_SOURCE, RUST_RUNTIME_CARGO, RUST_WORKSPACE_LOCKFILE } from "../../contracts/pine-solana-runtime/source";

const DEFAULT_PROGRAM_ID = "Fg6PaFpoGXkYsidMpWxTWqkZqVhjZnSQ9bV2EjtnrJvJ";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function validPublicKey(value: string): boolean {
  if (!value || value.length > 44) return false;
  let n = 0n;
  for (const c of value) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let size = 0;
  while (n > 0n) { size++; n >>= 8n; }
  for (const c of value) { if (c !== "1") break; size++; }
  return size === 32;
}
function rustString(value: string): string {
  return '"' + [...value].map(c => {
    if (c === '"') return '\\"';
    if (c === '\\') return '\\\\';
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    const cp = c.codePointAt(0)!;
    return cp < 32 || cp === 127 ? `\\u{${cp.toString(16)}}` : c;
  }).join("") + '"';
}
function rustNumber(value: number | null): string {
  if (value === null) return "f64::NAN";
  if (!Number.isFinite(value)) throw new Error("IR contains a non-finite literal");
  if (Object.is(value, -0)) return "-0.0";
  const s = String(value);
  return /[.eE]/.test(s) ? s : s + ".0";
}
function opName(op: Op): string { return op.split("_").map(s => s[0].toUpperCase() + s.slice(1)).join(""); }
function hashBytes(hash: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("IR hashes must be SHA-256 hex strings");
  return `[${hash.match(/../g)!.map(x => "0x" + x).join(", ")}]`;
}
function index(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("IR node indexes must be nonnegative integers");
  return value;
}

/** Emit source artifacts only. This function never builds, signs, funds, or deploys a program. */
export function generateRustFiles(ir: ProgramIR, programId = DEFAULT_PROGRAM_ID): Record<string, string> {
  validateProgramIR(ir);
  if (!validPublicKey(programId)) throw new Error("programId must be a base58-encoded 32-byte Solana public key");
  const sourceHash = hashBytes(ir.sourceHash), configHash = hashBytes(ir.configHash);
  const nodes = ir.nodes.map(n => `    Node { op: Op::${opName(n.op)}, boolean: ${n.type === "bool"}, a: ${index(n.a)}, b: ${index(n.b)}, c: ${index(n.c)}, value: ${rustNumber(n.value)}, period: ${index(n.period)} },`).join("\n");
  const layouts = ir.layouts.map(l => `    Layout { history_offset: ${index(l.historyOffset)}, history_length: ${index(l.historyLength)}, aux_offset: ${index(l.auxOffset)}, aux_length: ${index(l.auxLength)} },`).join("\n");
  const orders = ir.orders.map(o => `    Order { kind: OrderKind::${o.kind === "close_all" ? "CloseAll" : o.kind === "close" ? "Close" : "Entry"}, id: ${rustString(o.id)}, side: ${o.side}, condition: ${index(o.condition)}, quantity: ${o.quantity === null ? "None" : `Some(${index(o.quantity)})`} },`).join("\n");
  const generated = `//! Generated strategy graph; source SHA-256 ${ir.sourceHash}.\nuse pine_solana_runtime::{Program, Node, Op, Layout, Order, OrderKind};\npub const TITLE: &str = ${rustString(ir.title)};\npub const SOURCE_HASH: [u8; 32] = ${sourceHash};\npub const CONFIG_HASH: [u8; 32] = ${configHash};\npub const STATE_CELLS: usize = ${ir.stateCells};\npub static NODES: [Node; ${ir.nodes.length}] = [\n${nodes}\n];\npub static LAYOUTS: [Layout; ${ir.layouts.length}] = [\n${layouts}\n];\npub static ORDERS: [Order; ${ir.orders.length}] = [\n${orders}\n];\npub fn program() -> Program<'static> { Program { pine_version: ${ir.pineVersion}, nodes: &NODES, layouts: &LAYOUTS, orders: &ORDERS, state_cells: STATE_CELLS } }\n#[cfg(test)] mod tests { #[test] fn graph_is_valid() { super::program().validate().unwrap(); } }\n`;
  return {
    "Cargo.lock": RUST_WORKSPACE_LOCKFILE,
    "Cargo.toml": `[workspace]\nmembers = ["runtime", "strategy", "programs/pine_strategy"]\ndefault-members = ["runtime", "strategy"]\nresolver = "2"\n[profile.release]\noverflow-checks = true\nlto = "fat"\ncodegen-units = 1\n`,
    "runtime/Cargo.toml": RUST_RUNTIME_CARGO,
    "runtime/src/lib.rs": RUST_RUNTIME_SOURCE,
    "strategy/Cargo.toml": `[package]\nname = "pine-generated-strategy"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\npine-solana-runtime = { path = "../runtime" }\n`,
    "strategy/src/lib.rs": generated,
    "programs/pine_strategy/Cargo.toml": `[package]\nname = "pine-strategy"\nversion = "0.1.0"\nedition = "2021"\n[lib]\ncrate-type = ["cdylib", "lib"]\nname = "pine_strategy"\n[features]\ndefault = []\nno-entrypoint = []\nno-idl = []\nno-log-ix-name = []\ncpi = ["no-entrypoint"]\nidl-build = ["anchor-lang/idl-build"]\nanchor-debug = []\ncustom-heap = []\ncustom-panic = []\n[dependencies]\nanchor-lang = "=0.31.1"\npine-solana-runtime = { path = "../../runtime" }\npine-generated-strategy = { path = "../../strategy" }\n`,
    "programs/pine_strategy/src/lib.rs": anchorSource(programId),
    "Anchor.toml": `[features]\nresolution = true\nskip-lint = false\n[programs.localnet]\npine_strategy = "${programId}"\n[provider]\ncluster = "Localnet"\nwallet = "~/.config/solana/id.json"\n`,
    "README.md": `# ${ir.title.replace(/[\r\n]/g, " ")} — generated Solana source\n\nSource SHA-256: \`${ir.sourceHash}\`\nConfiguration SHA-256: \`${ir.configHash}\`\n\nThis generated workspace evaluates a bounded, compiled Pine graph for one finalized bar per signed instruction. \`cargo test\` tests the native runtime and graph. \`cargo check -p pine-strategy\` checks the Anchor adapter. The generated Cargo.lock pins the tested dependency graph. With cargo-build-sbf 4.5.0 installed, build the Solana binary using \`cargo build-sbf --manifest-path programs/pine_strategy/Cargo.toml --arch v3 --tools-version v1.57 -- --locked\`. Source generation does not build an SBF binary or deploy it. Replace the default development program ID with your own generated program public key before building for deployment.\n\n## Execution contract\n\nAn owner initializes a PDA bound to owner, market, timeframe and immutable source/configuration hashes. The immutable feed signer supplies OHLCV values in the committed market and timeframe. Its first accepted timestamp must equal origin_ms; each next timestamp must be exactly one timeframe later. A bar is accepted only after its close according to the Solana clock. A feed signature authenticates the supplier; the program cannot prove a supplied OHLCV value came from an exchange or a particular oracle. Configure a trusted aggregator for finalized bars.\n\nEntry and close calls emit order intents in source order. This workspace has no custody, fills, broker emulator, exchange routing or DEX CPI integration. An executor must apply its own market mapping, price limits and risk rules. Pausing requires the original owner. Failed runtime evaluation or invalid bar checks do not commit partial state.\n\n## Numerical and language scope\n\nNumbers use finite IEEE-754 f64 and explicit NaN for Pine missing values. State serializes values as u64 bit patterns so zero remains distinct from missing. Non-finite results normalize to missing; comparisons round operands to nine decimal places. This is experimental numerical compatibility, not a claim of bit-exact TradingView parity. Closed-bar execution excludes intrabar ticks and repaint behavior. Unsupported Pine constructs must be rejected by the compiler, never silently ignored. Inspect the compilation manifest and diagnostics before use.\n\nRuntime state is bounded to 900 cells (7,200 bytes of numeric state), 256 nodes, and 16 intents per bar. Bounded source does not guarantee a Solana compute-unit budget; measure the generated program on SBF against realistic histories before deployment.\n`,
  };
}

function anchorSource(programId: string): string {
  return `use anchor_lang::prelude::*;
use pine_solana_runtime::{Bar, State as RuntimeState, OrderKind};
use pine_generated_strategy::{program as compiled_program, STATE_CELLS, SOURCE_HASH, CONFIG_HASH};

declare_id!("${programId}");

#[program]
pub mod pine_strategy {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, feed: Pubkey, market: Pubkey, timeframe_ms: u64, origin_ms: u64) -> Result<()> {
        require!(feed != Pubkey::default() && market != Pubkey::default(), PineError::InvalidConfiguration);
        require!(timeframe_ms > 0 && timeframe_ms <= pine_solana_runtime::MAX_SAFE_INTEGER && origin_ms <= pine_solana_runtime::MAX_SAFE_INTEGER, PineError::InvalidConfiguration);
        let runtime = RuntimeState::new(&compiled_program()).map_err(|_| error!(PineError::InvalidProgram))?;
        let state = &mut ctx.accounts.state;
        state.owner = ctx.accounts.owner.key(); state.feed = feed; state.market = market;
        state.timeframe_ms = timeframe_ms; state.origin_ms = origin_ms;
        state.source_hash = SOURCE_HASH; state.config_hash = CONFIG_HASH;
        state.paused = false; state.bump = ctx.bumps.state; state.bars = 0; state.data = runtime.data;
        Ok(())
    }
    pub fn process_bar(ctx: Context<ProcessBar>, market: Pubkey, timeframe_ms: u64, expected_bar_index: u64, bar: BarInput) -> Result<()> {
        let state = &mut ctx.accounts.state;
        require!(!state.paused, PineError::Paused);
        require!(state.market == market && state.timeframe_ms == timeframe_ms, PineError::MarketMismatch);
        require!(state.source_hash == SOURCE_HASH && state.config_hash == CONFIG_HASH, PineError::InvalidProgram);
        require!(state.bars == expected_bar_index, PineError::SequenceMismatch);
        let now_s = Clock::get()?.unix_timestamp;
        require!(now_s >= 0, PineError::InvalidClock);
        let now_ms = (now_s as u64).checked_mul(1000).ok_or(PineError::InvalidClock)?;
        pine_solana_runtime::validate_clock(state.origin_ms, state.bars, state.timeframe_ms, bar.time, now_ms).map_err(|_| error!(PineError::InvalidClock))?;
        let input = Bar { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, time: bar.time };
        // Solana's bump allocator does not reclaim dropped Vec allocations.
        // Move the deserialized buffer; evaluate makes the one transactional copy.
        let mut runtime = RuntimeState { bars: state.bars, data: std::mem::take(&mut state.data) };
        let result = compiled_program().evaluate(&mut runtime, input).map_err(|_| error!(PineError::EvaluationFailed))?;
        state.bars = runtime.bars; state.data = runtime.data;
        for intent in result.intents {
            emit!(OrderIntent { state: state.key(), market: state.market, source_hash: state.source_hash, config_hash: state.config_hash, bar_index: intent.bar_index, time: intent.time, kind: match intent.kind { OrderKind::Entry => 0, OrderKind::Close => 1, OrderKind::CloseAll => 2 }, order_id: intent.id.to_owned(), side: intent.side, quantity_present: intent.quantity.is_some(), quantity_bits: intent.quantity.unwrap_or(0.0).to_bits() });
        }
        Ok(())
    }
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> { ctx.accounts.state.paused = paused; Ok(()) }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BarInput { pub open: f64, pub high: f64, pub low: f64, pub close: f64, pub volume: f64, pub time: u64 }

#[derive(Accounts)]
#[instruction(feed: Pubkey, market: Pubkey, timeframe_ms: u64)]
pub struct Initialize<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(init, payer = owner, space = StrategyState::SPACE, seeds = [b"pine", owner.key().as_ref(), market.as_ref(), SOURCE_HASH.as_ref(), CONFIG_HASH.as_ref(), &timeframe_ms.to_le_bytes()], bump)]
    pub state: Box<Account<'info, StrategyState>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ProcessBar<'info> {
    pub feed: Signer<'info>,
    #[account(mut, has_one = feed, seeds = [b"pine", state.owner.as_ref(), state.market.as_ref(), state.source_hash.as_ref(), state.config_hash.as_ref(), &state.timeframe_ms.to_le_bytes()], bump = state.bump)]
    pub state: Box<Account<'info, StrategyState>>,
}
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, seeds = [b"pine", state.owner.as_ref(), state.market.as_ref(), state.source_hash.as_ref(), state.config_hash.as_ref(), &state.timeframe_ms.to_le_bytes()], bump = state.bump)]
    pub state: Box<Account<'info, StrategyState>>,
}
#[account]
pub struct StrategyState {
    pub owner: Pubkey, pub feed: Pubkey, pub market: Pubkey,
    pub timeframe_ms: u64, pub origin_ms: u64,
    pub source_hash: [u8;32], pub config_hash: [u8;32],
    pub paused: bool, pub bump: u8, pub bars: u64, pub data: Vec<u64>,
}
impl StrategyState { pub const SPACE: usize = 8 + 32*3 + 8*2 + 32*2 + 1 + 1 + 8 + 4 + 8*STATE_CELLS; }
#[event]
pub struct OrderIntent { pub state: Pubkey, pub market: Pubkey, pub source_hash: [u8;32], pub config_hash: [u8;32], pub bar_index: u64, pub time: u64, pub kind: u8, pub order_id: String, pub side: i8, pub quantity_present: bool, pub quantity_bits: u64 }
#[error_code]
pub enum PineError {
    #[msg("Invalid immutable feed/market/timeframe configuration")] InvalidConfiguration,
    #[msg("Strategy is paused")] Paused,
    #[msg("Bar market or timeframe does not match immutable configuration")] MarketMismatch,
    #[msg("Unexpected bar index; replay or skipped bar")] SequenceMismatch,
    #[msg("Bar is not the expected sequential finalized bar")] InvalidClock,
    #[msg("Invalid compiled program or source/config hash")] InvalidProgram,
    #[msg("Invalid input or bounded runtime evaluation failure")] EvaluationFailed,
}
`;
}
