import { describe, expect, it } from "vitest";
import {
  calendarDate,
  displayDateTime,
  displayValue,
  fieldLabels,
} from "../src/components/presentation";

describe("Vietnamese business presentation", () => {
  it("keeps calendar dates and displays instants in Vietnam including midnight", () => {
    expect(calendarDate("2026-10-05")).toBe("05/10/2026");
    expect(displayDateTime("2026-10-05T02:00:06.000Z")).toMatch(/09:00/);
    expect(displayDateTime("2026-10-04T17:00:00Z")).toMatch(/00:00/);
    expect(displayDateTime("invalid")).toBe("Thời gian không hợp lệ");
    expect(calendarDate("2026-02-30")).toBe("Ngày không hợp lệ");
  });
  it("resolves people and relations without translating names or meaningful codes", () => {
    const refs = { "person-id": "Nguyễn Văn An", "tree-id": "DRN-123" };
    expect(displayValue("created_by", "person-id", refs)).toBe("Nguyễn Văn An");
    expect(displayValue("tree_id", "tree-id", refs)).toBe("DRN-123");
    expect(displayValue("id", "person-id", refs)).toBe("person-id");
    expect(displayValue("batch_code", "TH-20261005-F171")).toBe(
      "TH-20261005-F171",
    );
    expect(displayValue("batch_code", "person-id", refs)).toBe("person-id");
    expect(displayValue("capability_id", 1000)).toBe("1000");
    expect(displayValue("note", "Draft")).toBe("Draft");
    expect(displayValue("status", "Draft")).toBe("Bản nháp");
    expect(displayValue("total_weight_kg", 89.3)).toBe("89,3");
    expect(displayValue("created_at", null)).toBe("—");
    expect(displayValue("created_by", "unavailable-id")).toBe("unavailable-id");
    expect(fieldLabels.created_by).toBe("Người tạo");
  });
});
