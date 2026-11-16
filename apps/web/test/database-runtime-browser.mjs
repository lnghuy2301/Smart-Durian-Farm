import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { loopbackBroker } from "./loopback-broker.mjs";

// Compile API first. This suite uses random PG/Mongo databases and real MQTT.js
// over loopback TCP. It never reads root.env or connects to hardware/providers.
const require = createRequire(new URL("../../api/package.json", import.meta.url));
require("reflect-metadata");
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const api = (path) => require(`${apiRoot}/.integration-dist/${path}.js`);
const { Test } = require("@nestjs/testing");
const { AppModule } = api("src/app.module");
const { configureApplication } = api("src/application");
const { readEnvironment } = api("src/config/environment");
const { MqttDiagnostics } = api("src/mqtt/mqtt-diagnostics");
const { taskPersistenceFixture, taskAuth, taskPgBase } = api(
  "integration/helpers/task-persistence-fixture",
);
const f = await taskPersistenceFixture();
const broker = await loopbackBroker();
broker.onControl((packet) => broker.ack(packet));
const config = readEnvironment({
  NODE_ENV: "test",
  BUSINESS_STORAGE: "database",
  DATABASE_URL: `${taskPgBase}/${f.name}`,
  MONGODB_URI: `mongodb://127.0.0.1:27028/${f.name}?replicaSet=rs-test&directConnection=true`,
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: taskAuth.phoneNumber,
  AUTH_TEST_PASSWORD: taskAuth.password,
  AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber,
  AUTH_TEST_ADMIN_PASSWORD: taskAuth.admin.password,
  JWT_SECRET: taskAuth.jwtSecret,
  MQTT_ENABLED: "true",
  MQTT_BROKER_HOST: "127.0.0.1",
  MQTT_BROKER_PORT: String(broker.port),
});
let app,
  vite,
  browser,
  apiUrl,
  listenPort = 0;
const results = [],
  errors = [];
