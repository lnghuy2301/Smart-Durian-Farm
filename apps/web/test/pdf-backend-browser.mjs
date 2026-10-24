/* global sessionStorage */
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// Compile API to .integration-dist first. Isolated RAM/Nest, captured email,
// mock SMS and MQTT disabled; never reads root .env or operator credentials.
const require = createRequire(import.meta.url);
require("reflect-metadata");
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const api = (name) => require(`${apiRoot}/.integration-dist/${name}.js`);
const { Test } = require("@nestjs/testing");
const { JwtService } = require("@nestjs/jwt");
const { AppModule } = api("src/app.module");
const { configureApplication } = api("src/application");
const { readEnvironment } = api("src/config/environment");
const { EmailSender } = api("src/users/email/email.sender");
const { AuthService } = api("src/auth/auth.service");
const { MockUserStore } = api("src/auth/mock-user.store");
const { FarmsService } = api("src/farms/farms.service");
const { StandardsService } = api("src/standards/standards.service");
const { ZonesService } = api("src/zones/zones.service");
const { TreesService } = api("src/trees/trees.service");
const { CultivationEventsStore } = api(
  "src/cultivation-events/cultivation-events.store",
);
const codes = new Map();
const config = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "PdfBrowserOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "PdfBrowserAdmin123!",
  JWT_SECRET: "pdf-browser-fixture-secret-at-least-32-bytes",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  MONGODB_URI: "mongodb://127.0.0.1:1/test",
});
const module = await Test.createTestingModule({
  imports: [AppModule.register(config)],
})
  .overrideProvider(EmailSender)
  .useValue({
    async sendVerification(email, otp) {
      codes.set(email, otp);
    },
  })
  .compile();
const app = module.createNestApplication({ logger: false });
configureApplication(app, config);
let vite, browser;
const errors = [],
  results = [];
