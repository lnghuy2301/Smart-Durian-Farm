import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { checkTasteAudit } from "./taste-audit-browser.mjs";

// Dedicated memory-only entry point. This file never reads .env or connects
// to the operating databases, SMTP, model, LLM or physical MQTT stations.
const require = createRequire(new URL("../../api/package.json", import.meta.url));
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));
const compiled = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "--outDir", ".test-dist"],
  { cwd: apiRoot, encoding: "utf8", timeout: 60000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
require("reflect-metadata");
const apiModule = (name) => require(`${apiRoot}/.test-dist/src/${name}.js`);
const { Test } = require("@nestjs/testing");
const { AppModule } = apiModule("app.module");
const { configureApplication } = apiModule("application");
const { readEnvironment } = apiModule("config/environment");
const config = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "TasteFixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "TasteAdminOnly123!",
  JWT_SECRET: "taste-memory-only-fixture-secret-at-least-32",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
  MONGODB_URI: "mongodb://fixture:fixture@127.0.0.1:1/fixture",
});
const module = await Test.createTestingModule({
  imports: [AppModule.register(config)],
}).compile();
const app = module.createNestApplication({ logger: false });
configureApplication(app, config);
let browser;
try {
  await app.listen(0, "127.0.0.1");
  const origin = await app.getUrl();
  const http = async (path, method = "GET", body, token, expected) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(
      response.status,
      expected ?? (method === "POST" ? 201 : 200),
      `${method} ${path}: ${JSON.stringify(result)}`,
    );
    return result;
  };
  const adminToken = (
    await http(
      "auth/login",
      "POST",
      {
        phone_number: config.auth.admin.phoneNumber,
        password: config.auth.admin.password,
      },
      undefined,
      200,
    )
  ).access_token;
  const standard = await http(
    "standards",
    "POST",
    {
      code: "AUDIT-VG",
      name: "Canh tác an toàn theo VietGAP",
      description: "Dữ liệu mô phỏng cô lập để kiểm tra giao diện.",
      certifying_body: "Đơn vị kiểm tra mô phỏng",
    },
    adminToken,
  );
  for (let i = 0; i < 17; i++)
    await http(
      "materials",
      "POST",
      {
        name: `Phân hữu cơ vi sinh nhóm ${i + 1}`,
        material_type: "Fertilizer",
        default_dosage: "25",
        unit: "g",
        quarantine_days: 7,
      },
      adminToken,
    );
  browser = await chromium.launch({
    executablePath:
      process.env.WEB_TEST_BROWSER ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  await checkTasteAudit({
    browser,
    origin,
    http,
    app,
    apiModule,
    config,
    standard,
    screenshots: fileURLToPath(new URL("../test-results", import.meta.url)),
  });
} finally {
  await browser?.close();
  await app.close();
}
