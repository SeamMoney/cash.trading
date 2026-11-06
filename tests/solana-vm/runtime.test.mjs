import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { getTransactionDecoder } from "@solana/kit";
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";

const project = resolve(process.env.PINE_SOLANA_PROJECT ?? fileURLToPath(new URL("../../build/ema-cross/", import.meta.url)));
const artifact = resolve(project, "target/deploy/pine_strategy.so");
const source = readFileSync(resolve(project, "programs/pine_strategy/src/lib.rs"), "utf8");
const programId = new PublicKey(source.match(/declare_id!\("([^"]+)"\)/)[1]);
const ir = JSON.parse(readFileSync(resolve(project, "program.ir.json"), "utf8"));
const candleBytes = readFileSync(new URL("../../examples/pine-solana/candles.json", import.meta.url));
const candles = JSON.parse(candleBytes.toString("utf8"));
const reference = JSON.parse(readFileSync(resolve(project, "svm-reference.json"), "utf8"));
assert.equal(reference.schemaVersion, 1);
assert.equal(reference.sourceHash, ir.sourceHash);
assert.equal(reference.configHash, ir.configHash);
assert.equal(reference.candlesSha256, createHash("sha256").update(candleBytes).digest("hex"));
assert.equal(reference.trace.length, candles.length);
const discriminator = name => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const f64 = n => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const timeframe = 60000, origin = candles[0].time, barsOffset = 186;

function validateIntentEvent(log, harness, barIndex) {
  const bytes = Buffer.from(log.slice("Program data: ".length), "base64");
  const eventDiscriminator = createHash("sha256").update("event:OrderIntent").digest().subarray(0, 8);
  assert.deepEqual(bytes.subarray(0, 8), eventDiscriminator);
  let offset = 8;
  for (const key of [harness.state.toBuffer(), harness.market.toBuffer(), Buffer.from(ir.sourceHash, "hex"), Buffer.from(ir.configHash, "hex")]) {
    assert.deepEqual(bytes.subarray(offset, offset + 32), key);
    offset += 32;
  }
  assert.equal(bytes.readBigUInt64LE(offset), BigInt(barIndex)); offset += 8;
  assert.equal(bytes.readBigUInt64LE(offset), BigInt(candles[barIndex].time)); offset += 8;
  const kind = bytes.readUInt8(offset++), idBytes = bytes.readUInt32LE(offset); offset += 4;
  const id = bytes.subarray(offset, offset + idBytes).toString("utf8"); offset += idBytes;
  const side = bytes.readInt8(offset++), quantityPresent = bytes.readUInt8(offset++);
  assert.ok(quantityPresent === 0 || quantityPresent === 1, "Invalid optional quantity encoding");
  // Anchor's event has a presence flag plus a fixed u64 bit payload, not a
  // variable-width Option<f64>. Closes encode zero bits and expose null to clients.
  const quantity = quantityPresent ? bytes.readDoubleLE(offset) : null;
  if (!quantityPresent) assert.equal(bytes.readBigUInt64LE(offset), 0n);
  offset += 8;
  assert.equal(offset, bytes.length, "Unexpected event layout");
  assert.ok(idBytes <= 64);
  const candidates = ir.orders.filter(order => order.id === id && order.side === side && ["entry", "close", "close_all"][kind] === order.kind);
  assert.ok(candidates.length > 0, "Event must match a compiled order site");
  assert.equal(quantityPresent, kind === 0 ? 1 : 0);
  if (quantityPresent) {
    assert.ok(Number.isFinite(quantity) && quantity > 0);
    const constants = candidates.map(order => ir.nodes[order.quantity]).filter(node => node.op === "const");
    if (constants.length === candidates.length) assert.ok(constants.some(node => node.value === quantity), "Event quantity must match its constant order quantity");
  }
  return { kind: ["entry", "close", "close_all"][kind], id, side, quantity, barIndex, time: candles[barIndex].time };
}

// Integers, boolean state, ring indices, and rounded values must match exactly.
// Other persisted floats use a small tolerance to accommodate backend arithmetic.
const exactCells = new Set();
for (let i = 0; i < ir.nodes.length; i++) {
  const node = ir.nodes[i], layout = ir.layouts[i];
  if (node.type === "bool" || ["const", "round", "floor", "ceil", "sign", "bar_index", "time", "checked_int"].includes(node.op)) {
    for (let k = 0; k < layout.historyLength; k++) exactCells.add(layout.historyOffset + k);
  }
  if (["sma", "wma", "stdev", "variance"].includes(node.op)) {
    exactCells.add(layout.auxOffset); exactCells.add(layout.auxOffset + 1);
  }
  if (node.op === "rma") exactCells.add(layout.auxOffset);
}

function comparePersistedState(data, barIndex) {
  const expected = reference.trace[barIndex].state;
  assert.equal(expected.configHash, ir.configHash);
  assert.equal(expected.bars, barIndex + 1);
  assert.equal(expected.lastTime, candles[barIndex].time);
  assert.equal(data.readBigUInt64LE(barsOffset), BigInt(expected.bars));
  const stateOffset = barsOffset + 8;
  assert.equal(data.readUInt32LE(stateOffset), ir.stateCells);
  assert.equal(expected.data.length, ir.stateCells);
  for (let cell = 0; cell < ir.stateCells; cell++) {
    const got = data.readDoubleLE(stateOffset + 4 + cell * 8), want = expected.data[cell];
    const matches = want === null ? Number.isNaN(got) : exactCells.has(cell) ? got === want : Number.isFinite(got) && Math.abs(got - want) <= 1e-10 + 1e-10 * Math.abs(want);
    assert.ok(matches, `bar ${barIndex} state ${cell}: got ${got}, expected ${want}`);
  }
}

function setup() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(programId.toBase58(), artifact);
  const owner = Keypair.generate(), feed = Keypair.generate(), attacker = Keypair.generate(), market = Keypair.generate().publicKey;
  svm.airdrop(owner.publicKey.toBase58(), 10_000_000_000n);
  const [state] = PublicKey.findProgramAddressSync([Buffer.from("pine"), owner.publicKey.toBuffer(), market.toBuffer(), Buffer.from(ir.sourceHash, "hex"), Buffer.from(ir.configHash, "hex"), u64(timeframe)], programId);
  const clock = svm.getClock(); clock.unixTimestamp = BigInt(Math.ceil((origin + timeframe * 1000) / 1000)); svm.setClock(clock);
  const send = (instruction, extra = []) => {
    svm.expireBlockhash();
    const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: svm.latestBlockhash() });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), instruction);
    tx.sign(owner, ...extra.filter(s => !s.publicKey.equals(owner.publicKey)));
    return svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
  };
  const initialize = new TransactionInstruction({ programId, keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }, { pubkey: state, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data: Buffer.concat([discriminator("initialize"), feed.publicKey.toBuffer(), market.toBuffer(), u64(timeframe), u64(origin)]) });
  const init = send(initialize);
  assert.ok(!(init instanceof FailedTransactionMetadata), init instanceof FailedTransactionMetadata ? init.meta().logs().join("\n") : "");
  const data = () => Buffer.from(svm.getAccount(state.toBase58()).data);
  const processBar = (index, bar, overrides = {}) => {
    const authority = overrides.authority ?? feed;
    const ix = new TransactionInstruction({ programId, keys: [{ pubkey: authority.publicKey, isSigner: overrides.signer !== false, isWritable: false }, { pubkey: state, isSigner: false, isWritable: true }], data: Buffer.concat([discriminator("process_bar"), (overrides.market ?? market).toBuffer(), u64(overrides.timeframe ?? timeframe), u64(index), ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(f64), u64(bar.time)]) });
    return send(ix, overrides.signer === false ? [] : [authority]);
  };
  const pause = (value, signer = owner) => send(new TransactionInstruction({ programId, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }, { pubkey: state, isSigner: false, isWritable: true }], data: Buffer.concat([discriminator("set_paused"), Buffer.from([+value])]) }), [signer]);
  const rejected = (result, previous, expected) => {
    assert.ok(result instanceof FailedTransactionMetadata, "Expected rejected transaction");
    const logs = result.meta().logs().join("\n");
    assert.ok(logs.includes(expected), `Expected ${expected}\n${logs}\n${result.err()}`);
    assert.deepEqual(data(), previous, "Rejected transaction changed the strategy account");
  };
  return { svm, owner, feed, attacker, market, state, data, processBar, pause, rejected, initCU: Number(init.computeUnitsConsumed()) };
}

