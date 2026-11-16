/* global sessionStorage */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { loopbackBroker } from "./loopback-broker.mjs";
import {
  checkGardenTransition,
  checkTelemetryPages,
} from "./readable-requests-browser.mjs";

// Focused, isolated acceptance: no .env, production data or hardware.
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));
const require = createRequire(import.meta.url);
const compilation = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "--outDir", ".test-dist"],
  { cwd: apiRoot, encoding: "utf8", timeout: 60000 },
);
assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
require("reflect-metadata");
const { Test } = require("@nestjs/testing");
const apiModule = (path) => require(`${apiRoot}/.test-dist/src/${path}.js`);
const { AppModule } = apiModule("app.module");
const { configureApplication } = apiModule("application");
const { readEnvironment } = apiModule("config/environment");
const { readMqttConfig } = apiModule("mqtt/mqtt.config");
const broker = await loopbackBroker();
const config = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  MONGODB_URI: "mongodb://127.0.0.1:1/test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "GardenFixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "GardenAdminFixtureOnly123!",
  JWT_SECRET: "garden-browser-only-secret-at-least-32-bytes",
});
config.mqtt = {
  ...readMqttConfig({}),
  enabled: true,
  host: "127.0.0.1",
  port: broker.port,
};
const module = await Test.createTestingModule({
  imports: [AppModule.register(config)],
}).compile();
const app = module.createNestApplication({ logger: false });
configureApplication(app, config);
let browser, vite;
try {
  await app.listen(0, "127.0.0.1");
  const apiUrl = await app.getUrl();
  async function http(path, method = "GET", body, token, expected) {
    const response = await fetch(`${apiUrl}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(
      response.status,
      expected ?? (method === "POST" ? 201 : 200),
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    return data;
  }
  const workerToken = (
    await http(
      "auth/login",
      "POST",
      { phone_number: "0900000000", password: "GardenFixtureOnly123!" },
      undefined,
      200,
    )
  ).access_token;
  const adminToken = (
    await http(
      "auth/login",
      "POST",
      { phone_number: "0900000001", password: "GardenAdminFixtureOnly123!" },
      undefined,
      200,
    )
  ).access_token;
  const standard = await http(
    "standards",
    "POST",
    {
      code: "GARDEN-TEST",
      name: "Tiêu chuẩn kiểm thử",
      description: "",
      certifying_body: "Fixture",
    },
    adminToken,
  );
  const proposal = await http(
    "farms/requests",
    "POST",
    {
      area_size: 1,
      address: "Vườn kiểm thử thứ nhất",
      certificate_number: "GARDEN-A",
      longitude: 106,
      latitude: 10,
    },
    workerToken,
  );
  const accepted = await http(
    `farm-requests/${proposal.id}/approve`,
    "PATCH",
    {},
    adminToken,
  );
  const zone = await http(
    "zones",
    "POST",
    {
      farm_id: accepted.farm_id,
      standard_id: standard.id,
      zone_name: "Khu vực A",
      area_size: 0.5,
      longitude: 106,
      latitude: 10,
    },
    workerToken,
  );
  vite = await createServer({
    root: webRoot,
    configFile: `${webRoot}/vite.config.ts`,
    server: {
      port: 0,
      host: "127.0.0.1",
      proxy: { "/api": { target: apiUrl, changeOrigin: true } },
    },
  });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
  browser = await chromium.launch({
    executablePath:
      process.env.WEB_TEST_BROWSER ??
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    (value) => sessionStorage.setItem("smart-durian.access-token", value),
    workerToken,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const screenshots = `${webRoot}/test-results`;
  mkdirSync(screenshots, { recursive: true });
  const device = await checkGardenTransition({
    page,
    origin,
    http,
    workerToken,
    adminToken,
    standardId: standard.id,
    firstFarm: accepted.farm_id,
    firstZone: zone.id,
    screenshots,
  });
  console.log("PASS owned-garden transition reserves layout and changes scope");
  await checkTelemetryPages({
    page,
    origin,
    http,
    token: workerToken,
    device,
    broker,
  });
  assert.deepEqual(errors, []);
  console.log("PASS latest 10/10/3, history 12/11 and zero values");
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
  await broker.close();
}
