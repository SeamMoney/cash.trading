/** Pine's math.round uses nearest-integer rounding, with ties toward +Infinity.
 * Math.floor(x + 0.5) is not equivalent in binary floating point: it rounds
 * 0.49999999999999994 upward and changes sufficiently large odd integers.
 */
export const pineRound = (value: number): number => Math.round(value);

/** Pine comparison operands are rounded to nine fractional decimal digits.
 * Above 2^23, an f64's spacing already exceeds 1e-9, so decimal rounding cannot
 * change the represented value. Scaling those values can lose information (or
 * overflow), and must be avoided. Keep this in sync with Rust's rounded().
 */
export function pineRoundForComparison(value: number): number {
  return Math.abs(value) >= 8_388_608 ? value : pineRound(value * 1e9) / 1e9;
}

/** Floor-modulo without an overflowing or inexact quotient/product intermediate. */
export function pineModulo(left: number, right: number): number {
  if (right === 0) return NaN;
  const remainder = left % right;
  return remainder !== 0 && (remainder < 0) !== (right < 0) ? remainder + right : remainder;
}
