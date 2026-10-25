/* global sessionStorage, document */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// Isolated Nest/RAM, fake email and JWT clock. Never loads .env, sends mail,
// touches the operating database or changes the operator's Manager account.
const require = createRequire(import.meta.url);
require("reflect-metadata");
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = fileURLToPath(
  new URL("../../api/.integration-dist/src/", import.meta.url),
);
const api = (name) => require(`${apiRoot}/${name}.js`);
const { Test } = require("@nestjs/testing");
const { JwtService } = require("@nestjs/jwt");
const { AppModule } = api("app.module");
const { configureApplication } = api("application");
const { readEnvironment } = api("config/environment");
const { EmailSender } = api("users/email/email.sender");
const { EmailVerificationService } = api(
  "users/email/email-verification.service",
);
const { UsersService } = api("users/users.service");
const { MockUserStore } = api("auth/mock-user.store");
const { MockCooperativeStore } = api("users/mock-cooperative.store");
const codes = new Map();
const config = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "OwnerFixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "AdminFixtureOnly123!",
  JWT_SECRET: "approval-refresh-fixture-secret-at-least-32-bytes",
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
let browser, vite;
try {
  await app.listen(0, "127.0.0.1");
  const email = app.get(EmailVerificationService),
    users = app.get(UsersService);
  const phone = "0900000095",
    gmail = "approval-refresh@example.org";
  const issued = await email.request(phone, gmail);
  const proof = email.verify({
    phone_number: phone,
    gmail,
    verification_id: issued.verification_id,
    otp: codes.get(gmail),
  });
  const manager = (
    await users.register({
      user_name: "Manager refresh fixture",
      phone_number: phone,
      gmail,
      role: "Manager",
      password: "ManagerFixtureOnly123!",
      email_verification_token: proof.email_verification_token,
    })
  ).user;
  const coops = app.get(MockCooperativeStore);
  const cooperative = coops.create(
    {
      cooperative_name: "HTX kiểm tra gia hạn",
      director: "Người quản lý",
      certificate_number: "REFRESH-001",
      address: "Địa chỉ kiểm thử",
      contact_number: "0900000096",
    },
    null,
  );
  let now = Date.now();
  const jwt = app.get(JwtService),
    sign = jwt.signAsync.bind(jwt),
    verify = jwt.verifyAsync.bind(jwt);
  jwt.signAsync = (payload, options) =>
    sign({ ...payload, iat: Math.floor(now / 1000) }, options);
  jwt.verifyAsync = (token, options) =>
    verify(token, { ...options, clockTimestamp: Math.floor(now / 1000) });
  vite = await createServer({
    root: webRoot,
    configFile: `${webRoot}/vite.config.ts`,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/api": { target: await app.getUrl(), changeOrigin: true } },
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
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [],
    counts = new Map();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) counts.set(path, (counts.get(path) ?? 0) + 1);
  });
  await page.clock.install({ time: now });
  await page.goto(`${origin}/login`);
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0900000001");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("AdminFixtureOnly123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.locator(".sidebar").waitFor();
  await page.goto(`${origin}/pending-managers`);
  await page.getByRole("button", { name: "Duyệt", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const select = dialog.getByLabel("Chọn HTX chưa có Manager");
  await select.selectOption(cooperative.id);
  const baseline = new Map(counts);
  async function renewWhileEditing() {
    const before = await page.evaluate(() =>
      sessionStorage.getItem("smart-durian.access-token"),
    );
    const renewed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/refresh",
    );
    now += 16000;
    await page.clock.fastForward(16000);
    await dialog
      .getByRole("heading", { name: "Duyệt tài khoản Manager", exact: true })
      .click();
    assert.equal((await renewed).status(), 200);
    await page.waitForFunction(
      (token) => sessionStorage.getItem("smart-durian.access-token") !== token,
      before,
    );
    // A new JWT must update credentials without replacing this DOM subtree.
    await page.waitForFunction(
      () => document.querySelector("dialog")?.open === true,
    );
    assert.equal(new URL(page.url()).pathname, "/pending-managers");
  }
  await renewWhileEditing();
  assert.equal(await select.inputValue(), cooperative.id);
  console.log(
    "PASS open approval and selected cooperative survive JWT refresh",
  );
  await dialog
    .getByRole("button", { name: "Kiểm tra và xác nhận", exact: true })
    .click();
  await renewWhileEditing();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Xác nhận duyệt", exact: true })
      .count(),
    1,
  );
  assert.equal(
    counts.get("/api/users/pending-managers"),
    baseline.get("/api/users/pending-managers"),
  );
  assert.equal(
    counts.get("/api/users/cooperatives"),
    baseline.get("/api/users/cooperatives"),
  );
  console.log(
    "PASS confirmation survives a second refresh without refetching lists",
  );
  const approved = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/users/${manager.id}/approve`,
  );
  await dialog
    .getByRole("button", { name: "Xác nhận duyệt", exact: true })
    .click();
  assert.equal((await approved).status(), 200);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(coops.get(cooperative.id).manager_id, manager.id);
  assert.equal(app.get(MockUserStore).findById(manager.id).status, "Active");
  assert.equal(counts.get(`/api/users/${manager.id}/approve`), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS approval commits once after refresh; Manager Active and attached to correct cooperative",
  );
  for (const path of ["/", "/cooperatives"]) {
    await page.goto(`${origin}${path}`);
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", {
        name: cooperative.cooperative_name,
        exact: true,
      }),
    });
    await row.getByText(manager.user_name, { exact: true }).waitFor();
    assert(
      (await row.getByRole("cell").nth(1).innerText()).includes(
        cooperative.director,
      ),
    );
    assert.equal(coops.get(cooperative.id).director, cooperative.director);
    console.log(
      `PASS ${path} shows assigned Manager name separately from cooperative representative`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
}
