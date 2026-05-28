import Whop from "@whop/sdk";

let _whop: Whop | null = null;

export function getWhop(): Whop {
  if (!_whop) {
    _whop = new Whop({
      apiKey: process.env.WHOP_API_KEY,
      webhookKey: process.env.WHOP_WEBHOOK_SECRET,
    });
  }
  return _whop;
}

// Convenience alias
export const whop = new Proxy({} as Whop, {
  get(_target, prop) {
    return (getWhop() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
