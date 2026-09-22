export function effectiveAttendeeId(booking) {
  return booking?.replacementUserId || booking?.userId || null;
}

export function paymentStateForBooking(booking) {
  if (!booking) return null;
  if (booking.status === "reserved") {
    return booking.paymentMarkedAt != null ? "awaiting_confirmation" : "payment_due";
  }
  return booking.status === "confirmed" || booking.status === "attended" ? "paid" : null;
}
