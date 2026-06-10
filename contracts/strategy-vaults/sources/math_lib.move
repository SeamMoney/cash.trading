/// Math library for Indicator Launchpad — fixed-point arithmetic helpers.
///
/// All values use 1e8 fixed-point (SCALE = 100_000_000).
/// No floats, no negative numbers (u64 only).
/// u128 used for intermediate products to avoid overflow.
module cash_strategy::math_lib {

    const SCALE: u64 = 100_000_000; // 1e8

    // ln(2) in 1e8 fixed-point = 0.69314718...
    const LN2: u64 = 69_314_718;

    // ─── exp(x) ──────────────────────────────────────────────────────────
    // Computes e^x using Taylor series: 1 + x + x^2/2! + x^3/3! + ... (10 terms)
    // x is in 1e8 fixed-point. x must be <= 10 * SCALE to avoid u128 overflow.
    // Returns e^x in 1e8 fixed-point.
    public fun exp_fp(x: u64): u64 {
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
    }

    // ─── ln(x) ───────────────────────────────────────────────────────────
    // Computes natural log of x (x in 1e8 fixed-point, x > 0).
    // Returns ln(x) in 1e8 fixed-point.
    //
    // Strategy: reduce x to m * 2^k where m in [SCALE/2, SCALE) = [0.5, 1.0)
    //   ln(x) = ln(m) + k * ln(2)
    // For ln(m): m in [0.5, 1.0), let t = m - SCALE (negative conceptually),
    //   but since m < SCALE, use the identity:
    //   ln(m) = ln(1 - (SCALE - m)/SCALE) ≈ -sum_{i=1}^{N} u^i/i where u = (SCALE-m)/SCALE
    //   This converges well for u in (0, 0.5].
    public fun ln_fp(x: u64): u64 {
        if (x == 0) { return 0 }; // undefined, return 0 as sentinel
        if (x == SCALE) { return 0 }; // ln(1) = 0

        // Special fast-path: if x < SCALE we return 0 (negative log unsupported in u64)
        if (x < SCALE) { return 0 };

        // Count how many times we can halve x until it falls in [SCALE/2, SCALE)
        // Equivalently find k such that x = m * 2^k, m in [0.5*SCALE, SCALE)
        let val = x;
        let k: u64 = 0;

        // Bring val down to [SCALE/2, SCALE) by dividing by 2 and counting
        // We need val to be in [SCALE, 2*SCALE) first, then divide once more.
        // Actually: reduce val to [SCALE, 2*SCALE) range
        while (val >= 2 * SCALE) {
            val = val / 2;
            k = k + 1;
        };
        // Now val is in [SCALE, 2*SCALE). Divide once more to get [SCALE/2, SCALE).
        // But that means ln(val/2) = ln(val) - ln(2), and k is the count.
        // Let's instead keep val in [1.0, 2.0) i.e. [SCALE, 2*SCALE) and use:
        //   ln(x) = ln(val) + k*ln(2)  where val = x / 2^k is in [1,2)
        // For val in [SCALE, 2*SCALE), let t = val - SCALE (in [0, SCALE))
        //   ln(1 + t/SCALE) using Taylor: t - t^2/2 + t^3/3 - ... (alternating)
        // Since t in [0, SCALE) = [0, 1.0), series converges but slowly near t=1.
        // Use 12 terms for accuracy.

        let t: u128 = (val - SCALE) as u128; // t in [0, SCALE)
        let sc: u128 = SCALE as u128;

        // ln(1+t/sc): compute t/sc scaled so result is in fixed-point
        // term1 = t (in scale units = t/SCALE * SCALE = t)
        // term2 = t^2 / (2 * SCALE) etc.
        // Result accumulator in 1e8 units.

        // We accumulate: result = t - t^2/(2*sc) + t^3/(3*sc^2) - ...
        // To keep precision, compute each term as u128, then divide.

        let result: u128 = 0;
        let tp: u128 = t; // t^1

        // term 1: + t / sc * sc = t  (in 1e8 units)
        result = result + tp; // tp / sc * sc = tp

        // term 2: - t^2 / (2 * sc)
        tp = (tp * t) / sc; // t^2 / sc
        if (tp / 2 <= result) {
            result = result - tp / 2;
        } else {
            result = 0;
        };

        // term 3: + t^3 / (3 * sc^2) = + tp*t/(3*sc) where tp = t^2/sc
        tp = (tp * t) / sc; // t^3 / sc^2
        result = result + tp / 3;

        // term 4: - t^4 / (4 * sc^3)
        tp = (tp * t) / sc;
        if (tp / 4 <= result) {
            result = result - tp / 4;
        } else {
            result = 0;
        };

        // term 5: + t^5 / (5 * sc^4)
        tp = (tp * t) / sc;
        result = result + tp / 5;

        // term 6: - t^6 / ...
        tp = (tp * t) / sc;
        if (tp / 6 <= result) {
            result = result - tp / 6;
        } else {
            result = 0;
        };

        // term 7
        tp = (tp * t) / sc;
        result = result + tp / 7;

        // term 8
        tp = (tp * t) / sc;
        if (tp / 8 <= result) {
            result = result - tp / 8;
        } else {
            result = 0;
        };

        // term 9
        tp = (tp * t) / sc;
        result = result + tp / 9;

        // term 10
        tp = (tp * t) / sc;
        if (tp / 10 <= result) {
            result = result - tp / 10;
        } else {
            result = 0;
        };

        // result is ln(val/SCALE) in 1e8 fixed-point
        // Add k * ln(2)
        let ln2_contrib: u128 = (k as u128) * (LN2 as u128);
        let total = result + ln2_contrib;

        (total as u64)
    }

