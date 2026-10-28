import { describe, expect, it } from "vitest";
import { sessionJournalPrefill } from "../src/control/journal";
import type {
  ControlTask,
  TaskOperation,
  TaskStatus,
} from "../src/control/types";

function task(
  id: number,
  operation: TaskOperation,
  status: TaskStatus = "Confirmed",
): ControlTask {
  return {
    _id: String(id),
    device_id: "device",
    command_id: id,
    targets: [],
    tasking_parameters: {
      actionType: "control",
      action: operation === "Stop" ? 0 : 1,
    },
    status,
    created_at: "2026-10-28T02:00:00Z",
    sent_at:
      operation === "Stop" ? "2026-10-28T02:30:00Z" : "2026-10-28T02:00:00Z",
    confirmed_at: "2026-10-28T02:00:00Z",
    error_message: null,
    response_payload: {
      operation,
      confirmation_kind: "CommandReceipt",
      parent_task_id: null,
      reset_task_id: null,
      recovery_task_id: null,
      steps: [],
    },
  };
}
describe("control session journal suggestions", () => {
  it("uses the immediate preceding confirmed Start and estimates duration without asserting physical work", () => {
    const stop = task(8, "Stop");
    const result = sessionJournalPrefill(
      stop,
      [task(1, "Spraying"), task(4, "Watering"), stop],
      "zone",
    );
    expect(result).toMatchObject({
      zoneId: "zone",
      activity: "Watering",
      duration: 30,
    });
    expect(result.note).toContain("#4 → Dừng #8");
    expect(result.note).toContain("ACK chỉ xác nhận nhận lệnh");
  });
  it("does not invent materials or a Watering duration field for spraying", () => {
    const result = sessionJournalPrefill(
      task(8, "Stop"),
      [task(4, "Spraying")],
      "zone",
    );
    expect(result.activity).toBe("Spraying");
    expect(result.duration).toBeUndefined();
    expect(result).not.toHaveProperty("materials");
  });
  it("refuses failed/pending Stop, recovery, incomplete Start and gaps containing another Stop", () => {
    for (const operation of ["RecoveryStop", "Watering"] as const)
      expect(() =>
        sessionJournalPrefill(
          task(8, operation),
          [task(4, "Watering")],
          "zone",
        ),
      ).toThrow();
    for (const status of ["Pending", "Failed"] as const)
      expect(() =>
        sessionJournalPrefill(
          task(8, "Stop", status),
          [task(4, "Watering")],
          "zone",
        ),
      ).toThrow();
    for (const previous of [
      task(5, "Stop"),
      task(5, "RecoveryStop"),
      task(5, "Watering", "Failed"),
    ])
      expect(() =>
        sessionJournalPrefill(
          task(8, "Stop"),
          [task(4, "Watering"), previous],
          "zone",
        ),
      ).toThrow();
  });
  it("ignores another Device and leaves invalid/overlong estimates for manual input", () => {
    const start = task(4, "Watering");
    expect(() =>
      sessionJournalPrefill(
        task(8, "Stop"),
        [{ ...start, device_id: "other" }],
        "zone",
      ),
    ).toThrow();
    expect(
      sessionJournalPrefill(
        { ...task(8, "Stop"), sent_at: "2026-10-27T00:00:00Z" },
        [start],
        "zone",
      ).duration,
    ).toBeUndefined();
  });
});
