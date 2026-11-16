/* global document, window, innerWidth, getComputedStyle */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preview } from "vite";
import { Agent } from "node:http";

// Opt-in audit against the e2e runner's isolated Nest fixtures. No production
// credentials, .env, real provider or hardware. Taste is supplied externally.
export async function checkTasteAudit({
  browser,
  origin,
  http,
  app,
  apiModule,
  config,
  standard,
  screenshots,
}) {
  const skill = process.env.TASTE_SKILL_PATH;
  if (!skill)
    throw new Error(
      "Set TASTE_SKILL_PATH to the reviewed Taste skill directory.",
    );
  const {
    probe,
    layout,
    app: appProbe,
    frame,
  } = await import(pathToFileURL(join(skill, "scripts/lib/probe.mjs")).href);
  const { judge, judgeLayout, judgeApp, APP_SKIP } = await import(
    pathToFileURL(join(skill, "scripts/lib/rules.mjs")).href
  );
  const proxyAgent = new Agent({ keepAlive: true, maxSockets: 24 });
  const production = await preview({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    preview: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: {
        "/api": {
          target: await app.getUrl(),
          changeOrigin: true,
          agent: proxyAgent,
        },
      },
    },
  });
  origin = production.resolvedUrls.local[0].replace(/\/$/, "");
  const out = resolve(
    screenshots,
    "taste-audit",
    process.env.TASTE_AUDIT_PHASE || "before",
  );
  mkdirSync(out, { recursive: true });
  const report = {
    tool: "Taste DOM probes + app rules through Playwright (not inspect.mjs CLI)",
    viewports: [1440, 768, 390],
    checked_at: new Date().toISOString(),
    captures: [],
    interactions: [],
    errors: [],
    isolated: true,
    productionBuild: true,
  };
  const contexts = [];
  try {
    const { AuthService } = apiModule("auth/auth.service");
    const { MockUserStore } = apiModule("auth/mock-user.store");
    function resetFixtureLoginLimit() {
      const bucket = app.get(AuthService).rateLimits.buckets.get("login");
      if (bucket) bucket.startedAt = Date.now() - 60001;
    }
    async function token(phone, password) {
      resetFixtureLoginLimit();
      return (
        await http(
          "auth/login",
          "POST",
          { phone_number: phone, password },
          undefined,
          200,
        )
      ).access_token;
    }
    const ownerPhone = config.auth.phoneNumber,
      ownerPassword = config.auth.password;
    const adminPhone = config.auth.admin.phoneNumber,
      adminPassword = config.auth.admin.password;
    const ownerToken = await token(ownerPhone, ownerPassword);
    const adminToken = await token(adminPhone, adminPassword);
    const material = (await http("materials", "GET", undefined, ownerToken))
      .items[0];
    const users = app.get(MockUserStore);
    const template = users.findByPhone(ownerPhone);
    const worker = users.add({
      ...template,
      user_name: "Nguyễn Thanh Bình",
      phone_number: "0900000091",
      gmail: null,
      gmail_verify: false,
      role: "Farmer",
      status: "Active",
      is_owner: false,
    });
    const emptyFarmer = users.add({
      ...template,
      user_name: "Trần Thị Hương",
      phone_number: "0900000092",
      gmail: null,
      gmail_verify: false,
      role: "Farmer",
      status: "Active",
      is_owner: false,
    });
    const manager = users.add({
      ...template,
      user_name: "Lê Minh Quang",
      phone_number: "0900000093",
      gmail: "minhquang@audit.invalid",
      gmail_verify: true,
      role: "Manager",
      status: "Pending",
      is_owner: false,
    });
    const auditCoop = await http(
      "cooperatives",
      "POST",
      {
        cooperative_name: "HTX Sầu riêng Long Khánh",
        director: "Nguyễn Văn Thành",
        certificate_number: "AUDIT-HTX",
        address: "Long Khánh, Đồng Nai",
        contact_number: "0900000093",
      },
      adminToken,
    );
    await http(
      `users/${manager.id}/approve`,
      "PATCH",
      { cooperative_id: auditCoop.id },
      adminToken,
    );
    const managerToken = await token(manager.phone_number, ownerPassword);
    const workerToken = await token(worker.phone_number, ownerPassword);
    const request = await http(
      "farms/requests",
      "POST",
      {
        area_size: 10,
        address:
          "Vườn sầu riêng phía Đông, đường liên xã, Long Khánh, Đồng Nai",
        certificate_number: "AUDIT-FARM",
        longitude: 107.24,
        latitude: 10.93,
      },
      ownerToken,
    );
    const farm = await http(
      `farm-requests/${request.id}/approve`,
      "PATCH",
      {},
      adminToken,
    );
    const zone = await http(
      "zones",
      "POST",
      {
        farm_id: farm.farm_id,
        standard_id: standard.id,
        zone_name: "Khu sầu riêng phía Đông giáp đường nội bộ",
        area_size: 2,
        longitude: 107.24,
        latitude: 10.93,
      },
      ownerToken,
    );
    const invitation = await http(
      `zones/${zone.id}/assignment-requests`,
      "POST",
      { user_id: worker.id },
      ownerToken,
    );
    await http(
      `assignment-requests/${invitation.id}/approve`,
      "PATCH",
      {},
      workerToken,
    );
    const joinRequest = await http(
      `farms/${farm.farm_id}/join-requests`,
      "POST",
      { cooperative_id: auditCoop.id },
      ownerToken,
    );
    await http(
      `farm-requests/${joinRequest.id}/approve`,
      "PATCH",
      {},
      adminToken,
    );
    await http(
      `farm-requests/${joinRequest.id}/approve`,
      "PATCH",
      {},
      managerToken,
    );
    let tree;
    for (let i = 0; i < 13; i++) {
      const item = await http(
        "trees",
        "POST",
        {
          zone_id: zone.id,
          variety: i % 2 ? "Monthong tuyển chọn" : "Ri6 cơm vàng hạt lép",
          plant_date: "2022-04-10T08:00:00+07:00",
          longitude: 107.24,
          latitude: 10.93,
        },
        ownerToken,
      );
      tree ??= item;
    }
    const device = await http(
      "devices",
      "POST",
      {
        zone_id: zone.id,
        station_id: "AUDIT_STATION",
        installed_at: new Date().toISOString(),
        cost: 2500000,
      },
      ownerToken,
    );
    const sensor = await http(
      "sensors",
      "POST",
      {
        device_id: device.id,
        name: "Cảm biến độ ẩm đất khu phía Đông",
        sensor_type: "soil_moisture",
        data_stream_id: "303",
        unit: "%",
        min_threshold: 30,
        max_threshold: 80,
      },
      ownerToken,
    );
    const actuator = await http(
      "actuators",
      "POST",
      {
        device_id: device.id,
        name: "Van tưới khu sầu riêng phía Đông",
        capability_id: 6,
        purpose: "watering",
      },
      ownerToken,
    );
    const journal = await http(
      "cultivation-events",
      "POST",
      {
        target_type: "Zone",
        target_id: zone.id,
        action_type: "Watering",
        details: {
          duration_minutes: 25,
          water_volume_l: 120,
          note: "Theo dõi độ ẩm trước và sau tưới; kiểm tra lại cuối ngày.",
        },
      },
      ownerToken,
    );
    const harvest = await http(
      "tree-harvests",
      "POST",
      {
        tree_id: tree.id,
        season_name: "Mùa vụ chính Long Khánh",
        harvest_date: new Date(Date.now() + 7 * 3600000)
          .toISOString()
          .slice(0, 10),
        fruit_count: 36,
        total_weight_kg: 95.25,
        batch_code: "LK-2026-A",
      },
      ownerToken,
    );
    await http(`tree-harvests/${harvest.id}/submit`, "PATCH", {}, ownerToken);

    async function newPage(role, phone, password = ownerPassword) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      contexts.push(context);
      const page = await context.newPage();
      page.setDefaultTimeout(9000);
      page.on("pageerror", (e) =>
        report.errors.push({ role, error: e.message }),
      );
      if (phone) {
        resetFixtureLoginLimit();
        await page.goto(`${origin}/login`);
        await page.getByLabel("Số điện thoại", { exact: true }).fill(phone);
        await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "Đăng nhập", exact: true })
          .click();
        await page.locator(".app-shell").waitFor();
      }
      return page;
    }
    async function settle(page) {
      await page.locator("h1:visible").first().waitFor();
      await page
        .waitForFunction(
          () =>
            ![...document.querySelectorAll(".data-state,[role=status]")].some(
              (e) =>
                e.getClientRects().length &&
                /Đang (tải|kiểm tra|mở)/.test(e.textContent),
            ),
        )
        .catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(180);
    }
    async function capture(page, role, label, path, setup, loading = false) {
      const selected = process.env.TASTE_AUDIT_FILTER?.split(",");
      if (selected && !selected.includes(label)) return;
      for (const width of report.viewports) {
        try {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}${path}`);
          if (loading) {
            await page.locator(".data-state").first().waitFor();
          } else {
            await settle(page);
          }
          if (setup) {
            await setup(page);
            await page.waitForTimeout(160);
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          const metrics = await page.evaluate(probe),
            lay = await page.evaluate(layout);
          const a = await page.evaluate(appProbe),
            f = await page.evaluate(frame);
          let findings = [
            ...judge(metrics, { width }),
            ...judgeLayout(lay, { width }),
          ].filter(
            (x) =>
              !APP_SKIP.has(x.id) &&
              x.id !== "no-title" &&
              x.id !== "small-title",
          );
          findings.push(...judgeApp(a, metrics, { width }));
          const usability = await page.evaluate(() => {
            const visible = (e) =>
              e.getClientRects().length &&
              getComputedStyle(e).visibility !== "hidden";
            const controls = [
              ...document.querySelectorAll(
                "input:not([type=hidden]),select,textarea,button,a[href]",
              ),
            ].filter(visible);
            const unnamed = controls
              .filter(
                (e) =>
                  !e.getAttribute("aria-label") &&
                  !e.getAttribute("aria-labelledby") &&
                  !e.getAttribute("title") &&
                  !e.textContent.trim() &&
                  !e.querySelector("img[alt]:not([alt=''])") &&
                  !e.labels?.length &&
                  !["submit", "button"].includes(e.type),
              )
              .map((e) => ({ tag: e.tagName, type: e.type, name: e.name }));
            return {
              title: document.querySelector("h1")?.textContent,
              h1Count: document.querySelectorAll("h1").length,
              bodyWidth: document.documentElement.scrollWidth,
              viewport: innerWidth,
              unnamed,
              smallTargets: controls
                .filter((e) => {
                  const r = e.getBoundingClientRect();
                  return r.width < 24 || r.height < 24;
                })
                .map((e) => ({
                  text: (
                    e.textContent ||
                    e.getAttribute("aria-label") ||
                    e.name
                  )
                    .trim()
                    .slice(0, 70),
                  tag: e.tagName,
                  width: Math.round(e.getBoundingClientRect().width),
                  height: Math.round(e.getBoundingClientRect().height),
                })),
              tables: [...document.querySelectorAll("table")].map((e) => ({
                width: Math.round(e.getBoundingClientRect().width),
                container: e.parentElement.className,
                scroll: getComputedStyle(e.parentElement).overflowX,
              })),
              alerts: [...document.querySelectorAll("[role=alert]")]
                .filter(visible)
                .map((e) => e.textContent.trim().slice(0, 220)),
            };
          });
          const file = `${role}-${label}-${width}.jpg`;
          assert.equal(
            new URL(page.url()).pathname,
            new URL(path, origin).pathname,
            "Capture must show the requested screen, not a session redirect",
          );
          if (role !== "guest") {
            assert(
              await page.locator(".app-shell").count(),
              "Protected screen has its authenticated shell",
            );
          }
          if (process.env.TASTE_AUDIT_PHASE === "after") {
            if (
              role === "guest" &&
              [
                "login",
                "register-farmer",
                "register-manager",
                "forgot-password",
              ].includes(label)
            ) {
              assert.equal(
                usability.h1Count,
                1,
                "Authentication pages have one primary heading",
              );
              assert(
                !findings.some((f) => f.id === "no-title"),
                "Visible form heading is detected on mobile",
              );
            }
            if (
              (role === "manager" && label === "dashboard") ||
              label === "control-selected"
            ) {
              assert.equal(
                metrics.color.lowContrast.length,
                0,
                "Status labels have sufficient measured contrast",
              );
            }
            if (label === "materials") {
              const numeric = await page
                .locator("tbody .resource-number")
                .evaluateAll((cells) =>
                  cells.every(
                    (e) =>
                      getComputedStyle(e).textAlign === "right" &&
                      getComputedStyle(e).fontVariantNumeric.includes(
                        "tabular-nums",
                      ),
                  ),
                );
              assert(
                numeric &&
                  (await page.locator("tbody .resource-number").count()) > 0,
                "Material figures are right aligned with tabular numerals",
              );
            }
          }
          await page.screenshot({
            path: join(out, file),
            type: "jpeg",
            quality: 80,
            fullPage: true,
          });
          const record = {
            role,
            label,
            path,
            actualPath: new URL(page.url()).pathname,
            width,
            file,
            usability,
            findings,
            frame: f,
            metrics,
            layout: lay,
            app: a,
          };
          report.captures.push(record);
          console.log(
            `AUDIT ${role} ${label} ${width} body=${usability.bodyWidth} findings=${findings.length}`,
          );
        } catch (error) {
          report.errors.push({
            role,
            label,
            path,
            width,
            error: String(error),
          });
          console.log(
            `AUDIT_ERROR ${role} ${label} ${width}: ${String(error).slice(0, 160)}`,
          );
        }
        writeFileSync(
          join(out, "report.json"),
          JSON.stringify(report, null, 2),
        );
      }
    }
    const guest = await newPage("guest");
    for (const [label, path] of [
      ["login", "/login"],
      ["register-farmer", "/register"],
      ["forgot-password", "/forgot-password"],
      ["trace", `/trace/${tree.tree_code}`],
      ["trace-missing", "/trace/DRN-00000000-0000-4000-8000-000000000000"],
    ])
      await capture(guest, "guest", label, path);
    await capture(guest, "guest", "register-manager", "/register", (p) =>
      p.getByRole("button", { name: "Quản lý HTX", exact: true }).click(),
    );
    const owner = await newPage("owner", ownerPhone);
    const common = [
      ["dashboard", "/"],
      ["farms", "/farms"],
      ["zones", "/zones"],
      ["trees", "/trees"],
      ["harvests", "/tree-harvests"],
      ["journal", "/cultivation-events"],
      ["iot", "/iot"],
      ["control", "/actuator-control"],
      ["devices", "/devices"],
      ["sensors", "/sensors"],
      ["actuators", "/actuators"],
      ["materials", "/materials"],
      ["standards", "/standards"],
      ["assignments", "/assignments"],
      ["requests", "/requests"],
      ["account", "/account"],
      ["cooperatives", "/cooperatives"],
    ];
    for (const [label, path] of common)
      await capture(owner, "owner", label, path);
    for (const [label, path] of [
      ["farm-detail", `/farms/${farm.farm_id}`],
      ["zone-detail", `/zones/${zone.id}`],
      ["tree-detail", `/trees/${tree.id}`],
      ["harvest-detail", `/tree-harvests/${harvest.id}`],
      ["journal-detail", `/cultivation-events/${journal._id}`],
      ["device-detail", `/devices/${device.id}`],
      ["sensor-detail", `/sensors/${sensor.id}`],
      ["material-detail", `/materials/${material.id}`],
      ["standard-detail", `/standards/${standard.id}`],
      ["coop-detail", `/cooperatives/${auditCoop.id}`],
      ["membership", `/farms/${farm.farm_id}/membership`],
      ["assigned-work", "/assigned-work"],
      ["ai-diagnoses", "/ai/diagnoses"],
      ["ai-chat", "/ai/chat"],
      ["not-found", "/page-that-does-not-exist"],
    ])
      await capture(owner, "owner", label, path);
    if (actuator)
      await capture(
        owner,
        "owner",
        "actuator-detail",
        `/actuators/${actuator.id}`,
      );
    const admin = await newPage("admin", adminPhone, adminPassword);
    for (const [label, path] of [
      ...common,
      ["pending-managers", "/pending-managers"],
      ["cooperative-new", "/cooperatives/new"],
      ["cooperative-edit", `/cooperatives/${auditCoop.id}/edit`],
      ["harvest-backdates", "/harvest-backdates"],
    ])
      await capture(admin, "admin", label, path);
    for (const kind of [
      "zone",
      "assignment",
      "tree",
      "harvest",
      "device",
      "sensor",
      "actuator",
    ])
      await capture(
        admin,
        "admin",
        `requests-${kind}`,
        `/requests?kind=${kind}`,
      );
    const managerPage = await newPage("manager", manager.phone_number);
    for (const [label, path] of common.filter(
      ([l]) => !["account"].includes(l),
    ))
      await capture(managerPage, "manager", label, path);
    for (const [label, path] of [
      ["account", "/account"],
      ["coop-updates", "/cooperative-updates"],
      ["farm-notifications", "/farm-notifications"],
    ])
      await capture(managerPage, "manager", label, path);
    const workerPage = await newPage("worker", worker.phone_number);
    for (const [label, path] of common.filter(([l]) =>
      [
        "dashboard",
        "farms",
        "zones",
        "trees",
        "journal",
        "iot",
        "control",
        "requests",
        "account",
      ].includes(l),
    ))
      await capture(workerPage, "worker", label, path);
    await capture(workerPage, "worker", "assigned-work", "/assigned-work");
    const empty = await newPage("empty-farmer", emptyFarmer.phone_number);
    for (const [label, path] of [
      ["dashboard", "/"],
      ["farms", "/farms"],
      ["assigned-work", "/assigned-work"],
      ["journal", "/cultivation-events"],
      ["iot", "/iot"],
      ["control", "/actuator-control"],
    ])
      await capture(empty, "empty-farmer", label, path);

    // Error, empty results, loading and open dialogs exercise layouts missed by lists.
    await capture(owner, "owner", "trees-empty-search", "/trees", async (p) => {
      await p
        .getByLabel("Tìm giống hoặc mã cây", { exact: true })
        .fill("khong-co-cay-xyz");
      await p.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
      await p.getByText("Chưa có dữ liệu phù hợp", { exact: true }).waitFor();
      assert.equal(await p.locator("tbody tr").count(), 0);
    });
    await owner.route("**/api/materials?*", (route) => route.abort("failed"));
    await capture(owner, "owner", "materials-network-error", "/materials");
    await owner.unroute("**/api/materials?*");
    await owner.route("**/api/materials?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.continue().catch(() => {});
    });
    await capture(
      owner,
      "owner",
      "materials-loading",
      "/materials",
      undefined,
      true,
    );
    await owner.unroute("**/api/materials?*");
    await capture(
      owner,
      "owner",
      "control-selected",
      "/actuator-control",
      async (p) => {
        await p
          .getByLabel("Vườn trồng", { exact: true })
          .selectOption(farm.farm_id);
        await p.getByLabel("Khu vực", { exact: true }).selectOption(zone.id);
        await p
          .getByLabel("Trạm điều khiển", { exact: true })
          .selectOption(device.id);
        await p.getByText("Chưa xác định", { exact: true }).first().waitFor();
      },
    );
    await capture(
      owner,
      "owner",
      "journal-new-dialog",
      "/cultivation-events",
      async (p) => {
        await p
          .getByRole("button", { name: "Thêm nhật ký", exact: true })
          .click();
        await p.getByRole("dialog").waitFor();
      },
    );
    await capture(
      admin,
      "admin",
      "new-standard-dialog",
      "/standards",
      async (p) => {
        await p.getByRole("button", { name: /Thêm tiêu chuẩn/ }).click();
        await p.getByRole("dialog").waitFor();
      },
    );
    // Validate mobile menu interaction without changing business data.
    await owner.setViewportSize({ width: 390, height: 900 });
    await owner.goto(`${origin}/account`);
    await settle(owner);
    const menu = owner.getByRole("button", { name: "Mở menu", exact: true });
    if (await menu.count()) {
      await menu.click();
      await owner.screenshot({
        path: join(out, "owner-mobile-menu.jpg"),
        fullPage: true,
      });
      await owner.keyboard.press("Escape");
      report.interactions.push({
        name: "mobile-menu-Escape",
        passed: await menu.evaluate((e) => e === document.activeElement),
      });
    }
    assert(
      process.env.TASTE_AUDIT_FILTER || report.captures.length > 200,
      "Audit should cover all role and viewport groups",
    );
    assert.equal(
      report.errors.length,
      0,
      "No capture or uncaught browser errors",
    );
  } finally {
    report.summary = {
      captures: report.captures.length,
      overflow: report.captures
        .filter((c) => c.usability.bodyWidth > c.width + 1)
        .map((c) => ({
          role: c.role,
          label: c.label,
          width: c.width,
          body: c.usability.bodyWidth,
        })),
      findings: report.captures.reduce((a, c) => {
        for (const f of c.findings) a[f.id] = (a[f.id] || 0) + 1;
        return a;
      }, {}),
      captureErrors: report.errors.length,
    };
    if (report.captures.length % 12 === 0) {
      writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    }
    console.log("TASTE_AUDIT_SUMMARY", JSON.stringify(report.summary));
    for (const context of contexts) await context.close();
    proxyAgent.destroy();
    await new Promise((resolve) => production.httpServer.close(resolve));
  }
}
