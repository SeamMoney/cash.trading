/**
 * move-ta-lib.ts
 *
 * Canonical Move TA function templates extracted verbatim from the deployed
 * indicator_launchpad::indicator contract and indicator_launchpad::math_lib.
 *
 * Source contracts:
 *   contracts/indicator-launchpad/sources/indicator.move
 *   contracts/indicator-launchpad/sources/math_lib.move
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoveTAFunction {
  name: string;
  /** Full function signature line */
  signature: string;
  /** Complete function body including { } */
  body: string;
  /** Names of other TA functions this depends on */
  deps: string[];
  /** One-line description */
  description: string;
}

// ---------------------------------------------------------------------------
// Function registry
// ---------------------------------------------------------------------------

export const MOVE_TA_FUNCTIONS: Record<string, MoveTAFunction> = {
  // ── exp_fp (from math_lib.move) ────────────────────────────────────────
  exp_fp: {
    name: "exp_fp",
    signature: "public fun exp_fp(x: u64): u64",
    body: `public fun exp_fp(x: u64): u64 {
        // Handle x == 0
        if (x == 0) { return SCALE };

        // Clamp x to avoid overflow: if x > 10*SCALE, return a large sentinel
        // e^10 ~ 22026, so e^10 * 1e8 ~ 2.2e12, fits in u64
        let x_max: u64 = 1_000_000_000; // 10 * SCALE = 10.0
        let clamped_x = if (x > x_max) { x_max } else { x };

        let s: u128 = SCALE as u128; // term 0: 1.0
        let xp: u128 = clamped_x as u128; // x^1 in fixed-point numerator (scaled by SCALE)
        let scale: u128 = SCALE as u128;

        // term 1: x / 1! = x
        s = s + xp;

        // term 2: x^2 / 2!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 2;

        // term 3: x^3 / 3!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 6;

        // term 4: x^4 / 4!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 24;

        // term 5: x^5 / 5!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 120;

        // term 6: x^6 / 6!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 720;

        // term 7: x^7 / 7!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 5040;

        // term 8: x^8 / 8!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 40320;

        // term 9: x^9 / 9!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 362880;

        // term 10: x^10 / 10!
        xp = (xp * (clamped_x as u128)) / scale;
        s = s + xp / 3628800;

        (s as u64)
    }`,
    deps: [],
    description:
      "Computes e^x using Taylor series (10 terms), x in 1e8 fixed-point",
  },

  // ── compute_sma ────────────────────────────────────────────────────────
  compute_sma: {
    name: "compute_sma",
    signature: "fun compute_sma(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_sma(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let total: u128 = 0;
        let start = len - period;
        let i     = start;
        while (i < len) {
            total = total + (*vector::borrow(prices, i) as u128);
            i = i + 1;
        };
        (total / (period as u128)) as u64
    }`,
    deps: [],
    description:
      "Simple Moving Average over the last `period` elements of a price vector",
  },

  // ── compute_ema ────────────────────────────────────────────────────────
  compute_ema: {
    name: "compute_ema",
    signature: "fun compute_ema(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_ema(prices: &vector<u64>, period: u64): u64 {
        let len       = vector::length(prices);
        let start_idx = len - period;
        // Seed with SMA of first window
        let seed: u128 = 0;
        let i = 0;
        while (i < period) {
            seed = seed + (*vector::borrow(prices, start_idx + i) as u128);
            i = i + 1;
        };
        let ema: u128  = seed / (period as u128);
        // k = 2/(period+1) scaled to 1e6
        let k_scaled: u128 = 2_000_000 / ((period + 1) as u128);
        let k_inv:    u128 = 1_000_000 - k_scaled;
        let j = start_idx + period;
        while (j < len) {
            let p = *vector::borrow(prices, j);
            ema = ((p as u128) * k_scaled + ema * k_inv) / 1_000_000;
            j = j + 1;
        };
        (ema as u64)
    }`,
    deps: [],
    description:
      "Exponential Moving Average seeded with SMA, k=2/(period+1) scaled to 1e6",
  },

  // ── compute_rsi ────────────────────────────────────────────────────────
  compute_rsi: {
    name: "compute_rsi",
    signature: "fun compute_rsi(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_rsi(prices: &vector<u64>, period: u64): u64 {
        let len = vector::length(prices);
        assert!(len > period, E_INSUFFICIENT_DATA);
        let avg_gain: u128 = 0;
        let avg_loss: u128 = 0;
        let start = len - period - 1;
        let i     = start;
        while (i < start + period) {
            let prev = *vector::borrow(prices, i);
            let curr = *vector::borrow(prices, i + 1);
            if (curr > prev) { avg_gain = avg_gain + ((curr - prev) as u128); }
            else             { avg_loss = avg_loss + ((prev - curr) as u128); };
            i = i + 1;
        };
        avg_gain = avg_gain / (period as u128);
        avg_loss = avg_loss / (period as u128);
        // Wilder's smoothing for remaining prices
        let j = start + period;
        while (j < len - 1) {
            let prev = *vector::borrow(prices, j);
            let curr = *vector::borrow(prices, j + 1);
            let gain: u128 = if (curr > prev) { ((curr - prev) as u128) } else { 0 };
            let loss: u128 = if (prev > curr) { ((prev - curr) as u128) } else { 0 };
            avg_gain = (avg_gain * ((period - 1) as u128) + gain) / (period as u128);
            avg_loss = (avg_loss * ((period - 1) as u128) + loss) / (period as u128);
            j = j + 1;
        };
        if (avg_loss == 0) { return 100_00000000 };
        let scale: u128 = 100_00000000;
        (scale * avg_gain / (avg_gain + avg_loss)) as u64
    }`,
    deps: [],
    description:
      "Relative Strength Index with Wilder's smoothing, returns 0-100 in 1e8 fixed-point",
  },

  // ── compute_bollinger_bands ────────────────────────────────────────────
  compute_bollinger_bands: {
    name: "compute_bollinger_bands",
    signature:
      "fun compute_bollinger_bands(\n        prices: &vector<u64>,\n        period: u64,\n        mid: u64,\n        multiplier_x10: u64,\n    ): (u64, u64)",
    body: `fun compute_bollinger_bands(
        prices: &vector<u64>,
        period: u64,
        mid: u64,
        multiplier_x10: u64,
    ): (u64, u64) {
        let len   = vector::length(prices);
        let start = len - period;
        // Sum of squared deviations (u128 prevents overflow for BTC-scale prices)
        let sum_sq: u128 = 0;
        let i = start;
        while (i < len) {
            let p: u128 = *vector::borrow(prices, i) as u128;
            let m: u128 = mid as u128;
            let diff    = if (p >= m) { p - m } else { m - p };
            sum_sq      = sum_sq + diff * diff;
            i = i + 1;
        };
        let std_dev = isqrt(sum_sq / (period as u128));
        let offset  = (((std_dev as u128) * (multiplier_x10 as u128)) / 10) as u64;
        let upper   = mid + offset;
        let lower   = if (mid >= offset) { mid - offset } else { 0 };
        (upper, lower)
    }`,
    deps: ["isqrt"],
    description:
      "Bollinger Bands returning (upper, lower) using isqrt for standard deviation",
  },

  // ── compute_highest ────────────────────────────────────────────────────
  compute_highest: {
    name: "compute_highest",
    signature: "fun compute_highest(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_highest(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let start = len - period;
        compute_highest_window(prices, start, len)
    }`,
    deps: ["compute_highest_window"],
    description: "Highest value in the last `period` elements of a price vector",
  },

  // ── compute_lowest ─────────────────────────────────────────────────────
  compute_lowest: {
    name: "compute_lowest",
    signature: "fun compute_lowest(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_lowest(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let start = len - period;
        compute_lowest_window(prices, start, len)
    }`,
    deps: ["compute_lowest_window"],
    description: "Lowest value in the last `period` elements of a price vector",
  },

  // ── compute_highest_window ─────────────────────────────────────────────
  compute_highest_window: {
    name: "compute_highest_window",
    signature:
      "fun compute_highest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64",
    body: `fun compute_highest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64 {
        let high = *vector::borrow(prices, window_start);
        let i    = window_start + 1;
        while (i < window_end) {
            let v = *vector::borrow(prices, i);
            if (v > high) { high = v; };
            i = i + 1;
        };
        high
    }`,
    deps: [],
    description:
      "Highest value in prices[window_start..window_end) (exclusive end)",
  },

  // ── compute_lowest_window ──────────────────────────────────────────────
  compute_lowest_window: {
    name: "compute_lowest_window",
    signature:
      "fun compute_lowest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64",
    body: `fun compute_lowest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64 {
        let low = *vector::borrow(prices, window_start);
        let i   = window_start + 1;
        while (i < window_end) {
            let v = *vector::borrow(prices, i);
            if (v < low) { low = v; };
            i = i + 1;
        };
        low
    }`,
    deps: [],
    description:
      "Lowest value in prices[window_start..window_end) (exclusive end)",
  },

  // ── compute_kama ───────────────────────────────────────────────────────
  compute_kama: {
    name: "compute_kama",
    signature:
      "fun compute_kama(prices: &vector<u64>, er_period: u64, prev_kama: u64): u64",
    body: `fun compute_kama(prices: &vector<u64>, er_period: u64, prev_kama: u64): u64 {
        let len = vector::length(prices);
        if (len < er_period + 1) {
            // Not enough data — return last price
            return *vector::borrow(prices, len - 1)
        };

        let last_price  = *vector::borrow(prices, len - 1);
        let first_price = *vector::borrow(prices, len - 1 - er_period);

        // direction = |last - first|
        let direction: u128 = if (last_price >= first_price) {
            (last_price - first_price) as u128
        } else {
            (first_price - last_price) as u128
        };

        // noise = sum of absolute consecutive differences over er_period bars
        let noise: u128 = 0;
        let ni = len - er_period;
        while (ni < len) {
            let cur  = *vector::borrow(prices, ni) as u128;
            let prev = *vector::borrow(prices, ni - 1) as u128;
            let diff = if (cur >= prev) { cur - prev } else { prev - cur };
            noise = noise + diff;
            ni = ni + 1;
        };

        let scale: u128 = 100_000_000;

        // ER = direction / noise (in fixed-point [0, SCALE])
        let er_fp: u128 = if (noise == 0) {
            scale
        } else {
            (direction * scale) / noise
        };
        // Clamp ER to [0, SCALE]
        let er_fp = if (er_fp > scale) { scale } else { er_fp };

        // fast_sc = 2*SCALE/3, slow_sc = 2*SCALE/31
        let fast_sc: u128 = 2 * scale / 3;
        let slow_sc: u128 = 2 * scale / 31;

        // sc = ER * (fast_sc - slow_sc) / SCALE + slow_sc
        let sc: u128 = if (fast_sc >= slow_sc) {
            er_fp * (fast_sc - slow_sc) / scale + slow_sc
        } else {
            slow_sc
        };

        // sc_sq = sc^2 / SCALE (smoothing constant squared)
        let sc_sq: u128 = (sc * sc) / scale;

        // Cold start: if prev_kama == 0 seed with SMA
        let kama_prev: u128 = if (prev_kama == 0) {
            // seed with SMA of last er_period prices
            let sum: u128 = 0;
            let si = len - er_period;
            while (si < len) {
                sum = sum + (*vector::borrow(prices, si) as u128);
                si = si + 1;
            };
            sum / (er_period as u128)
        } else {
            prev_kama as u128
        };

        // kama = prev + sc^2 * (price - prev)
        let price_u128 = last_price as u128;
        let new_kama: u128 = if (price_u128 >= kama_prev) {
            kama_prev + sc_sq * (price_u128 - kama_prev) / scale
        } else {
            let diff = kama_prev - price_u128;
            let sub  = sc_sq * diff / scale;
            if (kama_prev >= sub) { kama_prev - sub } else { 0 }
        };

        new_kama as u64
    }`,
    deps: [],
    description:
      "Kaufman Adaptive Moving Average with efficiency-ratio-based smoothing",
  },

  // ── compute_alma ───────────────────────────────────────────────────────
  compute_alma: {
    name: "compute_alma",
    signature:
      "fun compute_alma(prices: &vector<u64>, window: u64, offset_x100: u64): u64",
    body: `fun compute_alma(prices: &vector<u64>, window: u64, offset_x100: u64): u64 {
        let len = vector::length(prices);
        if (len < window) {
            return *vector::borrow(prices, len - 1)
        };

        let scale: u64 = 100_000_000;
        let scale128: u128 = scale as u128;

        // m = offset_x100 / 100 * (window - 1), in fixed-point
        // m_fp = offset_x100 * (window - 1) * SCALE / 100
        let m_fp: u64 = (offset_x100 * (window - 1) * scale) / 100;

        // s = window * SCALE / 6  (sigma = 6 hardcoded)
        let s_fp: u64 = window * scale / 6;
        if (s_fp == 0) { s_fp = 1 };

        // 2 * s^2 in fixed-point: 2 * (s_fp)^2 / SCALE
        let two_s_sq: u128 = 2 * (s_fp as u128) * (s_fp as u128) / (scale as u128);
        if (two_s_sq == 0) { two_s_sq = 1 };

        let weighted_sum: u128 = 0;
        let weight_total: u128 = 0;

        let start = len - window;
        let i = 0u64;
        while (i < window) {
            let price_i = *vector::borrow(prices, start + i) as u128;

            // i_fp = i * SCALE
            let i_fp: u64 = i * scale;

            // diff = |i_fp - m_fp|
            let diff: u128 = if (i_fp >= m_fp) {
                (i_fp - m_fp) as u128
            } else {
                (m_fp - i_fp) as u128
            };

            // exponent = diff^2 / (two_s_sq) — all in 1e8 units
            // diff is in 1e8 units, diff^2 is in 1e16 units, two_s_sq is in 1e8 units
            // exponent (1e8 units) = diff^2 / (two_s_sq * SCALE)
            let diff_sq: u128 = diff * diff; // 1e16 units
            let exponent: u64 = (diff_sq / (two_s_sq * scale128)) as u64;

            // w = exp(-exponent); since exp_fp takes positive x and returns e^x,
            // we compute 1 / exp_fp(exponent) = SCALE^2 / exp_fp(exponent)
            // but that gets complicated. Instead use: w = SCALE / exp_fp(exponent)
            // (works because exp_fp(0) = SCALE, and result is in [0, SCALE])
            let exp_val: u64 = math_lib::exp_fp(exponent);
            let w: u128 = if (exp_val == 0) { 0 } else {
                (scale128 * scale128) / (exp_val as u128)
            };

            weighted_sum = weighted_sum + price_i * w;
            weight_total = weight_total + w;
            i = i + 1;
        };

        if (weight_total == 0) {
            return *vector::borrow(prices, len - 1)
        };

        (weighted_sum / weight_total) as u64
    }`,
    deps: ["exp_fp"],
    description:
      "Arnaud Legoux Moving Average with Gaussian weights via math_lib::exp_fp",
  },

  // ── compute_t3 ─────────────────────────────────────────────────────────
  compute_t3: {
    name: "compute_t3",
    signature:
      "fun compute_t3(prices: &vector<u64>, period: u64, v_x10: u64): u64",
    body: `fun compute_t3(prices: &vector<u64>, period: u64, v_x10: u64): u64 {
        // Run EMA 6 times to get e1..e6
        let e = compute_ema(prices, period);
        // Build a single-element "prices" vector for subsequent passes
        // is not feasible without the full history. Instead, we compute
        // 6 cascaded EMAs by re-applying the EMA formula using the current
        // value as the EMA seed and only the multiplier updating each step.
        //
        // This is a stateless approximation: we seed each level with the
        // SMA of the buffer slice and then apply k_scaled * (new - prev) once.
        // Accurate for long buffers, approximate for short warmup.

        let len = vector::length(prices);
        // Compute 6 EMA levels on the available price buffer
        // Level 1: compute_ema on raw prices — normal
        let e1 = e;

        // For levels 2..6 we need the EMA of the EMA. We can approximate this
        // by applying the EMA formula with the same period but using e1 as the
        // "price" input for the last (period) bars — but we only have the current e1.
        // Better approach: use the EMA multiplier recursively.
        // k = 2/(period+1). Apply EMA smoothing N more times starting from e1,
        // each time using the same k and treating the prior level's output as a seed.
        // This is the "EMA of EMA" approximation used in practice.

        let k_scaled: u128 = 2_000_000 / ((period + 1) as u128);
        let k_inv:    u128 = 1_000_000 - k_scaled;

        // Seed each level with the simple average of the last period prices
        let seed_sum: u128 = 0;
        let seed_start = if (len >= period) { len - period } else { 0 };
        let si = seed_start;
        while (si < len) {
            seed_sum = seed_sum + (*vector::borrow(prices, si) as u128);
            si = si + 1;
        };
        let actual_period = len - seed_start;
        let seed: u128 = if (actual_period > 0) { seed_sum / (actual_period as u128) } else { e1 as u128 };

        // Run 6 levels of EMA over the last (period * 6) bars
        // Each level: ema_i = k*p + (1-k)*ema_{i-1}  (using the prior level's "current" value as p)
        // We iterate over all prices for e1, then treat e1 as a constant "price stream" for e2, etc.
        // Since we don't have the actual EMA stream, we use the following approach:
        //   For e2..e6, apply the EMA formula once using (e_{n-1}) as the new data point
        //   and the previous e_{n-1} computed from the older seed as the prior EMA.
        // This is equivalent to applying cascaded EMA on a constant price = e1.

        // Level 1 is already e1. For levels 2-6, smooth e1 through the EMA filter.
        let e2: u128 = ((e1 as u128) * k_scaled + seed * k_inv) / 1_000_000;
        let e3: u128 = ((e2) * k_scaled + seed * k_inv) / 1_000_000;
        let e4: u128 = ((e3) * k_scaled + seed * k_inv) / 1_000_000;
        let e5: u128 = ((e4) * k_scaled + seed * k_inv) / 1_000_000;
        let e6: u128 = ((e5) * k_scaled + seed * k_inv) / 1_000_000;

        // v = v_x10 / 10  in fixed-point: v_fp = v_x10 * SCALE / 10
        let scale: u128 = 100_000_000;
        let v_fp: u128 = (v_x10 as u128) * scale / 10;

        // v^2, v^3 in fixed-point
        let v2: u128 = v_fp * v_fp / scale;
        let v3: u128 = v2  * v_fp / scale;

        // T3 = c1*e6 + c2*e5 + c3*e4 + c4*e3
        // c1 = -v^3                     → subtract v3*e6
        // c2 = 3*v^2 + 3*v^3            → add (3v2 + 3v3)*e5
        // c3 = -6*v^2 - 3*v - 3*v^3     → subtract (6v2+3v+3v3)*e4
        // c4 = 1 + 3*v + v^3 + 3*v^2    → add (SCALE+3v+v3+3v2)*e3
        //
        // All products scaled by 1/SCALE to stay in fixed-point.

        let t3: u128 = {
            let c4_times_e3 = (scale + 3*v_fp + v3 + 3*v2) * e3 / scale;
            let c3_times_e4 = (6*v2 + 3*v_fp + 3*v3) * e4 / scale;
            let c2_times_e5 = (3*v2 + 3*v3) * e5 / scale;
            let c1_times_e6 = v3 * e6 / scale;

            // T3 = c4*e3 - c3*e4 + c2*e5 - c1*e6
            let pos = c4_times_e3 + c2_times_e5;
            let neg = c3_times_e4 + c1_times_e6;
            if (pos >= neg) { pos - neg } else { 0 }
        };

        t3 as u64
    }`,
    deps: ["compute_ema"],
    description:
      "Triple Exponential Moving Average (T3) by Tim Tillson with 6 cascaded EMAs",
  },

  // ── isqrt ──────────────────────────────────────────────────────────────
  isqrt: {
    name: "isqrt",
    signature: "fun isqrt(n: u128): u64",
    body: `fun isqrt(n: u128): u64 {
        if (n == 0) { return 0 };
        let x = n;
        let y = (x + 1) / 2;
        while (y < x) {
            x = y;
            y = (x + n / x) / 2;
        };
        (x as u64)
    }`,
    deps: [],
    description:
      "Integer square root via Newton's method; input at 1e16 scale, output at 1e8 scale",
  },

  compute_atr: {
    name: "compute_atr",
    signature: "fun compute_atr(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_atr(prices: &vector<u64>, period: u64): u64 {
        let len = vector::length(prices);
        if (len < period + 1) { return 0 };
        let avg_tr: u128 = 0;
        let start = len - period - 1;
        let i = start;
        while (i < start + period) {
            let prev = *vector::borrow(prices, i);
            let curr = *vector::borrow(prices, i + 1);
            let tr: u128 = if (curr >= prev) { ((curr - prev) as u128) * 2 } else { ((prev - curr) as u128) * 2 };
            avg_tr = avg_tr + tr;
            i = i + 1;
        };
        (avg_tr / (period as u128)) as u64
    }`,
    deps: [],
    description: "Average True Range using simplified true range (close-to-close)",
  },

  // ── V3: New TA functions for universal transpilation ────────────────────

  compute_pivothigh: {
    name: "compute_pivothigh",
    signature: "fun compute_pivothigh(prices: &vector<u64>, left_bars: u64, right_bars: u64): u64",
    body: `fun compute_pivothigh(prices: &vector<u64>, left_bars: u64, right_bars: u64): u64 {
        let len = vector::length(prices);
        if (len < left_bars + right_bars + 1) { return 0 };
        let pivot_idx = len - 1 - right_bars;
        let pivot_val = *vector::borrow(prices, pivot_idx);
        let i = pivot_idx - left_bars;
        while (i < pivot_idx) {
            if (*vector::borrow(prices, i) >= pivot_val) { return 0 };
            i = i + 1;
        };
        let j = pivot_idx + 1;
        while (j <= pivot_idx + right_bars) {
            if (*vector::borrow(prices, j) >= pivot_val) { return 0 };
            j = j + 1;
        };
        pivot_val
    }`,
    deps: [],
    description: "Pivot high detection: returns the value if prices[pivot] is higher than all left_bars before and right_bars after, else 0",
  },

  compute_pivotlow: {
    name: "compute_pivotlow",
    signature: "fun compute_pivotlow(prices: &vector<u64>, left_bars: u64, right_bars: u64): u64",
    body: `fun compute_pivotlow(prices: &vector<u64>, left_bars: u64, right_bars: u64): u64 {
        let len = vector::length(prices);
        if (len < left_bars + right_bars + 1) { return 0 };
        let pivot_idx = len - 1 - right_bars;
        let pivot_val = *vector::borrow(prices, pivot_idx);
        let i = pivot_idx - left_bars;
        while (i < pivot_idx) {
            if (*vector::borrow(prices, i) <= pivot_val) { return 0 };
            i = i + 1;
        };
        let j = pivot_idx + 1;
        while (j <= pivot_idx + right_bars) {
            if (*vector::borrow(prices, j) <= pivot_val) { return 0 };
            j = j + 1;
        };
        pivot_val
    }`,
    deps: [],
    description: "Pivot low detection: returns the value if prices[pivot] is lower than all left_bars before and right_bars after, else 0",
  },

  compute_stdev: {
    name: "compute_stdev",
    signature: "fun compute_stdev(prices: &vector<u64>, period: u64): u64",
    body: `fun compute_stdev(prices: &vector<u64>, period: u64): u64 {
        let len = vector::length(prices);
        if (len < period) { return 0 };
        let mean = compute_sma(prices, period);
        let start = len - period;
        let sum_sq: u128 = 0;
        let i = start;
        while (i < len) {
            let p = *vector::borrow(prices, i) as u128;
            let m = mean as u128;
            let diff = if (p >= m) { p - m } else { m - p };
            sum_sq = sum_sq + diff * diff;
            i = i + 1;
        };
        isqrt(sum_sq / (period as u128))
    }`,
    deps: ["compute_sma", "isqrt"],
    description: "Standard deviation of last period prices using SMA as mean",
  },

  compute_change: {
    name: "compute_change",
    signature: "fun compute_change(prices: &vector<u64>): u64",
    body: `fun compute_change(prices: &vector<u64>): u64 {
        let len = vector::length(prices);
        if (len < 2) { return 0 };
        let curr = *vector::borrow(prices, len - 1);
        let prev = *vector::borrow(prices, len - 2);
        if (curr >= prev) { curr - prev } else { prev - curr }
    }`,
    deps: [],
    description: "Absolute price change between last two bars",
  },

  math_abs: {
    name: "math_abs",
    signature: "fun math_abs(a: u64, b: u64): u64",
    body: `fun math_abs(a: u64, b: u64): u64 {
        if (a >= b) { a - b } else { b - a }
    }`,
    deps: [],
    description: "Absolute difference between two u64 values",
  },

  math_max: {
    name: "math_max",
    signature: "fun math_max(a: u64, b: u64): u64",
    body: `fun math_max(a: u64, b: u64): u64 {
        if (a >= b) { a } else { b }
    }`,
    deps: [],
    description: "Maximum of two u64 values",
  },

  math_min: {
    name: "math_min",
    signature: "fun math_min(a: u64, b: u64): u64",
    body: `fun math_min(a: u64, b: u64): u64 {
        if (a <= b) { a } else { b }
    }`,
    deps: [],
    description: "Minimum of two u64 values",
  },
};

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

