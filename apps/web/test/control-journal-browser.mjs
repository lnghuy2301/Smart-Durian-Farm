/* global sessionStorage */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const require = createRequire(new URL("../../api/package.json", import.meta.url));
require("reflect-metadata");
const api = (n) =>
  require(
    fileURLToPath(
      new URL(`../../api/.integration-dist/src/${n}.js`, import.meta.url),
    ),
  );
const { Test } = require("@nestjs/testing");
const { AppModule } = api("app.module");
const { configureApplication } = api("application");
const { readEnvironment } = api("config/environment");
const { ActuatorTaskRecords } = api("actuator-tasks/actuator-task-records");
const { MockUserStore } = api("auth/mock-user.store");
const { FarmsService } = api("farms/farms.service");
const { ZonesService } = api("zones/zones.service");
const { StandardsService } = api("standards/standards.service");
const { DevicesService } = api("devices/devices.service");
const { ActuatorsService } = api("actuators/actuators.service");
const cfg = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "FixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "FixtureAdmin123!",
  JWT_SECRET: "isolated-control-journal-secret-32-chars",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
  MONGODB_URI: "mongodb://127.0.0.1:1/fixture",
});
let device,
  items = [];
const module = await Test.createTestingModule({
  imports: [AppModule.register(cfg)],
})
  .overrideProvider(ActuatorTaskRecords)
  .useValue({
    state: async () => ({
      device_id: device.id,
      acknowledged_mode: "Off",
      physical_state: "Unknown",
      confirmation_kind: "CommandReceipt",
      busy: false,
      active_task_id: null,
      reset_required: false,
      broker_ready: true,
      ack_timeout_ms: 10000,
    }),
    list: async (_actor, _device, page) => ({
      items: items.slice(page.offset, page.offset + page.limit),
      total: items.length,
      offset: page.offset,
      limit: page.limit,
    }),
    get: async (_actor, id) => items.find((t) => t._id === id),
    brokerChanged() {},
    receiveAck() {},
    command() {
      throw new Error("No physical commands allowed in this fixture");
    },
  })
  .compile();
const app = module.createNestApplication({ logger: false });
configureApplication(app, cfg);
let vite, browser;
try {
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function http(path, body, token) {
    const r = await fetch(`${base}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(r.ok, `${path} ${r.status}`);
    return r.json();
  }
  const users = app.get(MockUserStore),
    owner = users.user,
    admin = users.findByPhone("0900000001");
  const farms = app.get(FarmsService),
    p = farms.createRequest(owner.id, {
      area_size: 2,
      address: "Vườn kiểm thử nhật ký",
      certificate_number: "JOURNAL-FIXTURE",
      longitude: 106,
      latitude: 10,
    });
  const farm = farms.approve(admin.id, p.id);
  const standard = app
    .get(StandardsService)
    .create({
      code: "JOURNAL-TEST",
      name: "Tiêu chuẩn kiểm thử",
      description: "",
      certifying_body: "Fixture",
    });
  const zone = app
    .get(ZonesService)
    .create(owner.id, {
      farm_id: farm.farm_id,
      standard_id: standard.id,
      zone_name: "Khu vực nhật ký",
      area_size: 1,
      longitude: 106,
      latitude: 10,
    });
  device = app
    .get(DevicesService)
    .create(owner.id, {
      zone_id: zone.id,
      station_id: "JOURNAL_FIXTURE_ONLY",
      installed_at: "2026-09-01T02:00:00Z",
      cost: 100,
    });
  for (const [capability_id, purpose] of [
    [2, "shared"],
    [3, "watering"],
    [4, "spraying"],
  ])
    app
      .get(ActuatorsService)
      .create(owner.id, { device_id: device.id, capability_id, purpose });
  const now = Date.now();
  const task = (id, operation, at) => ({
    _id: id.toString(16).padStart(24, "0"),
    device_id: device.id,
    command_id: id,
    targets: [],
    tasking_parameters: {
      actionType: "control",
      action: operation === "Stop" ? 0 : 1,
    },
    status: "Confirmed",
    created_at: new Date(at).toISOString(),
    sent_at: new Date(at).toISOString(),
    confirmed_at: new Date(at).toISOString(),
    error_message: null,
    response_payload: {
      operation,
      confirmation_kind: "CommandReceipt",
      parent_task_id: null,
      reset_task_id: null,
      recovery_task_id: null,
      steps: [],
    },
  });
  items = [task(2, "Stop", now), task(1, "Watering", now - 1800000)];
  const login = await http("auth/login", {
    phone_number: "0900000000",
    password: "FixtureOnly123!",
  });
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
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_BROWSER_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const context = await browser.newContext();
  await context.addInitScript(
    (token) => sessionStorage.setItem("smart-durian.access-token", token),
    login.access_token,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(
    `${origin}actuator-control?farm_id=${farm.farm_id}&zone_id=${zone.id}&device_id=${device.id}`,
  );
  await page
    .getByRole("button", { name: "Ghi nhật ký từ phiên này", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(
    await dialog
      .getByLabel("Thời lượng tưới (phút)", { exact: true })
      .inputValue(),
    "30",
  );
  assert.equal(
    (await http("cultivation-events", undefined, login.access_token)).total,
    0,
  );
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /Lưu/ }).click();
  await page.getByText("Đã lưu nhật ký chờ khóa.", { exact: false }).waitFor();
  const logs = await http("cultivation-events", undefined, login.access_token);
  assert.equal(logs.total, 1);
  assert.equal(logs.items[0].target_id, zone.id);
  assert.equal(logs.items[0].action_type, "Watering");
  assert.equal(logs.items[0].details.duration_minutes, 30);
  assert.equal(logs.items[0].status, "Pending");
  console.log(
    "PASS: no automatic log; confirmed form saves one scoped Pending journal with editable duration. No hardware/provider/database connections.",
  );
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
}
