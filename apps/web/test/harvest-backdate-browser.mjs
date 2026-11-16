/* global sessionStorage */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const require = createRequire(new URL("../../api/package.json", import.meta.url));
const api = (n) =>
  require(
    fileURLToPath(
      new URL(`../../api/.integration-dist/src/${n}.js`, import.meta.url),
    ),
  );
const { createApplication } = api("application"),
  { readEnvironment } = api("config/environment");
const { MockUserStore } = api("auth/mock-user.store"),
  { FarmsService } = api("farms/farms.service");
const { ZonesService } = api("zones/zones.service"),
  { StandardsService } = api("standards/standards.service");
const { AssignmentsService } = api("assignments/assignments.service");
const cfg = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "FixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "FixtureAdmin123!",
  JWT_SECRET: "backdate-browser-fixture-secret-32-chars",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
  MONGODB_URI: "mongodb://127.0.0.1:1/fixture",
});
const app = await createApplication(cfg);
let vite, browser;
try {
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const users = app.get(MockUserStore),
    owner = users.user,
    admin = users.findByPhone("0900000001");
  owner.user_name = "Nguyễn Văn Chủ";
  const worker = users.add({
    ...owner,
    user_name: "Trần Văn Công",
    phone_number: "0949990123",
    is_owner: false,
  });
  const other = users.add({
    ...owner,
    user_name: "Người ngoài",
    phone_number: "0949990124",
  });
  const farms = app.get(FarmsService),
    zones = app.get(ZonesService),
    assignments = app.get(AssignmentsService);
  const standard = app.get(StandardsService).create({
    code: "BACKDATE-STD",
    name: "Tiêu chuẩn kiểm thử",
    description: "",
    certifying_body: "Fixture",
  });
  function farmFor(user, address) {
    const proposal = farms.createRequest(user.id, {
      area_size: 2,
      address,
      certificate_number: address,
      longitude: 106,
      latitude: 10,
    });
    return farms.approve(admin.id, proposal.id).farm_id;
  }
  const farm = farmFor(owner, "Vườn có phân công"),
    outsiderFarm = farmFor(other, "Vườn ngoài phạm vi");
  const zoneInput = {
    standard_id: standard.id,
    area_size: 0.5,
    longitude: 106,
    latitude: 10,
  };
  const z1 = zones.create(owner.id, {
    ...zoneInput,
    farm_id: farm,
    zone_name: "Khu chủ vườn",
  });
  const z2 = zones.create(owner.id, {
    ...zoneInput,
    farm_id: farm,
    zone_name: "Khu được phân công",
  });
  zones.create(other.id, {
    ...zoneInput,
    farm_id: outsiderFarm,
    zone_name: "Khu không liên quan",
  });
  const invitation = assignments.createRequest(owner.id, z2.id, {
    user_id: worker.id,
  });
  for (const signer of invitation.required_approvals.filter(
    (a) => !a.approved_at,
  ))
    assignments.approve(signer.user_id, invitation.id);
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: "0900000001",
      password: "FixtureAdmin123!",
    }),
  });
  const token = (await r.json()).access_token;
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/api": { target: base, changeOrigin: true } },
    },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.WEB_TEST_BROWSER ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  await context.addInitScript(
    (t) => sessionStorage.setItem("smart-durian.access-token", t),
    token,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${vite.resolvedUrls.local[0]}harvest-backdates`);
  await page
    .getByRole("button", { name: "Cấp quyền nhập bù", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const search = dialog.getByLabel("Tìm Farmer theo tên hoặc số điện thoại");
  await search.fill("Nguyen Van Chu");
  await dialog.getByRole("button", { name: "Tìm Farmer", exact: true }).click();
  await dialog.getByLabel("Người được cấp quyền").selectOption(owner.id);
  await dialog.getByLabel("Vườn của Farmer").selectOption(farm);
  assert.equal(
    await dialog.getByLabel("Khu vực được cấp quyền").locator("option").count(),
    3,
  );
  await search.fill("0949990");
  await dialog.getByRole("button", { name: "Tìm Farmer", exact: true }).click();
  await dialog.getByLabel("Người được cấp quyền").selectOption(worker.id);
  await dialog.getByLabel("Vườn của Farmer").selectOption(farm);
  const zoneSelect = dialog.getByLabel("Khu vực được cấp quyền");
  await zoneSelect.selectOption(z2.id);
  assert.equal(await zoneSelect.locator("option").count(), 2);
  assert.equal(await zoneSelect.locator(`option[value="${z1.id}"]`).count(), 0);
  await dialog
    .getByLabel("Ngày thu hoạch", { exact: true })
    .fill(new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10));
  const future = new Date(Date.now() + 86400000);
  future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
  await dialog
    .getByLabel("Hạn sử dụng", { exact: true })
    .fill(future.toISOString().slice(0, 16));
  await dialog
    .getByLabel("Lý do cấp quyền", { exact: true })
    .fill("Bổ sung hồ sơ thu hoạch đã đối chiếu.");
  const saved = page.waitForResponse(
    (resp) =>
      resp.url().endsWith("/harvest-backdate-permissions") &&
      resp.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Lưu thông tin", exact: true })
    .click();
  assert.equal((await saved).status(), 201);
  await dialog.waitFor({ state: "detached" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page
    .getByRole("button", { name: "Cấp quyền nhập bù", exact: true })
    .click();
  assert(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    "Grant dialog overflows at320px",
  );
  await page.setViewportSize({ width: 1366, height: 640 });
  assert(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    "Grant dialog overflows at short desktop",
  );
  console.log(
    "PASS Admin name/phone search, owner/assignee scope, stale selection clearing and real grant POST; no external services.",
  );
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
}
