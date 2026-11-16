/* global Buffer, document, window, sessionStorage */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// Only isolated Nest memory stores, temporary AI files and explicit worker/chat
// doubles. No .env, operating database, actual model or external provider.
const require = createRequire(new URL("../../api/package.json", import.meta.url));
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const compiled = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "--outDir", ".integration-dist"],
  { cwd: apiRoot, encoding: "utf8", timeout: 60000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
require("reflect-metadata");
const api = (name) => require(`${apiRoot}/.integration-dist/src/${name}.js`);
const { Test } = require("@nestjs/testing");
const { ObjectId } = require("mongodb");
const { AppModule } = api("app.module");
const { configureApplication } = api("application");
const { readEnvironment } = api("config/environment");
const { MockUserStore } = api("auth/mock-user.store");
const { AiWorker, ChatProvider } = api("ai/ai.worker");
const { AiStore } = api("ai/ai.store");
const { FarmsService } = api("farms/farms.service");
const { StandardsService } = api("standards/standards.service");
const { ZonesService } = api("zones/zones.service");
const root = await mkdtemp(join(tmpdir(), "sdf-web-ai-"));
const config = readEnvironment({
  NODE_ENV: "test",
  AUTH_MODE: "mock",
  AUTH_TEST_PHONE: "0900000000",
  AUTH_TEST_PASSWORD: "AiFixtureOnly123!",
  AUTH_TEST_ADMIN_PHONE: "0900000001",
  AUTH_TEST_ADMIN_PASSWORD: "AiAdminFixture123!",
  JWT_SECRET: "ai-browser-private-fixture-secret-32-chars",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
  MONGODB_URI: "mongodb://127.0.0.1:1/fixture",
});
config.ai = {
  enabled: true,
  url: "http://127.0.0.1:1",
  token: "ai-private-fixture-token-at-least-32",
  root,
  timeoutMs: 30000,
};
let enabled = false,
  workerFails = false,
  classifications = 0;
const predictions = [
  { class_id: 0, label: "anthracnose_disease", confidence: 0.8 },
  { class_id: 1, label: "yellow_leaf", confidence: 0.15 },
  { class_id: 2, label: "thrips_disease", confidence: 0.05 },
];
const module = await Test.createTestingModule({
  imports: [AppModule.register(config)],
})
  .overrideProvider(AiWorker)
  .useValue({
    async model() {
      return {
        task: "classify",
        model_sha256: "a".repeat(64),
        classes: predictions.map(({ class_id, label }) => ({
          class_id,
          label,
        })),
      };
    },
    async classify() {
      classifications++;
      if (workerFails) throw new Error("fixture worker unavailable");
      return { task: "classify", model_sha256: "a".repeat(64), predictions };
    },
  })
  .overrideProvider(ChatProvider)
  .useValue({
    configured() {
      return enabled;
    },
    async generate(input) {
      if (
        input.question === "Xin chào" ||
        input.question === "Thời tiết hôm nay thế nào?"
      )
        return {
          text:
            input.question === "Xin chào"
              ? "**Xin chào!** Tôi có thể hỗ trợ bạn."
              : "**Thời tiết hiện tại:** tôi chưa có dữ liệu trực tiếp, bạn muốn hỏi khu vực nào?",
          used_chunk_ids: [],
        };
      return {
        text: "**Nội dung kiểm thử:** đối chiếu tài liệu về chăm sóc sầu riêng.\n\n1. Theo dõi cây\n2. Ghi nhật ký",
        used_chunk_ids: [input.contexts[0].chunk_id],
      };
    },
  })
  .compile();
const app = module.createNestApplication({ logger: false });
configureApplication(app, config);
let vite, browser, page;
const folder = `${webRoot}/test-results/ai`;
mkdirSync(folder, { recursive: true });
const results = [],
  errors = [];
async function check(name, work) {
  await work();
  results.push(name);
  console.log(`PASS ${name}`);
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
try {
  await app.listen(0, "127.0.0.1");
  const apiUrl = await app.getUrl();
  async function http(path, body, token, method = body ? "POST" : "GET") {
    const response = await fetch(`${apiUrl}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  }
  const users = app.get(MockUserStore),
    owner = users.user,
    admin = users.findByPhone("0900000001");
  const proposal = app.get(FarmsService).createRequest(owner.id, {
    area_size: 2,
    address: "Vườn fixture AI",
    certificate_number: "AI-FIXTURE",
    longitude: 106,
    latitude: 10,
  });
  const farm = app.get(FarmsService).approve(admin.id, proposal.id);
  const standard = app.get(StandardsService).create({
    code: "AI-FIX",
    name: "Tiêu chuẩn kiểm thử",
    description: "",
    certifying_body: "Fixture",
  });
  const zone = app.get(ZonesService).create(owner.id, {
    farm_id: farm.farm_id,
    standard_id: standard.id,
    zone_name: "Khu vực kiểm thử AI",
    area_size: 1,
    longitude: 106,
    latitude: 10,
  });
  const now = new Date();
  await app.get(AiStore).addDocument({
    _id: new ObjectId(),
    filename: "prepared-fixture.pdf",
    title: "Tài liệu kiểm thử canh tác",
    sha256: "b".repeat(64),
    page_count: 1,
    chunks: [
      {
        id: "fixture-chunk",
        page: 1,
        text: "Chăm sóc sầu riêng sau thu hoạch cần theo dõi cây và ghi nhật ký canh tác.",
      },
    ],
    status: "Active",
    created_by: admin.id,
    created_at: now,
    updated_at: now,
    source: {
      filename: "nguon-kiem-thu.pdf",
      sha256: "c".repeat(64),
      page_map: [265],
      is_draft: true,
    },
  });
  const ownerLogin = await http("auth/login", {
    phone_number: "0900000000",
    password: "AiFixtureOnly123!",
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
    (token) => sessionStorage.setItem("smart-durian.access-token", token),
    ownerLogin.access_token,
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const visit = (path) => page.goto(`${origin}${path}`);
  const uploads = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/ai/diagnoses")
    )
      uploads.push(request);
  });
  let diagnosisId, conversationId;
  await check(
    "Farmer AI tabs use shared shell with no demo switchers or fabricated result",
    async () => {
      await visit("/ai/diagnoses");
      await button("Phân tích ảnh").waitFor();
      assert.deepEqual(
        (await page.locator(".role-nav-toggle").allTextContents()).slice(-2),
        ["Hỗ trợ AI", "Danh mục canh tác"],
      );
      const aiMenu = page.locator("#nav-ai");
      assert.equal(
        await aiMenu
          .getByRole("link", { name: "Kiểm tra ảnh sâu bệnh", exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await aiMenu
        .getByRole("link", { name: "Hỏi trợ lý canh tác", exact: true })
        .click();
      await page.waitForURL("**/ai/chat");
      await aiMenu.locator('a[href="/ai/chat"][aria-current="page"]').waitFor();
      assert.equal(
        await aiMenu
          .getByRole("link", { name: "Hỏi trợ lý canh tác", exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await aiMenu
        .getByRole("link", { name: "Kiểm tra ảnh sâu bệnh", exact: true })
        .click();
      await button("Phân tích ảnh").waitFor();
      await page
        .getByRole("navigation", { name: "Công cụ hỗ trợ canh tác" })
        .waitFor();
      assert.ok(await button("Phân tích ảnh").isDisabled());
      assert.equal(
        await page
          .getByText(
            /Demo Switcher|Demo Scenarios|142 tài liệu|Lá khỏe \(Healthy\)/,
          )
          .count(),
        0,
      );
      await page.screenshot({
        path: `${folder}/diagnosis-empty-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "invalid image stays local and cannot start inference",
    async () => {
      await page
        .getByLabel("Chọn ảnh sâu bệnh", { exact: true })
        .setInputFiles({
          name: "fake.png",
          mimeType: "image/png",
          buffer: Buffer.from("not an image"),
        });
      await page.getByRole("alert").waitFor();
      assert.equal(uploads.length, 0);
      assert.ok(await button("Phân tích ảnh").isDisabled());
    },
  );
  await check(
    "real multipart API saves scoped diagnosis, private blob image, top3 Vietnamese scores and author feedback",
    async () => {
      await page
        .getByLabel("Chọn ảnh sâu bệnh", { exact: true })
        .setInputFiles({
          name: "fixture.png",
          mimeType: "image/png",
          buffer: png,
        });
      await page
        .getByText("Gắn với khu vực vườn (không bắt buộc)", { exact: true })
        .click();
      await page
        .getByLabel("Khu vực của ảnh", { exact: true })
        .selectOption(zone.id);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/ai/diagnoses"),
      );
      await button("Phân tích ảnh").click();
      const record = await (await saved).json();
      diagnosisId = record.id;
      assert.equal(record.zone_id, zone.id);
      await page.locator(".ai-saved-photo").waitFor();
      await page.waitForFunction(
        () => document.querySelector(".ai-saved-photo")?.complete,
      );
      assert.equal(classifications, 1);
      assert.equal(uploads.length, 1);
      const uploadType = uploads[0].headers()["content-type"];
      assert.ok(uploadType.includes("multipart/form-data; boundary="));
      await page
        .getByRole("heading", { name: "Gợi ý từ ảnh của bạn", exact: true })
        .waitFor();
      assert.equal(await page.locator(".ai-predictions ol li").count(), 3);
      await page
        .locator(".ai-predictions")
        .getByText("Bệnh thán thư", { exact: true })
        .waitFor();
      assert.equal(
        await button("Phù hợp").getAttribute("aria-pressed"),
        "false",
      );
      await button("Phù hợp").click();
      await page
        .getByText("Đã ghi nhận đánh giá của bạn.", { exact: true })
        .waitFor();
      assert.equal(
        (
          await http(
            `ai/diagnoses/${diagnosisId}`,
            undefined,
            ownerLogin.access_token,
          )
        ).user_feedback,
        true,
      );
      await page.screenshot({
        path: `${folder}/diagnosis-result-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "unavailable worker reports error without inventing or storing a diagnosis",
    async () => {
      workerFails = true;
      await visit("/ai/diagnoses");
      await page
        .getByLabel("Chọn ảnh sâu bệnh", { exact: true })
        .setInputFiles({
          name: "fixture.png",
          mimeType: "image/png",
          buffer: png,
        });
      await button("Phân tích ảnh").click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        (await http("ai/diagnoses", undefined, ownerLogin.access_token)).total,
        1,
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Gợi ý từ ảnh của bạn", exact: true })
          .count(),
        0,
      );
      workerFails = false;
    },
  );
  await check(
    "disabled chatbot preserves draft and history without sending a provider request",
    async () => {
      await visit("/ai/chat");
      await page
        .getByText(/Trợ lý hiện chưa được kết nối dịch vụ trả lời/)
        .waitFor();
      await page
        .getByLabel("Câu hỏi của bạn", { exact: true })
        .fill("Chăm sóc sầu riêng sau thu hoạch?");
      assert.ok(await button("Gửi câu hỏi").isDisabled());
      assert.equal(
        (await http("ai/conversations", undefined, ownerLogin.access_token))
          .total,
        0,
      );
      await page.screenshot({
        path: `${folder}/chat-disabled-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "configured fixture chat persists a real message pair and shows only source filename and original page",
    async () => {
      enabled = true;
      await button("Kiểm tra kết nối").click();
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/messages"),
      );
      await button("Gửi câu hỏi").click();
      const record = await (await saved).json();
      conversationId = record.id;
      await page.locator(".ai-message.assistant").waitFor();
      assert.equal(record.messages.length, 2);
      await page.getByText("Xem 1 nguồn tham khảo", { exact: true }).click();
      await page.getByText("1. nguon-kiem-thu.pdf", { exact: true }).waitFor();
      await page.getByText("Trang 265", { exact: true }).waitFor();
      assert.equal(await page.locator(".ai-source blockquote").count(), 0);
      assert.equal(
        await page
          .locator(".ai-source")
          .getByText(/Dự thảo|phân loại nguồn/)
          .count(),
        0,
      );
      await page.screenshot({
        path: `${folder}/chat-answer-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "409 keeps draft, sends once and requires explicit conversation reconciliation",
    async () => {
      let posts = 0;
      const path = `**/api/ai/conversations/${conversationId}/messages`;
      await page.route(path, (route) => {
        posts++;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: "fixture concurrent change" }),
        });
      });
      await page
        .getByLabel("Câu hỏi của bạn", { exact: true })
        .fill("Chăm sóc sầu riêng và ghi nhật ký?");
      await button("Gửi câu hỏi").click();
      await page.getByRole("alert").waitFor();
      assert.equal(posts, 1);
      assert.equal(
        await page.getByLabel("Câu hỏi của bạn", { exact: true }).inputValue(),
        "Chăm sóc sầu riêng và ghi nhật ký?",
      );
      assert.ok(await button("Gửi câu hỏi").isDisabled());
      await page.unroute(path);
      await button("Tải lại hội thoại").click();
      await page.locator(".ai-message.assistant").waitFor();
      await page.getByLabel("Câu hỏi của bạn", { exact: true }).waitFor();
      assert.equal(
        (
          await http(
            `ai/conversations/${conversationId}`,
            undefined,
            ownerLogin.access_token,
          )
        ).messages.length,
        2,
      );
    },
  );
  await check(
    "failed first message keeps the created conversation and draft without creating a duplicate",
    async () => {
      await page
        .getByRole("link", { name: "Cuộc trò chuyện mới", exact: true })
        .click();
      const draft = "Chăm sóc sầu riêng sau thu hoạch và ghi nhật ký?";
      await page.getByLabel("Câu hỏi của bạn", { exact: true }).fill(draft);
      const path = "**/api/ai/conversations/*/messages";
      await page.route(path, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "fixture first message failed" }),
        }),
      );
      await button("Gửi câu hỏi").click();
      await page.waitForURL((url) => url.searchParams.has("id"));
      await page.getByText(/fixture first message failed/).waitFor();
      assert.equal(
        (await http("ai/conversations", undefined, ownerLogin.access_token))
          .total,
        2,
      );
      assert.equal(
        await page.getByLabel("Câu hỏi của bạn", { exact: true }).inputValue(),
        draft,
      );
      assert.ok(await button("Gửi câu hỏi").isDisabled());
      await page.unroute(path);
      await button("Tải lại hội thoại").click();
      await page
        .getByText(
          "Hội thoại chưa có câu trả lời. Nội dung chưa gửi vẫn ở ô bên dưới.",
          { exact: true },
        )
        .waitFor();
      const sent = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/messages"),
      );
      await button("Gửi câu hỏi").click();
      assert.equal((await sent).status(), 201);
      await page.locator(".ai-message.assistant").waitFor();
      assert.equal(
        (await http("ai/conversations", undefined, ownerLogin.access_token))
          .total,
        2,
      );
      assert.equal(
        await page.getByText(/fixture first message failed/).count(),
        0,
      );
    },
  );
  await check(
    "other Farmer cannot read private image/chat; Admin and Manager direct URLs stay guarded",
    async () => {
      const other = await http("auth/register", {
        user_name: "Farmer fixture riêng",
        phone_number: "0900000002",
        password: "AiOtherFixture123!",
        role: "Farmer",
      });
      const otherLogin = await http("auth/login", {
        phone_number: other.user.phone_number,
        password: "AiOtherFixture123!",
      });
      const manager = users.add({
        user_name: "Manager AI fixture",
        phone_number: "0900000003",
        password: owner.password,
        gmail: "ai-manager@fixture.invalid",
        gmail_verify: true,
        role: "Manager",
        status: "Active",
        is_owner: false,
      });
      for (const [phone, password, role] of [
        ["0900000001", "AiAdminFixture123!", "Admin"],
        [manager.phone_number, "AiFixtureOnly123!", "Manager"],
      ]) {
        const signed = await http("auth/login", {
          phone_number: phone,
          password,
        });
        const ctx = await browser.newContext();
        await ctx.addInitScript(
          (token) => sessionStorage.setItem("smart-durian.access-token", token),
          signed.access_token,
        );
        const p = await ctx.newPage();
        const calls = [];
        p.on("request", (request) => {
          if (request.url().includes("/api/ai/")) calls.push(request.url());
        });
        await p.goto(`${origin}/ai/diagnoses`);
        await p
          .getByRole("heading", {
            name: "Không có quyền truy cập",
            exact: true,
          })
          .waitFor();
        assert.equal(calls.length, 0, role);
        await ctx.close();
      }
      const ctx = await browser.newContext();
      await ctx.addInitScript(
        (token) => sessionStorage.setItem("smart-durian.access-token", token),
        otherLogin.access_token,
      );
      const p = await ctx.newPage();
      await p.goto(`${origin}/ai/diagnoses?id=${diagnosisId}`);
      await p.getByRole("alert").waitFor();
      assert.equal(await p.locator(".ai-saved-photo").count(), 0);
      await p.goto(`${origin}/ai/chat?id=${conversationId}`);
      await p.getByRole("alert").waitFor();
      assert.equal(await p.locator(".ai-message").count(), 0);
      await ctx.close();
    },
  );
  await check(
    "both AI tools stay readable at short desktop and mobile without horizontal overflow",
    async () => {
      for (const viewport of [
        { width: 1366, height: 640 },
        { width: 390, height: 844 },
        { width: 320, height: 740 },
      ]) {
        await page.setViewportSize(viewport);
        for (const [name, path] of [
          ["diagnosis", `/ai/diagnoses?id=${diagnosisId}`],
          ["chat", `/ai/chat?id=${conversationId}`],
        ]) {
          await visit(path);
          await page
            .getByRole("navigation", { name: "Công cụ hỗ trợ canh tác" })
            .waitFor();
          if (name === "diagnosis")
            await page.locator(".ai-saved-photo").waitFor();
          else await page.locator(".ai-message.assistant").waitFor();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            `${name} ${viewport.width}`,
          );
          await page.screenshot({
            path: `${folder}/${name}-${viewport.width}.png`,
            fullPage: true,
          });
        }
      }
    },
  );
  await check(
    "history opens the full conversation and confirmed deletion removes only the selected chat",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await visit("/ai/chat");
      const chat = await http(
        `ai/conversations/${conversationId}`,
        undefined,
        ownerLogin.access_token,
      );
      const history = page.locator(".ai-chat-history");
      await history.locator("summary").click();
      const row = history.locator("li").filter({ hasText: chat.session_title });
      await row.getByRole("link", { name: "Xem lại", exact: true }).click();
      await page.locator(".ai-message.assistant").first().waitFor();
      assert.equal(await history.getAttribute("open"), null);
      const pane = await page.locator(".ai-messages").boundingBox();
      assert.ok(pane.height >= 340 && pane.width > 800);
      assert.ok((await page.locator(".ai-chat").boundingBox()).y < 150);
      await page.screenshot({
        path: `${folder}/chat-history-review.png`,
        fullPage: true,
      });
      await history.locator("summary").click();
      await row.getByRole("button", { name: /^Xóa hội thoại:/ }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Đóng", exact: true })
        .first()
        .click();
      assert.ok(
        (
          await http(
            `ai/conversations/${conversationId}`,
            undefined,
            ownerLogin.access_token,
          )
        ).messages.length > 0,
      );
      await row.getByRole("button", { name: /^Xóa hội thoại:/ }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Xác nhận", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForURL(/\/ai\/chat$/);
      assert.ok(
        !(
          await http("ai/conversations", undefined, ownerLogin.access_token)
        ).items.some((item) => item.id === conversationId),
      );
      assert.equal(
        (
          await fetch(`${apiUrl}/api/ai/conversations/${conversationId}`, {
            headers: { Authorization: `Bearer ${ownerLogin.access_token}` },
          })
        ).status,
        404,
      );
    },
  );
  await check(
    "general chat renders Markdown and does not invent document citations for greetings or weather",
    async () => {
      await visit("/ai/chat");
      for (const question of ["Xin chào", "Thời tiết hôm nay thế nào?"]) {
        await page
          .getByLabel("Câu hỏi của bạn", { exact: true })
          .fill(question);
        const sent = page.waitForResponse(
          (response) =>
            response.url().endsWith("/messages") &&
            response.request().method() === "POST",
        );
        await button("Gửi câu hỏi").click();
        assert.equal((await sent).status(), 201);
        const reply = page.locator(".ai-message.assistant").last();
        await reply
          .locator(".ai-markdown strong")
          .filter({
            hasText:
              question === "Xin chào" ? "Xin chào!" : "Thời tiết hiện tại:",
          })
          .waitFor();
        assert.equal(await reply.locator(".ai-sources").count(), 0);
        assert.equal(
          await reply.getByText(/chưa có nguồn|không trích tài liệu/).count(),
          0,
        );
        assert.ok(!(await reply.innerText()).includes("**"));
      }
      await page.screenshot({
        path: `${folder}/chat-general-markdown.png`,
        fullPage: true,
      });
    },
  );
  await check('Farmer cancels or confirms image history deletion; deleting the selected record clears its view', async () => {
    await visit(`/ai/diagnoses?id=${diagnosisId}`);
    const remove = page.getByRole('button', { name: /^Xóa lần kiểm tra ảnh:/ }).first();
    await remove.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await remove.click();
    const result = page.waitForResponse(r => r.url().endsWith(`/ai/diagnoses/${diagnosisId}`) && r.request().method() === 'DELETE');
    await dialog.getByRole('button', { name: /Xác nhận/ }).click();
    assert.equal((await result).status(), 200);
    await button('Phân tích ảnh').waitFor();
    assert.equal((await http('ai/diagnoses', undefined, ownerLogin.access_token)).total, 0);
  });
  assert.deepEqual(errors, []);
  console.log(`${results.length} AI browser checks passed.`);
} catch (error) {
  await page?.screenshot({ path: `${folder}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await app.close();
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), "sdf-web-ai-")));
  await rm(root, { recursive: true, force: true });
}