/**
 * Given a list of TA function names needed, returns all of them plus
 * transitive dependencies in topological order (dependencies first).
 */
export function resolveTADeps(needed: string[]): string[] {
  const visited = new Set<string>();
  const ordered: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const fn = MOVE_TA_FUNCTIONS[name];
    if (!fn) {
      // Skip unknown functions — they may be custom or not yet implemented
      return;
    }

    // Visit dependencies first (topological sort)
    for (const dep of fn.deps) {
      visit(dep);
    }

    ordered.push(name);
  }

  for (const name of needed) {
    visit(name);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Returns the Move source for all resolved TA functions, ready to paste
 * into a module. Functions are emitted in dependency order.
 *
 * @param needed  - list of TA function names the caller requires
 * @param indent  - number of spaces to indent each line (default 4)
 */
export function renderTAFunctions(needed: string[], indent = 4): string {
  const resolved = resolveTADeps(needed);
  const pad = " ".repeat(indent);
  const blocks: string[] = [];

  for (const name of resolved) {
    const fn = MOVE_TA_FUNCTIONS[name];
    const lines = fn.body.split("\n");

    // Find the indentation of body lines (skip the `fun` signature line)
    let bodyIndent = 8; // default from indicator.move
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        bodyIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 8;
        break;
      }
    }

    const normalized = lines
      .map((line, i) => {
        if (line.trim() === "") return "";
        if (i === 0) {
          return pad + line.trimStart();
        }
        // Body: strip source indent, re-indent
        const stripped = line.length >= bodyIndent ? line.slice(bodyIndent) : line.trimStart();
        // Collapse alignment whitespace in code (not leading indent)
        // Split into leading whitespace + content, only collapse in content
        const leadMatch = stripped.match(/^(\s*)(.*)/);
        const leadWs = leadMatch?.[1] ?? "";
        const content = leadMatch?.[2] ?? stripped;
        const collapsed = leadWs + content.replace(/ {2,}/g, " ");
        return pad + "    " + collapsed;
      })
      .join("\n");

    const final = normalized.replace(/\n\s+\}$/, `\n${pad}}`);
    blocks.push(`${pad}/// ${fn.description}\n${final}`);
  }

  return blocks.join("\n\n");
}
