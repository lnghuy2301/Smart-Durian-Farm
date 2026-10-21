import { describe, expect, it } from "vitest";
import {
  controlRecipe,
  startMetadataReady,
  stopMetadataReady,
} from "../src/control/data";
import type { ControlSnapshot } from "../src/control/types";

function snapshot(): ControlSnapshot {
  return {
    device: {
      id: "device",
      zone_id: "zone",
      station_id: "TEST",
      installed_at: "2026-09-01T00:00:00.000Z",
      cost: 1,
      status: "Active",
      last_seen_at: null,
    },
    state: {
      device_id: "device",
      acknowledged_mode: "Unknown",
      physical_state: "Unknown",
      confirmation_kind: "CommandReceipt",
      busy: false,
      active_task_id: null,
      reset_required: true,
      broker_ready: true,
      ack_timeout_ms: 10000,
    },
    actuators: [
      {
        id: "pump",
        device_id: "device",
        name: "Pump",
        purpose: "shared",
        capability_id: 2,
        status: "Active",
      },
      {
        id: "water",
        device_id: "device",
        name: "Valve B",
        purpose: "watering",
        capability_id: 4,
        status: "Active",
      },
      {
        id: "spray",
        device_id: "device",
        name: "Valve A",
        purpose: "spraying",
        capability_id: 3,
        status: "Active",
      },
    ],
  };
}

describe("final hardware control configuration", () => {
  it("accepts swapped valve metadata without reinterpreting capability numbers", () => {
    const data = snapshot();
    expect(controlRecipe(data.actuators)?.watering.capability_id).toBe(4);
    expect(startMetadataReady(data, "Watering")).toBe(true);
    expect(startMetadataReady(data, "Spraying")).toBe(true);
    expect(stopMetadataReady(data)).toBe(true);
  });
  it("blocks unknown Reset and Stop when a required actuator is Inactive", () => {
    const data = snapshot();
    data.actuators[2].status = "Inactive";
    expect(startMetadataReady(data, "Watering")).toBe(false);
    expect(stopMetadataReady(data)).toBe(false);
    data.state.reset_required = false;
    data.state.acknowledged_mode = "Off";
    expect(startMetadataReady(data, "Watering")).toBe(true);
    data.state.acknowledged_mode = "Watering";
    expect(stopMetadataReady(data)).toBe(true);
    data.device.status = "Maintenance";
    expect(startMetadataReady(data, "Watering")).toBe(false);
    expect(stopMetadataReady(data)).toBe(false);
  });
  it("refuses missing or duplicate purpose even if one duplicate is Inactive", () => {
    const data = snapshot();
    expect(controlRecipe(data.actuators.slice(0, 2))).toBeNull();
    data.actuators.push({
      ...data.actuators[1],
      id: "duplicate",
      capability_id: 1,
      status: "Inactive",
    });
    expect(controlRecipe(data.actuators)).toBeNull();
    expect(startMetadataReady(data, "Watering")).toBe(false);
    expect(stopMetadataReady(data)).toBe(false);
  });
});
