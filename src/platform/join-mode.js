import { HttpError, L } from "./http.js";

// Whether finishing a challenge's task also puts someone on that period's list ("Join this
// period's list automatically"), as each challenge stores it per user:
//   always  join on completion
//   ask     ask at that moment (the module's UI offers both choices)
//   never   do not join; joining by hand stays possible
// Joining a list is always the person's explicit choice (docs/product.md, Challenges).
export const JOIN_MODES = ["always", "ask", "never"];

export function joinModeFrom(value) {
  if (!JOIN_MODES.includes(value)) {
    throw new HttpError(400, "invalid_request", L("请选择是否自动进入本期 list", "Choose whether to join this period's list automatically"));
  }
  return value;
}
