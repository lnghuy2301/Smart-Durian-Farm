import type { AssignmentHistory, Farm, User, Zone } from "../types/api";
import type { ChangeRequest } from "./Requests";

export function farmerContext(
  userId: string,
  farms: Farm[],
  zones: Zone[],
  assignments: AssignmentHistory[],
) {
  // is_owner is only a profile flag. A mixed owner/assignee must never inherit
  // owner actions for another Farm just because that flag is true.
  const ownedFarms = farms.filter((farm) => farm.owner_id === userId);
  const ownedIds = new Set(ownedFarms.map((farm) => farm.id));
  const ownHistory = assignments.filter(
    (entry) => entry.assignment.user_id === userId,
  );
  const currentZones = new Set(zones.map((zone) => zone.id));
  return {
    ownedFarms,
    ownedZones: zones.filter((zone) => ownedIds.has(zone.farm_id)),
    assigned: ownHistory.filter(
      (entry) => entry.active && currentZones.has(entry.assignment.zone_id),
    ),
    history: ownHistory,
  };
}

// Read-only inbox hints mirror the existing review screen. They never authorize
// a mutation; the detail screen and API recheck current scope/signatures/version.
export function needsReview(
  kind: string,
  request: ChangeRequest,
  user: Pick<User, "id" | "role">,
  cooperativeId?: string,
) {
  if (request.status !== "Pending") return false;
  if (kind === "harvest") {
    if (request.action === "Confirm") return request.owner_id === user.id;
    return request.cooperative_id
      ? user.role === "Manager" && request.cooperative_id === cooperativeId
      : user.role === "Admin";
  }
  return request.required_approvals
    ? request.required_approvals.some(
        (signature) =>
          !signature.approved_at &&
          (signature.user_id === user.id ||
            (signature.user_id === null && signature.role === user.role)),
      )
    : request.owner_id === user.id;
}
