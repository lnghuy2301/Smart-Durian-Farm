/* global document, window */
import assert from "node:assert/strict";

export async function assertManagerFilterAlignment(page) {
  await page.locator(".manager-filter-grid").waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".manager-filter-grid select")].every(
      (select) => !select.textContent.includes("Đang tải lựa chọn"),
    ),
  );
  const fields = await page
    .locator(".manager-filter-grid > .field")
    .evaluateAll((elements) =>
      elements.map((field) => {
        const control = field
          .querySelector("input,select")
          .getBoundingClientRect();
        return {
          row: field.getBoundingClientRect().top,
          y: control.top,
          height: control.height,
          notes: [...field.querySelectorAll("small")].map(
            (note) => note.getBoundingClientRect().top,
          ),
        };
      }),
    );
  assert.ok(fields.length >= 2);
  for (const field of fields) {
    assert.ok(Math.abs(field.height - 52) <= 1);
    for (const neighbor of fields.filter(
      (item) => Math.abs(item.row - field.row) <= 1,
    ))
      assert.ok(
        Math.abs(neighbor.y - field.y) <= 1,
        "Controls in the same filter row must align",
      );
    assert.ok(
      field.notes.every((top) => top >= field.y + field.height),
      "Notes belong below their control",
    );
  }
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
}

export async function checkManagerFilters({ page, visit, screenshots }) {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1366, height: 640 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of [
      "/zones",
      "/trees",
      "/cultivation-events",
      "/tree-harvests",
      "/devices",
      "/sensors",
      "/actuators",
    ]) {
      await visit(path);
      await assertManagerFilterAlignment(page);
      await page.screenshot({
        path: `${screenshots}/manager-filter-${path.slice(1)}-${viewport.width}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit("/");
  await page.locator(".manager-stats").waitFor();
}
