export function hyroxCycleStatus(cycle, now = Date.now()) {
  if (cycle.registrationState === "cancelled") return { label: "Cancelled", className: "danger" };
  if (now < cycle.registrationOpensAt) return {
    label: "Sign up opens Monday at 6 PM HKT",
    compactLabel: "Opens Mon · 6 PM",
    className: "neutral",
  };
  if (cycle.venuePlan === "bft_only") return { label: "BFT only", className: "free" };
  if (cycle.venuePlan === "both") {
    return {
      label: cycle.allocationClosedAt ? "Both gyms confirmed" : "Both gyms open",
      className: "free",
    };
  }
  if (cycle.registrationState === "reconciling") return { label: "Payment review", className: "warn" };
  return { label: "Registration open", className: "paid" };
}
