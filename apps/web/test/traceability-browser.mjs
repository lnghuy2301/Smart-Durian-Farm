import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(new URL("../../api/package.json", import.meta.url));

// Kiểm tra trang công khai với backend thật của bộ browser tests. Đồng hồ giả
// chỉ dùng khi dựng dữ liệu RAM, luôn khôi phục trước request/browser async.
export async function checkTraceability({
  app,
  apiModule,
  browser,
  origin,
  check,
  ownerId,
  adminId,
  zone,
  screenshots,
  errors,
}) {
  const { TreesService } = apiModule("trees/trees.service");
  const { CultivationEventsService } = apiModule(
    "cultivation-events/cultivation-events.service",
  );
  const { LOCK_DELAY_MS } = apiModule(
    "cultivation-events/cultivation-events.types",
  );
  const { TreeHarvestsService } = apiModule(
    "tree-harvests/tree-harvests.service",
  );
  const { vietnamToday } = apiModule("tree-harvests/harvest-date-policy");
  const trees = app.get(TreesService);
  const cultivation = app.get(CultivationEventsService);
  const harvests = app.get(TreeHarvestsService);
  const { FarmsService } = apiModule("farms/farms.service");
  const { MockCooperativeStore } = apiModule("users/mock-cooperative.store");
  const input = {
    zone_id: zone.id,
    variety: "QR Ri6",
    plant_date: "2024-05-01T00:00:00Z",
    longitude: 106,
    latitude: 10,
  };
  const a = trees.create(ownerId, input);
  const b = trees.create(ownerId, input);
  const c = trees.create(ownerId, input);
  const watering = {
    target_type: "Tree",
    target_id: a.id,
    action_type: "Watering",
    details: { duration_minutes: 5, note: "PRIVATE-QR-NOTE" },
  };
  function at(now, callback) {
    const original = Date.now;
    Date.now = () => now;
    try {
      return callback();
    } finally {
      Date.now = original;
    }
  }
  const now = Date.now();
  const root = at(now - 2 * LOCK_DELAY_MS - 2000, () =>
    cultivation.create(ownerId, watering),
  );
  const correction = at(now - LOCK_DELAY_MS - 1000, () =>
    cultivation.correct(ownerId, root._id, {
      ...watering,
      target_id: b.id,
      details: { duration_minutes: 8 },
      correction_reason: "PRIVATE-QR-REASON",
    }),
  );
  cultivation.lockedForTrace(zone.id);
  cultivation.correct(ownerId, correction._id, {
    ...watering,
    target_id: c.id,
    correction_reason: "PRIVATE-QR-PENDING",
  });
  const harvest = harvests.create(ownerId, {
    tree_id: a.id,
    season_name: "Vụ QR",
    harvest_date: vietnamToday(),
    fruit_count: 10,
    total_weight_kg: 30.5,
    batch_code: "QR-BATCH",
  });
  harvests.submit(ownerId, harvest.id);
  const harvestCorrection = harvests.correction(ownerId, harvest.id, {
    reason: "PRIVATE-QR-HARVEST",
    changes: { fruit_count: 99, total_weight_kg: 300 },
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  const visit = (code) => page.goto(`${origin}/trace/${code}`);
  const ready = () =>
    page.getByRole("heading", { name: "QR Ri6", exact: true }).waitFor();
  try {
    await check(
      "public trace renders without login and excludes private fields",
      async () => {
        await visit(a.tree_code);
        await ready();
        await page.locator(".trace-version").first().waitFor();
        await page.locator(".trace-harvest").first().waitFor();
        assert.equal(await page.locator(".sidebar").count(), 0);
        assert.equal(await page.evaluate(() => sessionStorage.length), 0);
        const text = await page.locator("body").innerText();
        for (const secret of [
          "PRIVATE-QR",
          ownerId,
          adminId,
          zone.id,
          "WEB-FARM",
          "Vườn kiểm thử giao diện",
        ]) {
          assert.ok(!text.includes(secret), secret);
        }
      },
    );
    await check(
      "both Tree QR pages show whole Locked lineage with correct applicability",
      async () => {
        assert.equal(await page.locator(".trace-version").count(), 2);
        await page
          .getByText("Nội dung hiện tại không áp dụng cho cây đang xem.", {
            exact: false,
          })
          .first()
          .waitFor();
        assert.equal(await page.locator(".trace-current").count(), 1);
        await visit(b.tree_code);
        await ready();
        await page.locator(".trace-version.current").waitFor();
        assert.equal(await page.locator(".trace-version").count(), 2);
        assert.equal(
          await page.locator(".trace-version .notice.warning").count(),
          0,
        );
        assert.ok(
          (await page.locator(".trace-version.current").innerText()).includes(
            "8 phút",
          ),
        );
        await visit(a.tree_code);
        await ready();
        await page.locator(".trace-version.current").waitFor();
        await page.screenshot({
          path: `${screenshots}/trace-desktop.png`,
          fullPage: true,
        });
      },
    );
    await check(
      "harvest proposal stays private and approved contents update only after review",
      async () => {
        await page.getByText("10 quả", { exact: true }).waitFor();
        assert.equal(
          await page.getByText("99 quả", { exact: true }).count(),
          0,
        );
        // Các scenario trước có thể đã cho Farm gia nhập HTX. Chọn đúng reviewer
        // theo Farm hiện tại, không dùng Admin để vượt nghiệp vụ Manager duyệt.
        const cooperativeId = app
          .get(FarmsService)
          .getRecord(zone.farm_id).cooperative_id;
        const reviewer = cooperativeId
          ? app.get(MockCooperativeStore).get(cooperativeId).manager_id
          : adminId;
        harvests.approve(reviewer, harvestCorrection.id);
        await page
          .getByRole("button", { name: "Tải lại thu hoạch", exact: true })
          .click();
        await page.getByText("99 quả", { exact: true }).waitFor();
        assert.ok(
          (await page.locator(".trace-harvest").innerText()).includes(
            vietnamToday().split("-").reverse().join("/"),
          ),
        );
      },
    );
    await check(
      "square PNG QR downloads with centered code and independently decodes to original public URL",
      async () => {
        await page.waitForFunction(() => {
          const image = document.querySelector(".trace-qr img");
          return image?.complete && image.naturalWidth > 0;
        });
        await page.addScriptTag({ path: require.resolve("jsqr/dist/jsQR.js") });
        const decoded = await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 640;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(
            document.querySelector(".trace-qr img"),
            0,
            0,
            640,
            640,
          );
          const pixels = ctx.getImageData(0, 0, 640, 640);
          return window.jsQR(pixels.data, 640, 640)?.data;
        });
        assert.equal(decoded, `http://localhost:5173/trace/${a.tree_code}`);
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Tải mã QR PNG", exact: true })
          .click();
        assert.equal(
          (await download).suggestedFilename(),
          `${a.tree_code}-qr.png`,
        );
        const png = await readFile(await (await download).path());
        assert.deepEqual(
          [...png.subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
        const raster = await page.evaluate(async (base64) => {
          const image = new window.Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let minX = canvas.width,
            minY = canvas.height,
            maxX = 0,
            maxY = 0;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const i = (y * canvas.width + x) * 4;
              if (pixels.data[i] < 128) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
              }
            }
          return {
            width: canvas.width,
            height: canvas.height,
            minX,
            minY,
            maxX,
            maxY,
            code: window.jsQR(pixels.data, canvas.width, canvas.height)?.data,
          };
        }, png.toString("base64"));
        assert.equal(raster.width, 1024);
        assert.equal(raster.height, 1024);
        assert.ok(raster.minX >= 64 && raster.minY >= 64);
        assert.ok(Math.abs(raster.minX - (1023 - raster.maxX)) <= 1);
        assert.ok(Math.abs(raster.minY - (1023 - raster.maxY)) <= 1);
        assert.equal(raster.code, `http://localhost:5173/trace/${a.tree_code}`);
      },
    );
    await check(
      "public trace ignores stored JWT and never requests private session data",
      async () => {
        await page.evaluate(() =>
          sessionStorage.setItem(
            "smart-durian.access-token",
            "private-stored-token",
          ),
        );
        const requests = [];
        const collect = (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/"))
            requests.push(request);
        };
        page.on("request", collect);
        await page.reload();
        await ready();
        await page.locator(".trace-harvest").waitFor();
        page.off("request", collect);
        assert.ok(requests.length >= 3);
        assert.ok(
          requests.every((request) =>
            request.url().includes("/api/traceability/trees/"),
          ),
        );
        assert.ok(
          requests.every((request) => !request.headers().authorization),
        );
      },
    );
    await check(
      "public trace has mobile layout and empty histories hide Pending correction",
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        );
        await page.screenshot({
          path: `${screenshots}/trace-mobile.png`,
          fullPage: true,
        });
        await visit(c.tree_code);
        await ready();
        await page
          .getByText("Chưa có nhật ký đã khóa liên quan đến cây này.", {
            exact: true,
          })
          .waitFor();
        await page
          .getByText("Chưa có thu hoạch được xác nhận.", { exact: true })
          .waitFor();
        assert.equal(await page.locator(".trace-version").count(), 0);
      },
    );
    await check(
      "public trace recovers from network error and handles unknown Tree",
      async () => {
        const path = `**/api/traceability/trees/${c.tree_code}`;
        await page.route(path, (route) => route.abort());
        await page.reload();
        await page.getByRole("alert").waitFor();
        await page.unroute(path);
        await page
          .getByRole("button", { name: "Thử lại", exact: true })
          .click();
        await ready();
        await visit("DRN-00000000-0000-4000-8000-000000000099");
        await page.getByRole("alert").waitFor();
        assert.equal(await page.locator(".trace-qr img").count(), 0);
      },
    );
  } finally {
    await context.close();
  }
}