    // ─── sqrt(x) ─────────────────────────────────────────────────────────
    // Computes sqrt(x) where x is in 1e8 fixed-point.
    // Returns sqrt(x) in 1e8 fixed-point.
    //
    // sqrt(x) where x = v * 1e8 (v is the real value)
    // We want result r such that r^2 / 1e8 = x, i.e. r = sqrt(x * 1e8) = sqrt(x) * 1e4
    // But our scale is 1e8, so:
    //   If x (real) = X/1e8, then sqrt(X/1e8) = sqrt(X)/sqrt(1e8) = sqrt(X)/1e4
    //   In fixed-point: result = sqrt(X) * 1e8 / 1e4 = sqrt(X) * 1e4
    //   But sqrt(X) * 1e4 = sqrt(X * 1e8) in integer terms.
    // So: result = isqrt_u128(x * SCALE) where isqrt gives integer sqrt.
    public fun sqrt_fp(x: u64): u64 {
        if (x == 0) { return 0 };
        // Compute integer sqrt of (x * SCALE) to get the fixed-point result
        let n: u128 = (x as u128) * (SCALE as u128);
        isqrt_u128(n)
    }

    // Integer square root of n (u128) via Newton's method.
    fun isqrt_u128(n: u128): u64 {
        if (n == 0) { return 0 };
        let x = n;
        let y = (x + 1) / 2;
        let iter = 0u64;
        while (y < x && iter < 100) {
            x = y;
            y = (x + n / x) / 2;
            iter = iter + 1;
        };
        (x as u64)
    }

    // ─── tanh(x) ─────────────────────────────────────────────────────────
    // Computes tanh(x) where x is in 1e8 fixed-point.
    // Returns tanh(x) in 1e8 fixed-point, in [0, SCALE).
    // Formula: tanh(x) = (e^2x - 1) / (e^2x + 1)
    // For x > 5*SCALE, tanh(x) ≈ SCALE (1.0).
    public fun tanh_fp(x: u64): u64 {
        if (x == 0) { return 0 };
        // Clamp: tanh(5.0) ≈ 0.9999, treat as 1.0
        let saturation: u64 = 5 * SCALE; // 5.0 in 1e8
        if (x >= saturation) { return SCALE };

        // Compute 2x (cap at 10*SCALE for exp safety)
        let two_x: u64 = if (x <= 5 * SCALE) { x * 2 } else { 10 * SCALE };
        let e2x = exp_fp(two_x);

        // tanh(x) = (e^2x - 1) / (e^2x + 1)
        // In fixed-point: result = (e2x - SCALE) * SCALE / (e2x + SCALE)
        let numerator: u128 = if (e2x >= SCALE) {
            (e2x - SCALE) as u128
        } else {
            0u128
        };
        let denominator: u128 = (e2x + SCALE) as u128;
        ((numerator * (SCALE as u128)) / denominator) as u64
    }

    // ─── Tests (inline) ──────────────────────────────────────────────────
    #[test]
    public fun test_sqrt_fp() {
        // sqrt(4.0) = 2.0  → input 4*SCALE, output 2*SCALE
        let r = sqrt_fp(4 * SCALE);
        assert!(r >= 199_990_000 && r <= 200_010_000, 1);

        // sqrt(1.0) = 1.0
        let r2 = sqrt_fp(SCALE);
        assert!(r2 >= 99_990_000 && r2 <= 100_010_000, 2);
    }

    #[test]
    public fun test_exp_fp() {
        // e^0 = 1.0
        let r = exp_fp(0);
        assert!(r == SCALE, 1);
        // e^1 ≈ 2.71828 → 271_828_182
        let r2 = exp_fp(SCALE);
        assert!(r2 >= 271_000_000 && r2 <= 272_000_000, 2);
    }
}
