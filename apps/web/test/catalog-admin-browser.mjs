/* global sessionStorage */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// Only isolated RAM + mock providers. No .env, live DB or external commands.
const require = createRequire(new URL("../../api/package.json", import.meta.url));
const apiRoot = fileURLToPath(
  new URL("../../api/.integration-dist/src/", import.meta.url),
);
const api = (name) => require(`${apiRoot}/${name}.js`);
const { readEnvironment } = api("config/environment");
const { createApplication } = api("application");
const config = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "CatalogFarmerOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "CatalogAdminOnly123!",
  JWT_SECRET: "catalog-fixture-secret-with-at-least-32-bytes",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  MONGODB_URI: "mongodb://127.0.0.1:1/test",
});
const app = await createApplication(config, false);
let browser, vite;
try {
  await app.listen(0, "127.0.0.1");
  const root = fileURLToPath(new URL("..", import.meta.url));
  vite = await createServer({
    root,
    configFile: `${root}/vite.config.ts`,
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
    headless: true,
    executablePath:
      process.env.WEB_TEST_BROWSER ??
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visit = (path) => page.goto(origin + path);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const dialog = page.getByRole("dialog");
  const response = (path, method) =>
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/${path}` &&
        r.request().method() === method,
    );
  async function save(path, method) {
    const pending = response(path, method);
    await dialog
      .getByRole("button", { name: "Lưu thông tin", exact: true })
      .click();
    const result = await pending;
    assert(result.ok(), `${method} ${path}: ${result.status()}`);
    await dialog.waitFor({ state: "detached" });
    return result.json();
  }
  async function login(phone, password) {
    await visit("/login");
    await page.getByLabel("Số điện thoại", { exact: true }).fill(phone);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await button("Đăng nhập").click();
    await page.locator(".sidebar").waitFor();
  }
  await login("0900000001", "CatalogAdminOnly123!");
  await visit("/materials");
  await button("Thêm vật tư").click();
  await dialog
    .getByLabel("Tên vật tư", { exact: true })
    .fill("Phân hữu cơ kiểm thử");
  await dialog
    .getByLabel("Loại vật tư", { exact: true })
    .selectOption("Fertilizer");
  await dialog.getByLabel("Liều dùng tham khảo", { exact: true }).fill("2.5");
  await dialog.getByLabel("Đơn vị liều", { exact: true }).fill("kg");
  await dialog.getByLabel("Cơ sở liều", { exact: true }).fill("cây/lần");
  const material = await save("materials", "POST");
  assert.equal(material.default_dosage_value, 2.5);
  await visit(`/materials/${material.id}`);
  await button("Sửa vật tư").click();
  await dialog.getByLabel("Liều dùng tham khảo", { exact: true }).fill("3.25");
  assert.equal(
    (await save(`materials/${material.id}`, "PATCH")).default_dosage_value,
    3.25,
  );
  console.log(
    "PASS Admin creates and edits numeric dosage with unit/basis through real API",
  );
  await visit("/standards");
  await button("Thêm tiêu chuẩn").click();
  await dialog.getByLabel("Mã tiêu chuẩn", { exact: true }).fill("CATALOG-01");
  await dialog
    .getByLabel("Tên tiêu chuẩn", { exact: true })
    .fill("Quy trình kiểm thử");
  await dialog
    .getByLabel("Đơn vị chứng nhận", { exact: true })
    .fill("Đơn vị kiểm thử");
  const standard = await save("standards", "POST");
  assert.equal(standard.description, "");
  await visit(`/standards/${standard.id}`);
  await button("Sửa tiêu chuẩn").click();
  await dialog
    .getByLabel("Mô tả tiêu chuẩn", { exact: true })
    .fill("Mô tả đã cập nhật");
  assert.equal(
    (await save(`standards/${standard.id}`, "PATCH")).description,
    "Mô tả đã cập nhật",
  );
  await button("Sửa tiêu chuẩn").click();
  await dialog.getByLabel("Mô tả tiêu chuẩn", { exact: true }).fill("");
  assert.equal(
    (await save(`standards/${standard.id}`, "PATCH")).description,
    "",
  );
  await button("Gắn vật tư").click();
  await dialog.getByLabel("Vật tư", { exact: true }).selectOption(material.id);
  await save(`standards/${standard.id}/materials`, "POST");
  const panel = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Vật tư liên kết",
      exact: true,
    }),
  });
  await panel.getByRole("link", { name: material.name, exact: true }).waitFor();
  await panel.getByRole("button", { name: "Bỏ liên kết", exact: true }).click();
  const removed = response(
    `standards/${standard.id}/materials/${material.id}`,
    "DELETE",
  );
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  assert.equal((await removed).status(), 204);
  await dialog.waitFor({ state: "detached" });
  await panel
    .getByRole("link", { name: material.name, exact: true })
    .waitFor({ state: "detached" });
  console.log(
    "PASS Admin creates/edits standard and links/unlinks material without deleting catalog rows",
  );
  const token = await page.evaluate(() =>
    sessionStorage.getItem("smart-durian.access-token"),
  );
  const auth = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const legacyResponse = await fetch(`${await app.getUrl()}/api/materials`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Liều văn bản cũ",
      material_type: "Biological",
      default_dosage: "Theo hướng dẫn trên nhãn",
      unit: "ml",
      quarantine_days: 0,
    }),
  });
  assert.equal(legacyResponse.status, 201);
  const legacy = await legacyResponse.json();
  await visit(`/materials/${legacy.id}`);
  await button("Sửa vật tư").click();
  await dialog
    .getByLabel("Tên vật tư", { exact: true })
    .fill("Vật tư cũ đổi tên");
  const updated = await save(`materials/${legacy.id}`, "PATCH");
  assert.equal(updated.default_dosage, legacy.default_dosage);
  assert.equal(updated.default_dosage_value, legacy.default_dosage_value);
  console.log(
    "PASS unrelated legacy edit preserves dosage prose without guessing numeric values",
  );
  await button("Đăng xuất").click();
  await login("0900000000", "CatalogFarmerOnly123!");
  await visit("/materials");
  assert.equal(await button("Thêm vật tư").count(), 0);
  await visit(`/materials/${material.id}`);
  assert.equal(await button("Sửa vật tư").count(), 0);
  await visit(`/standards/${standard.id}`);
  assert.equal(await button("Gắn vật tư").count(), 0);
  assert.equal(await button("Sửa tiêu chuẩn").count(), 0);
  const farmerToken = await page.evaluate(() =>
    sessionStorage.getItem("smart-durian.access-token"),
  );
  assert.equal(
    (
      await fetch(`${await app.getUrl()}/api/materials/${material.id}`, {
        headers: { Authorization: `Bearer ${farmerToken}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${await app.getUrl()}/api/materials/${material.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${farmerToken}`,
        },
        body: JSON.stringify({ name: "Forbidden" }),
      })
    ).status,
    403,
  );
  console.log(
    "PASS Farmer remains read-only in UI and API rejects direct catalog mutation",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
}
