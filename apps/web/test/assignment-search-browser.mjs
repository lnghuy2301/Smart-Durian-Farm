import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
// Existing isolated fixture: shared RAM stores, mock providers, no .env or DB.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = fileURLToPath(
  new URL("../../api/.integration-dist/", import.meta.url),
);
const { zoneFixture } = require(
  `${apiRoot}/integration/helpers/zone-fixture.js`,
);
const { AssignmentRecords } = require(
  `${apiRoot}/src/assignments/assignment-records.js`,
);
const f = await zoneFixture();
let vite, browser;
try {
  const zone = f.zones.create(f.owner.id, f.input);
  const zoneB = f.zones.create(f.owner.id, { ...f.input, zone_name: "Khu B" });
  f.worker.user_name = "Nguyễn Văn An";
  const other = f.users.add({ ...f.worker, phone_number: "0900000044" });
  vite = await createServer({
    root,
    configFile: `${root}/vite.config.ts`,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/api": { target: await f.app.getUrl(), changeOrigin: true } },
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
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/login`);
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .fill(f.owner.phone_number);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("LocalTestOnly123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.locator(".sidebar").waitFor();
  await page.goto(`${origin}/assignments?zone_id=${zone.id}`);
  await page
    .getByRole("button", { name: "Mời phụ trách khu vực", exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    input = dialog.getByLabel("Tìm nông dân bằng tên hoặc số điện thoại");
  assert.equal(
    await dialog.getByLabel("Mã tài khoản Farmer được mời").count(),
    0,
  );
  await input.fill("nguyen van an");
  await dialog
    .getByRole("button", { name: "Tìm nông dân", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: `Chọn ${f.worker.user_name} · ${f.worker.phone_number}`,
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole("button", {
        name: `Chọn ${other.user_name} · ${other.phone_number}`,
        exact: true,
      })
      .count(),
    1,
  );
  console.log(
    "PASS accent-free name search displays duplicate names with distinct phone numbers",
  );
  await dialog
    .getByRole("button", {
      name: `Chọn ${other.user_name} · ${other.phone_number}`,
      exact: true,
    })
    .click();
  await input.fill(`+84${f.worker.phone_number.slice(1)}`);
  assert.equal(await dialog.getByText(/^Đã chọn:/).count(), 0);
  await dialog
    .getByRole("button", { name: "Tìm nông dân", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: `Chọn ${f.worker.user_name} · ${f.worker.phone_number}`,
      exact: true,
    })
    .click();
  const submitted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/zones/${zone.id}/assignment-requests` &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Lưu thông tin", exact: true })
    .click();
  const r = await submitted;
  assert.equal(r.status(), 201);
  assert.equal(r.request().postDataJSON().user_id, f.worker.id);
  const invite = await r.json();
  assert.equal(invite.status, "Pending");
  const port = f.app.get(AssignmentRecords);
  await assert.rejects(port.assertCanWork(f.worker.id, zone.id));
  const accepted = await port.approve(f.worker.id, invite.id);
  await port.end(f.owner.id, accepted.assignment_id);
  console.log(
    "PASS phone alias selects correct UUID, resets stale selection and requires Farmer acceptance",
  );
  await page.goto(`${origin}/assignments?zone_id=${zoneB.id}`);
  await page
    .getByRole("button", { name: "Mời phụ trách khu vực", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: `Chọn ${f.worker.user_name} · ${f.worker.phone_number}`,
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog.getByText("Đã làm việc tại vườn", { exact: true }).count(),
    1,
  );
  assert.equal(
    await dialog
      .getByRole("button", {
        name: `Chọn ${other.user_name} · ${other.phone_number}`,
        exact: true,
      })
      .count(),
    0,
  );
  console.log(
    "PASS blank search suggests only accepted history from the current Farm, including ended assignments",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await vite?.close();
  await f.app.close();
}