test("actual SBF enforces signers, feed/market/timeframe, sequence, finality and pause atomically", () => {
  const h = setup();
  const first = candles[0], before = h.data();
  h.rejected(h.processBar(0, first, { authority: h.attacker }), before, "ConstraintHasOne");
  h.rejected(h.processBar(0, first, { signer: false }), before, "AccountNotSigner");
  h.rejected(h.processBar(0, first, { market: Keypair.generate().publicKey }), before, "MarketMismatch");
  h.rejected(h.processBar(0, first, { timeframe: 1 }), before, "MarketMismatch");
  h.rejected(h.processBar(1, first), before, "SequenceMismatch");
  h.rejected(h.processBar(0, { ...first, time: first.time + timeframe }), before, "InvalidClock");
  h.rejected(h.processBar(0, { ...first, high: first.low - 1 }), before, "EvaluationFailed");
  h.rejected(h.pause(true, h.attacker), before, "ConstraintHasOne");
  const clock = h.svm.getClock(), saved = clock.unixTimestamp;
  clock.unixTimestamp = BigInt(origin / 1000); h.svm.setClock(clock);
  h.rejected(h.processBar(0, first), before, "InvalidClock");
  clock.unixTimestamp = saved; h.svm.setClock(clock);
  assert.ok(!(h.pause(true) instanceof FailedTransactionMetadata));
  h.rejected(h.processBar(0, first), h.data(), "Paused");
  assert.ok(!(h.pause(false) instanceof FailedTransactionMetadata));
  assert.ok(!(h.processBar(0, first) instanceof FailedTransactionMetadata));
  assert.equal(h.data().readBigUInt64LE(barsOffset), 1n);
  h.rejected(h.processBar(0, first), h.data(), "SequenceMismatch");
  assert.ok(!(h.processBar(1, candles[1]) instanceof FailedTransactionMetadata));
  assert.equal(h.data().readBigUInt64LE(barsOffset), 2n);
});

