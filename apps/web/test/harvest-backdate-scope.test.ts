import { describe, it, expect } from "vitest";
import { eligibleBackdateZones } from "../src/workflows/HarvestBackdateEditor";
import type { Farm, Zone, AssignmentHistory } from "../src/types/api";
describe("backdate permission scope picker", () => {
  it("combines owned farms and active assignments only; ignores global owner flag and former assignments", () => {
    const farms = [
      { id: "owned", owner_id: "farmer" },
      { id: "other", owner_id: "someone" },
    ] as Farm[];
    const zones = [
      { id: "z1", farm_id: "owned" },
      { id: "z2", farm_id: "other" },
      { id: "z3", farm_id: "other" },
    ] as Zone[];
    const assignments = [
      { assignment: { user_id: "farmer", zone_id: "z2" }, active: true },
      { assignment: { user_id: "farmer", zone_id: "z3" }, active: false },
    ] as AssignmentHistory[];
    expect(
      eligibleBackdateZones("farmer", farms, zones, assignments).map(
        (z) => z.id,
      ),
    ).toEqual(["z1", "z2"]);
    expect(
      eligibleBackdateZones("outsider", farms, zones, assignments),
    ).toEqual([]);
  });
});
