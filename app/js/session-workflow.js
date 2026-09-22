export function normalizeLiveViewer(profile) {
  const fullName = profile.full_name || profile.email || "ITC Member";
  return {
    id: profile.id,
    email: profile.email,
    fullName,
    preferredName: fullName.split(" ")[0],
    avatarUrl: profile.avatar_url,
    appliedAt: profile.created_at,
    role: profile.role,
    status: profile.role === "pending"
      ? "pending"
      : profile.role === "declined"
        ? "declined"
        : "approved",
    profile,
  };
}

export function createSessionCache() {
  let profile = null;
  let viewer = null;
  let fetchedAt = 0;
  return {
    currentUser: () => viewer,
    profile: () => profile,
    fetchedAt: () => fetchedAt,
    set(nextProfile, nextViewer, nextFetchedAt = Date.now()) {
      profile = nextProfile;
      viewer = nextViewer;
      fetchedAt = nextFetchedAt;
    },
    clear() {
      profile = null;
      viewer = null;
      fetchedAt = 0;
    },
  };
}
