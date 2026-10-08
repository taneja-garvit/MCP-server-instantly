export type UserRole = "viewer" | "operator" | "admin";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export function isRoleAuthorized(userRole: UserRole, requiredRole: UserRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 999);
}
