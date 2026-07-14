export const MOBILE_SHEET_MID_VH = 0.6;
export const MOBILE_SHEET_RUBBER_BAND_K = 0.35;
export const MOBILE_SHEET_VELOCITY_THRESHOLD = 0.4;
export const MOBILE_SHEET_SPRING_STIFFNESS = 300;
export const MOBILE_SHEET_SPRING_DAMPING = 30;
export const MOBILE_SHEET_SPRING_MASS = 1;
export const MOBILE_SHEET_SPRING_REST_THRESHOLD = 0.5;

export function animateMobileSheetSpring(
  from: number,
  to: number,
  velocity: number,
  onUpdate: (value: number) => void,
  onDone: () => void,
) {
  let position = from;
  let currentVelocity = velocity;
  let lastTime = performance.now();
  let raf: number;

  const tick = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 0.064);
    lastTime = now;

    const displacement = position - to;
    const springForce = -MOBILE_SHEET_SPRING_STIFFNESS * displacement;
    const dampingForce = -MOBILE_SHEET_SPRING_DAMPING * currentVelocity;
    const acceleration =
      (springForce + dampingForce) / MOBILE_SHEET_SPRING_MASS;

    currentVelocity += acceleration * dt;
    position += currentVelocity * dt;
    onUpdate(position);

    if (
      Math.abs(position - to) < MOBILE_SHEET_SPRING_REST_THRESHOLD &&
      Math.abs(currentVelocity) < MOBILE_SHEET_SPRING_REST_THRESHOLD
    ) {
      onUpdate(to);
      onDone();
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function mobileSheetRubberBand(offset: number): number {
  if (offset >= 0) return offset;
  return offset * MOBILE_SHEET_RUBBER_BAND_K;
}