test("actual SBF replays the dataset with bounded account size and measured compute", () => {
  const h = setup();
  const accountSize = h.data().length;
  let maxCU = 0, totalCU = 0, events = 0;
  for (let i = 0; i < candles.length; i++) {
    const result = h.processBar(i, candles[i]);
    assert.ok(!(result instanceof FailedTransactionMetadata), result instanceof FailedTransactionMetadata ? `bar ${i}: ${result.meta().logs().join("\n")}` : "");
    const cu = Number(result.computeUnitsConsumed()); maxCU = Math.max(maxCU, cu); totalCU += cu;
    const eventLogs = result.logs().filter(line => line.startsWith("Program data: "));
    const intents = eventLogs.map(log => validateIntentEvent(log, h, i));
    assert.deepEqual(intents, reference.trace[i].intents, `Ordered intent trace differs at bar ${i}`);
    events += eventLogs.length;
    assert.equal(h.data().length, accountSize);
    assert.equal(h.data().readBigUInt64LE(barsOffset), BigInt(i + 1));
    comparePersistedState(h.data(), i);
  }
  const report = { scope: "local-LiteSVM-SBF-v3", sourceHash: ir.sourceHash, configHash: ir.configHash, binarySha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"), binaryBytes: readFileSync(artifact).length, graphNodes: ir.nodes.length, numericStateBytes: ir.stateCells * 8, accountBytes: accountSize, bars: candles.length, orderIntentEvents: events, intentTraceMatches: true, stateCellsCompared: candles.length * ir.stateCells, exactStateCellsPerBar: exactCells.size, initComputeUnits: h.initCU, maxBarComputeUnits: maxCU, meanBarComputeUnits: totalCU / candles.length, heapFrame: "default-32-KiB", transactionComputeLimit: 1_400_000, deployedToNetwork: false };
  if (ir.title.includes("EMA crossover")) assert.equal(events, 12);
  if (ir.title === "Solana resource boundary") assert.equal(events, 16 * candles.length);
  writeFileSync(resolve(project, "svm-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
});

if (ir.title === "Core semantic boundaries") {
  test("actual SBF rejects an unsafe integer delta atomically and permits a corrected retry", () => {
    const h = setup();
    const priced = (bar, close) => ({ ...bar, open: close, high: close, low: close, close });
    const first = h.processBar(0, priced(candles[0], -2));
    assert.ok(!(first instanceof FailedTransactionMetadata));
    const before = h.data();
    // Both input integers are individually exact. Their difference exceeds the
    // supported range and must not round into a different trading condition.
    h.rejected(h.processBar(1, priced(candles[1], Number.MAX_SAFE_INTEGER)), before, "EvaluationFailed");
    const retry = h.processBar(1, priced(candles[1], 2));
    assert.ok(!(retry instanceof FailedTransactionMetadata), retry instanceof FailedTransactionMetadata ? retry.meta().logs().join("\n") : "");
    assert.equal(h.data().readBigUInt64LE(barsOffset), 2n);
  });
}