const folder = `${webRoot}/test-results/pdf-backend`;
mkdirSync(folder, { recursive: true });
async function check(name, work) {
  await work();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await app.listen(0, "127.0.0.1");
  const apiUrl = await app.getUrl();
  const users = app.get(MockUserStore),
    owner = users.user,
    admin = users.findByPhone("0900000001");
  const farms = app.get(FarmsService),
    standard = app.get(StandardsService).create({
      code: "PDF-STD",
      name: "Quy trình canh tác",
      description: "",
      certifying_body: "HTX",
    });
  const proposal = farms.createRequest(owner.id, {
    area_size: 2,
    address: "Vườn kiểm tra PDF",
    certificate_number: "PDF-FARM",
    longitude: 106,
    latitude: 10,
  });
  const farm = farms.approve(admin.id, proposal.id);
  const zone = app.get(ZonesService).create(owner.id, {
    farm_id: farm.farm_id,
    standard_id: standard.id,
    zone_name: "Khu vực PDF",
    area_size: 1,
    longitude: 106,
    latitude: 10,
  });
  const tree = app.get(TreesService).create(owner.id, {
    zone_id: zone.id,
    variety: "Ri6",
    plant_date: "2024-01-01T00:00:00Z",
    longitude: 106,
    latitude: 10,
  });
  vite = await createServer({
    root: webRoot,
    configFile: `${webRoot}/vite.config.ts`,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/api": { target: apiUrl, changeOrigin: true } },
    },
  });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
  const executablePath =
    process.env.WEB_TEST_BROWSER ??
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  assert(existsSync(executablePath));
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const visit = (path) => page.goto(`${origin}${path}`);
  async function login(password) {
    await visit("/login");
    await page
      .getByLabel("Số điện thoại", { exact: true })
      .fill("+84900000000");
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await button("Đăng nhập").click();
    await page.locator(".sidebar").waitFor();
  }
  await check(
    "phone alias logs in; name and verified optional email update the existing account UI",
    async () => {
      await login("PdfBrowserOnly123!");
      await visit("/account");
      await page.getByLabel("Tên hiển thị mới").fill("Nguyễn Văn Hòa");
      await button("Lưu tên").click();
      await page
        .getByText("Đã cập nhật tên hiển thị.", { exact: true })
        .waitFor();
      assert.equal(users.user.user_name, "Nguyễn Văn Hòa");
      await page
        .getByLabel("Email cần xác minh")
        .fill("farmer@pdf-browser.invalid");
      await button("Gửi mã xác minh email").click();
      await page.getByLabel("Mã xác minh email", { exact: true }).waitFor();
      assert.equal(users.user.gmail, null);
      await page
        .getByLabel("Mã xác minh email", { exact: true })
        .fill(codes.get("farmer@pdf-browser.invalid"));
      await button("Xác minh email tài khoản").click();
      await page
        .getByText("Đã xác minh và lưu email tài khoản.", { exact: true })
        .waitFor();
      assert.equal(users.user.gmail_verify, true);
    },
  );
  await check(
    "Other form submits only private name and note and renders the authorized journal",
    async () => {
      await visit("/cultivation-events");
      await page.getByRole("button", { name: /^Thêm nhật ký/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Khu vực", { exact: true }).selectOption(zone.id);
      await dialog
        .getByLabel("Hoạt động", { exact: true })
        .selectOption("Other");
      await dialog
        .getByLabel("Tên công việc khác")
        .fill("PRIVATE-Tỉa cành sau thu hoạch");
      await dialog.getByLabel("Ghi chú", { exact: true }).fill("PRIVATE-NOTE");
      assert.equal(
        await dialog.getByText("Vật tư sử dụng", { exact: true }).count(),
        0,
      );
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            "/api/cultivation-events",
          ) && response.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Lưu nhật ký", exact: true })
        .click();
      assert.equal((await saved).status(), 201);
      await page
        .getByRole("heading", {
          name: "PRIVATE-Tỉa cành sau thu hoạch",
          exact: true,
        })
        .waitFor();
    },
  );
  await check(
    "changing password requires old password and phone OTP then returns to login",
    async () => {
      await visit("/account");
      await page
        .getByLabel("Mật khẩu hiện tại", { exact: true })
        .fill("PdfBrowserOnly123!");
      await button("Gửi OTP đổi mật khẩu").click();
      await page.getByLabel("Mã OTP đổi mật khẩu").waitFor();
      const otp = app.get(AuthService).testSms("0900000000").messages[0].otp;
      await page.getByLabel("Mã OTP đổi mật khẩu").fill(otp);
      await page
        .getByLabel("Mật khẩu mới", { exact: true })
        .fill("PdfBrowserChanged123!");
      await button("Xác nhận đổi mật khẩu").click();
      await page.waitForURL("**/login");
      await login("PdfBrowserChanged123!");
      await visit("/account");
      await page
        .getByRole("heading", { name: "Cập nhật tài khoản", exact: true })
        .waitFor();
      await page.screenshot({
        path: `${folder}/account-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "active input renews beyond original JWT expiry, reload preserves idle time and background reads do not renew",
    async () => {
      let now = Date.now();
      // Fake JWT clock only. Changing global Date.now also shifts Playwright's
      // own navigation clock and would double elapsed time after reload.
      const jwt = app.get(JwtService),
        sign = jwt.signAsync.bind(jwt),
        verify = jwt.verifyAsync.bind(jwt);
      jwt.signAsync = (payload, options) =>
        sign({ ...payload, iat: Math.floor(now / 1000) }, options);
      jwt.verifyAsync = (token, options) =>
        verify(token, { ...options, clockTimestamp: Math.floor(now / 1000) });
      await page.clock.install({ time: now });
      const previousToken = await page.evaluate(() =>
        sessionStorage.getItem("smart-durian.access-token"),
      );
      let renewals = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.endsWith("/api/auth/refresh"))
          renewals++;
      });
      now += 14 * 60000;
      await page.clock.fastForward(14 * 60000);
      assert.equal(renewals, 0);
      const renewed = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/api/auth/refresh"),
      );
      await page.getByLabel("Tên hiển thị mới").click();
      assert.equal((await renewed).status(), 200);
      await page.waitForFunction(
        (before) =>
          sessionStorage.getItem("smart-durian.access-token") !== before,
        previousToken,
      );
      now += 2 * 60000;
      await page.clock.fastForward(2 * 60000);
      await page.locator(".sidebar").waitFor();
      await page.reload();
      await page
        .getByRole("heading", { name: "Thông tin tài khoản", exact: true })
        .waitFor();
      const token = await page.evaluate(() =>
        sessionStorage.getItem("smart-durian.access-token"),
      );
      assert.equal(
        (
          await fetch(`${apiUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
        200,
      );
      now += 13 * 60000 + 2000;
      await page.clock.fastForward(13 * 60000 + 2000);
      await page.waitForURL("**/login");
      app.get(CultivationEventsStore).lockDue(now);
      assert.equal(
        await page.evaluate(() =>
          sessionStorage.getItem("smart-durian.access-token"),
        ),
        null,
      );
    },
  );
  await check(
    "public trace of the Locked Other journal hides its free text",
    async () => {
      const response = await fetch(
        `${apiUrl}/api/traceability/trees/${tree.tree_code}/cultivation`,
      );
      assert.equal(response.status, 200);
      const text = await response.text();
      assert(text.includes('"Other"'));
      assert(!text.includes("PRIVATE-"));
    },
  );
  assert.deepEqual(errors, []);
  console.log(`${results.length} PDF backend browser checks passed.`);
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
}
