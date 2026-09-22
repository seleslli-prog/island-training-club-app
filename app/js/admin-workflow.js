const ADMIN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const SUPER_ROLES = new Set(["superadmin", "super_admin"]);

export function applicationDecisionProblem({ candidate, decision, requireSubmitted = false }) {
  if (!["member", "declined"].includes(decision)) return "Invalid application decision.";
  if (!candidate) return "Pending application not found.";
  if (requireSubmitted && !candidate.applicationSubmitted) return "Application not submitted.";
  return null;
}

export function filterMembers(members, { query = "", status = "all", role = "all" } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  return (members || []).filter((member) => {
    const matchesQuery = !normalizedQuery
      || `${member.fullName || ""} ${member.email || ""}`.toLocaleLowerCase().includes(normalizedQuery);
    const matchesStatus = status === "all" || member.status === status;
    const matchesRole = role === "all" || normalizeRole(member.role) === role;
    return matchesQuery && matchesStatus && matchesRole;
  });
}

export const isAdminRole = (role) => ADMIN_ROLES.has(role);
export const isSuperRole = (role) => SUPER_ROLES.has(role);
export const normalizeRole = (role) => role === "super_admin" ? "superadmin" : role;
export const normalizedRole = normalizeRole;
export const roleLabel = (role) => role === "superadmin" || role === "super_admin"
  ? "Super Admin"
  : role === "admin" ? "Admin"
  : role === "declined" ? "Declined"
  : role === "pending" ? "Pending"
  : "Member";
