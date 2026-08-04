/**
 * Risk parameters a PineScript declares about itself.
 *
 * Both of these are REAL TradingView parameters on `strategy()`, read with the meanings
 * TradingView gives them. Nothing here is invented syntax: a script written for TradingView
 * carries its sizing and leverage across unchanged, and because these are declaration rather
 * than logic, honouring them changes nothing about what the on-chain evaluator has to check.
 *
 * Dependency-free on purpose — the launch UI reads these in the browser to show a creator that
 * their script, not the form controls, is choosing the numbers, and the attestor and backtester
 * read the same functions on the server. Three implementations of "what did the script ask for"
 * is how a preview starts disagreeing with what the vault actually does.
 *
 * Both are CEILINGED by the vault's frozen bounds wherever they are used. A script can always
 * ask for less than the vault allows; it can never ask for more.
 */

/**
 * Requested position size, in bps of NAV, or null when the script does not ask.
 *
 * PineScript's `qty` is a quantity in CONTRACTS by default, and a percentage of equity only
 * under `default_qty_type=strategy.percent_of_equity`. Reading a bare `qty` as a percentage
 * would silently mis-size every strategy that uses the default — 10 contracts becoming 10% of
 * NAV — so only the explicit percent form counts.
 */
export function requestedPctBps(pineScript: string): number | null {
  if (!/default_qty_type\s*=\s*strategy\.percent_of_equity/.test(pineScript)) return null;
  const m = pineScript.match(/default_qty_value\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const pct = Number(m[1]);
  // Out of range falls back rather than clamping. A script asking for 400% of equity has a
  // bug, and quietly turning it into the vault cap would hide it.
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return Math.round(pct * 100); // percent → bps
}

/**
 * Requested leverage, ×100, or null when the script does not ask.
 *
 * PineScript has no `leverage` parameter, but it has `margin_long` / `margin_short`: the
 * percent of a position's value the account must post as margin. That IS leverage, expressed
 * the way TradingView expresses it — 50% margin is 2x, 25% is 4x.
 *
 * When the two sides differ the SMALLER margin wins, because it is the more levered of the
 * two and a per-leg cap has to bound the worst case rather than the average.
 */
export function requestedLeverageX100(pineScript: string): number | null {
  const header = pineScript.match(/\bstrategy\s*\(([\s\S]*?)\)/)?.[1];
  if (!header) return null;
  const margins: number[] = [];
  for (const key of ["margin_long", "margin_short"]) {
    const m = header.match(new RegExp(`${key}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`));
    if (!m) continue;
    const pct = Number(m[1]);
    // 0% margin is infinite leverage and >100% is not leverage at all. Both fall back rather
    // than producing a nonsense multiplier, for the same reason as sizing above.
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    margins.push(pct);
  }
  if (margins.length === 0) return null;
  const x100 = Math.round((100 / Math.min(...margins)) * 100);
  // Below 1x is not a state a perp position can be in; anything that rounds under it is an
  // artifact, not an instruction.
  return x100 >= 100 ? x100 : null;
}
