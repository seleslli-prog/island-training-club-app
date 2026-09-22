const ADMIN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const SUPER_ROLES = new Set(["superadmin", "super_admin"]);

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