const device = (
  await f.pool.query(
    "SELECT id,zone_id,station_id FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY'",
  )
).rows[0];
const tree = (
  await f.pool.query(
    "SELECT tree_code FROM public.trees WHERE zone_id=$1 ORDER BY id LIMIT 1",
    [device.zone_id],
  )
).rows[0];
async function until(work) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail("Database browser transition timed out");
}
async function check(name, work) {
  await work();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function start() {
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  }).compile();
  app = module.createNestApplication({ logger: false });
  configureApplication(app, config);
  await app.listen(listenPort, "127.0.0.1");
  apiUrl = await app.getUrl();
  listenPort = Number(new URL(apiUrl).port);
  await until(
    async () =>
      (await app.get(MqttDiagnostics).brokerStatus(f.admin)).subscribed,
  );
}
try {
  await start();
  vite = await createServer({
    root: webRoot,
    configFile: `${webRoot}/vite.config.ts`,
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      proxy: { "/api": { target: apiUrl, changeOrigin: true } },
    },
  });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
  const executablePath =
    process.env.WEB_TEST_BROWSER ??
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  assert(
    existsSync(executablePath),
    "Set WEB_TEST_BROWSER to installed Edge/Chrome",
  );
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  const visit = (path) => page.goto(`${origin}${path}`);
  const actions = () =>
    page.getByRole("region", { name: "Thao tác điều khiển", exact: true });
  const state = (text) =>
    page.locator(".control-state-grid").getByText(text, { exact: true });
  await check(
    "database login and six real MQTT TCP streams render in existing IoT page",
    async () => {
      await visit("/login");
      await page
        .getByLabel("Số điện thoại", { exact: true })
        .fill(taskAuth.phoneNumber);
      await page
        .getByLabel("Mật khẩu", { exact: true })
        .fill(taskAuth.password);
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/auth/login") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      await page.locator(".sidebar").waitFor();
      broker.publish(device.station_id, [
        { dataStreamId: 301, result: "26.54 C" },
        { dataStreamId: 302, result: "70 %" },
        { dataStreamId: 303, result: "45 %rH" },
        { dataStreamId: 304, result: "25 C" },
        { dataStreamId: 305, result: "6.5 H+" },
        { dataStreamId: 306, result: "1200 µS/cm" },
      ]);
      await until(
        async () =>
          (await f.mongo
            .db(f.name)
            .collection("IOT_TELEMETRIES")
            .countDocuments({ device_id: device.id })) === 6,
      );
      await visit(`/iot?zone_id=${device.zone_id}`);
      await page
        .getByRole("heading", { name: "Giám sát IoT", exact: true })
        .waitFor();
      await page
        .getByText(/26[,.]54/)
        .first()
        .waitFor();
      assert(
        !(await page.locator("body").innerText()).includes(
          "dữ liệu mất khi server",
        ),
      );
    },
  );
  await check(
    "database display references resolve names through scoped records without opening a user directory",
    async () => {
      const token = await page.evaluate(() =>
        sessionStorage.getItem("smart-durian.access-token"),
      );
      const owner = (await f.users.loadByPhone(taskAuth.phoneNumber)).user;
      const zone = await f.zones.get(owner.id, device.zone_id);
      const farm = await f.farms.get(owner.id, zone.farm_id);
      const endpoint = `${apiUrl}/api/display-references/farms/${farm.id}`;
      const result = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(result.status, 200);
      const body = await result.json();
      assert.equal(body.labels[owner.id], owner.user_name);
      assert.equal(body.labels[farm.id], farm.address);
      assert(!JSON.stringify(body).includes(taskAuth.phoneNumber));
      await visit(`/farms/${farm.id}`);
      await page
        .locator(".details")
        .getByText(owner.user_name, { exact: true })
        .waitFor();
      const outsider = await f.farmer();
      const login = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: outsider.phone,
          // f.farmer() deliberately reuses the isolated fixture Admin hash.
          password: taskAuth.admin.password,
        }),
      });
      assert.equal(login.status, 200);
      const other = await login.json();
      const denied = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${other.access_token}` },
      });
      assert([403, 404].includes(denied.status));
    },
  );
  await check(
    "database control uses Reset then valve-pump ACK and Stop through existing dialogs",
    async () => {
      await visit(`/actuator-control?device_id=${device.id}`);
      await actions()
        .getByRole("button", { name: /^Tưới nước/ })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(device.station_id, { exact: true }).waitFor();
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Gửi lệnh tưới", exact: true })
        .click();
      assert.equal((await response).status(), 202);
      await state("Đã nhận đủ lệnh tưới").waitFor();
      assert.deepEqual(
        broker.commands
          .slice(0, 5)
          .map(({ wire }) => [
            wire.targets[0].taskingCapabilityId,
            wire.taskingParameters.action,
          ]),
        [
          [2, 0],
          [3, 0],
          [4, 0],
          [3, 1],
          [2, 1],
        ],
      );
      await actions().getByRole("button", { name: /^Dừng/ }).click();
      await state("Đã nhận đủ lệnh dừng").waitFor();
      assert.equal(
        await f.mongo
          .db(f.name)
          .collection("ACTUATOR_TASKS")
          .countDocuments({ status: "Confirmed" }),
        3,
      );
    },
  );
  await check(
    "full backend restart retains readings and command history while control returns Unknown without boot publication",
    async () => {
      const before = broker.commands.length;
      await page.goto("about:blank");
      await app.close();
      app = undefined;
      await start();
      assert.equal(broker.commands.length, before);
      await visit(`/iot?zone_id=${device.zone_id}`);
      await page
        .getByText(/26[,.]54/)
        .first()
        .waitFor();
      await visit(`/actuator-control?device_id=${device.id}`);
      await state("Chưa xác định").first().waitFor();
      assert.equal(
        await f.mongo
          .db(f.name)
          .collection("ACTUATOR_TASKS")
          .countDocuments({ status: "Confirmed" }),
        3,
      );
    },
  );
  await check(
    "anonymous QR and responsive layouts read database without exposing private journal fields",
    async () => {
      const anonymous = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await anonymous.goto(`${origin}/trace/${tree.tree_code}`);
      await anonymous
        .getByText(tree.tree_code, { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await anonymous
          .locator("html")
          .evaluate(
            (element) =>
              element.scrollWidth <=
              element.ownerDocument.defaultView.innerWidth + 1,
          ),
        true,
      );
      assert(
        !(await anonymous.locator("body").innerText()).includes(
          taskAuth.phoneNumber,
        ),
      );
      const folder = `${webRoot}/test-results/database-runtime`;
      mkdirSync(folder, { recursive: true });
      await anonymous.screenshot({
        path: `${folder}/trace-mobile.png`,
        fullPage: true,
      });
      await anonymous.close();
      await page.screenshot({
        path: `${folder}/control-desktop.png`,
        fullPage: true,
      });
    },
  );
  assert.deepEqual(errors, []);
  console.log(`${results.length} database browser checks passed.`);
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
  await broker.close();
  await f.close();
}
