import { expect, test } from "vitest";
import {
  navigationForRole,
  selectedNavigation,
  routeRoles,
} from "../src/components/navigation";
import { farmerContext, needsReview } from "../src/pages/dashboardContext";
import type { AssignmentHistory, Farm, Zone } from "../src/types/api";
import type { ChangeRequest } from "../src/pages/Requests";

test("role menus expose work groups without system management for Manager/Farmer or duplicate destinations", () => {
  for (const role of ["Admin", "Manager", "Farmer"] as const) {
    const groups = navigationForRole(role);
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));
    expect(new Set(paths).size).toBe(paths.length);
    expect(groups.length).toBeLessThanOrEqual(role === "Farmer" ? 6 : 4);
    expect(paths.includes("/ai/diagnoses")).toBe(role === "Farmer");
    expect(paths.includes("/pending-managers")).toBe(role === "Admin");
  }
  const manager = navigationForRole("Manager").flatMap((group) =>
    group.items.map((item) => item.to),
  );
  expect(manager).not.toContain("/materials");
  expect(manager).not.toContain("/harvest-backdates");
  expect(manager).toContain("/cooperative-updates");
  expect(
    navigationForRole("Manager")
      .flatMap((group) => group.items)
      .find((item) => item.to === "/actuator-control")?.title,
  ).toBe("Theo dõi lệnh tưới/phun thuốc");
  const farmer = navigationForRole("Farmer");
  const aiIndex = farmer.findIndex((group) => group.id === "ai");
  expect(aiIndex).toBeGreaterThan(-1);
  expect(farmer[aiIndex].items.map((item) => item.to)).toEqual([
    "/ai/diagnoses",
    "/ai/chat",
  ]);
  expect(farmer[aiIndex + 1].items.map((item) => item.to)).toEqual([
    "/standards",
    "/materials",
  ]);
  expect(farmer.map((group) => group.title)).toContain("Vườn của tôi");
  expect(farmer.map((group) => group.title)).toContain("Công việc được giao");
  expect(
    farmer
      .flatMap((group) => group.items)
      .some((item) => item.to === "/cultivation-events?mine=1"),
  ).toBe(true);
});

test("nested direct URLs select a single containing group while account and guards retain separate role rules", () => {
  expect(
    selectedNavigation("Farmer", "/ai/chat", "?id=private-chat")?.item.to,
  ).toBe("/ai/chat");
  expect(selectedNavigation("Farmer", "/ai/diagnoses")?.group.id).toBe("ai");
  expect(
    selectedNavigation("Farmer", "/farms", "?view=trees")?.item.title,
  ).toBe("Cây trồng");
  expect(
    selectedNavigation("Farmer", "/farms", "?view=devices")?.item.title,
  ).toBe("Thiết bị");
  expect(
    selectedNavigation("Farmer", "/farms", "?view=zones")?.item.title,
  ).toBe("Vườn & khu vực");
  expect(
    selectedNavigation("Farmer", "/farms", "?view=invalid")?.item.title,
  ).toBe("Vườn & khu vực");
  expect(selectedNavigation("Manager", "/sensors/sensor-id")?.group.id).toBe(
    "production",
  );
  expect(
    selectedNavigation("Admin", "/cooperatives/coop-id/edit")?.item.to,
  ).toBe("/cooperatives");
  expect(
    selectedNavigation("Farmer", "/cultivation-events/event-id")?.item.to,
  ).toBe("/cultivation-events?mine=1");
  expect(selectedNavigation("Farmer", "/account")).toBeUndefined();
  expect(selectedNavigation("Farmer", "/trees/shared-tree")).toBeUndefined();
  expect(
    selectedNavigation("Farmer", "/devices/assigned-device"),
  ).toBeUndefined();
  expect(routeRoles.administration).not.toContain("Manager");
  expect(routeRoles.cooperativeNotifications).toEqual(["Manager"]);
  expect(routeRoles.assignedWork).toEqual(["Farmer"]);
});

test("mixed Farmer contexts use each Farm owner_id, retain ended history and exclude assignments belonging to others", () => {
  const farms = [
    { id: "owned", owner_id: "me" },
    { id: "other", owner_id: "another" },
  ] as Farm[];
  const zones = [
    { id: "own-zone", farm_id: "owned" },
    { id: "work-zone", farm_id: "other" },
  ] as Zone[];
  const assignment = (id: string, zone: string, active: boolean, user = "me") =>
    ({
      assignment: { id, zone_id: zone, user_id: user },
      active,
    }) as AssignmentHistory;
  const records = [
    assignment("active", "work-zone", true),
    assignment("ended", "old-zone", false),
    assignment("other-worker", "own-zone", true, "another"),
  ];
  const view = farmerContext("me", farms, zones, records);
  expect(view.ownedFarms.map((farm) => farm.id)).toEqual(["owned"]);
  expect(view.ownedZones.map((zone) => zone.id)).toEqual(["own-zone"]);
  expect(view.assigned.map((entry) => entry.assignment.id)).toEqual(["active"]);
  expect(view.history.map((entry) => entry.assignment.id)).toEqual([
    "active",
    "ended",
  ]);
  expect(farmerContext("me", [], [], []).assigned).toEqual([]);
  const worker = farmerContext(
    "me",
    [{ id: "other", owner_id: "another" }] as Farm[],
    zones,
    records,
  );
  expect(worker.ownedFarms).toEqual([]);
  expect(worker.assigned).toHaveLength(1);
});

test("inbox distinguishes unsigned invitations from already accepted signatures and never treats a profile owner as another Farm owner", () => {
  const user = { id: "me", role: "Farmer" as const };
  const request = {
    status: "Pending",
    owner_id: "another",
    action: "Assign",
    required_approvals: [{ user_id: "me", approved_at: null }],
  } as ChangeRequest;
  expect(needsReview("assignment", request, user)).toBe(true);
  expect(
    needsReview(
      "assignment",
      {
        ...request,
        required_approvals: [{ user_id: "me", approved_at: "2026-10-21" }],
      },
      user,
    ),
  ).toBe(false);
  expect(
    needsReview("zone", { ...request, required_approvals: undefined }, user),
  ).toBe(false);
  expect(
    needsReview("assignment", { ...request, status: "Accepted" }, user),
  ).toBe(false);
});

test("harvest inbox separates owner confirmation from HTX correction and independent-Farm Admin review", () => {
  const request = {
    status: "Pending",
    owner_id: "owner",
    action: "Confirm",
    cooperative_id: "coop",
  } as ChangeRequest;
  expect(needsReview("harvest", request, { id: "owner", role: "Farmer" })).toBe(
    true,
  );
  expect(
    needsReview("harvest", request, { id: "manager", role: "Manager" }, "coop"),
  ).toBe(false);
  const correct = { ...request, action: "Correct" };
  expect(
    needsReview("harvest", correct, { id: "manager", role: "Manager" }, "coop"),
  ).toBe(true);
  expect(
    needsReview(
      "harvest",
      correct,
      { id: "manager", role: "Manager" },
      "different",
    ),
  ).toBe(false);
  expect(needsReview("harvest", correct, { id: "admin", role: "Admin" })).toBe(
    false,
  );
  expect(
    needsReview(
      "harvest",
      { ...correct, cooperative_id: null },
      { id: "admin", role: "Admin" },
    ),
  ).toBe(true);
});
