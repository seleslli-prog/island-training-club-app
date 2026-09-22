export function campaignIsOpen(campaign) {
  return campaign?.status === "published";
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
