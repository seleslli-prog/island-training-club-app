export function campaignIsOpen(campaign) {
  return campaign?.status === "published";
}

export function campaignTransitionProblem(campaign, fromStatus, toStatus) {
  if (!campaign) return "Giving campaign not found.";
  if (campaign.status !== fromStatus) return `Campaign must be ${fromStatus} before it can be ${toStatus}.`;
  return null;
}

export function buildDonationRecord({ id, userId, input = {}, campaign, now = Date.now() }) {
  return {
    id,
    userId,
    name: String(input.name).trim(),
    amount: Math.round(Number(input.amount)),
    currency: "HKD",
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    method: "FPS",
    ref: String(input.ref || "").trim(),
    note: String(input.note ?? "").trim(),
    status: "pending",
    createdAt: now,
  };
}

export function donationForReference(donations, campaignId, reference) {
  if (!campaignId || !reference) return null;
  return (donations || []).find((donation) => donation.campaignId === campaignId
    && donation.ref === reference) || null;
}

export function donationCampaignProblem({ campaign } = {}) {
  return campaign ? null : "No active Giving campaign";
}

export function donationOwnerProblem({ user, inputUserId } = {}) {
  if (!user?.id || user.status !== "approved") return "Approved member access required";
  if (inputUserId !== undefined && inputUserId !== user.id) {
    return "Donation owner must match the approved member";
  }
  return null;
}

export function findActiveGivingCampaign(campaigns) {
  return (campaigns || []).find(campaignIsOpen) ?? null;
}

export function campaignRaisedFromDonations(donations, campaignId) {
  if (!campaignId) return 0;
  return (donations || [])
    .filter((donation) => donation.campaignId === campaignId)
    .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
}

export function orderGivingCampaigns(campaigns) {
  return (campaigns || []).sort((a, b) =>
    String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? ""))
  );
}

export function orderDonationsForUser(donations, userId) {
  return (donations || [])
    .filter((donation) => donation.userId === userId)
    .sort((a, b) => Number(b.createdAt ?? b.created_at) - Number(a.createdAt ?? a.created_at));
}

export function validateCampaignFields(draft) {
  const title = String(draft?.title || "").trim();
  const description = String(draft?.description || "").trim();
  const rawGoal = draft?.goalHKD ?? draft?.goal_hkd;
  const goalHKD = Number(rawGoal);
  const fpsId = String(draft?.fpsId ?? draft?.fps_id ?? "").trim();
  const fpsPayee = String(draft?.fpsPayee ?? draft?.fps_payee ?? "").trim();
  if (!title) throw new Error("Enter a campaign title.");
  if (!description) throw new Error("Enter a campaign description.");
  if (!Number.isInteger(goalHKD) || goalHKD <= 0) throw new Error("Enter a positive whole-HKD goal.");
  if (!fpsId) throw new Error("Enter the FPS ID.");
  if (!fpsPayee) throw new Error("Enter the FPS payee.");
  return { title, description, goalHKD, fpsId, fpsPayee };
}

export function normalizeGivingCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    goalHKD: Number(row.goal_hkd ?? row.goalHKD),
    fpsId: row.fps_id ?? row.fpsId,
    fpsPayee: row.fps_payee ?? row.fpsPayee,
    status: String(row.status || "").toLowerCase(),
    creatorProfileId: row.creator_profile_id ?? row.creatorProfileId ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
  };
}
