import assert from "node:assert/strict";

// Uses the existing isolated Nest fixture. No root .env, real SMS/email, DB or hardware.
export async function checkWorkflows({
  browser,
  origin,
  http,
  check,
  app,
  apiModule,
  ownerToken,
  adminToken,
  ownerId,
  standard,
  codes,
  screenshots,
  errors,
  workerPassword = "ResetBrowserOnly123!",
  managerPassword = "BrowserOnly123!",
}) {
  const contexts = [];
  async function session(token) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(context);
    await context.addInitScript(
      (value) => sessionStorage.setItem("smart-durian.access-token", value),
      token,
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  const owner = await session(ownerToken),
    admin = await session(adminToken);
  const visit = (page, path) => page.goto(`${origin}${path}`);
  const button = (page, name) =>
    name === "Đóng"
      ? page.getByRole("button", { name, exact: true }).last()
      : page.getByRole("button", { name, exact: true });
  async function save(page, endpoint, method = "POST", name = "Lưu thông tin") {
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(`/api/${endpoint}`) &&
        r.request().method() === method,
    );
    await button(page.getByRole("dialog").last(), name).click();
    const result = await response;
    assert.equal(
      result.status(),
      method === "POST" ? 201 : 200,
      await result.text(),
    );
    return result.json();
  }
  async function review(page, kind, id) {
    await visit(page, `/requests?kind=${kind}&id=${id}`);
    await button(page, "Chấp nhận đề xuất").click();
    return save(page, `${kind}-requests/${id}/approve`, "PATCH", "Xác nhận");
  }
  let farm,
    zone,
    tree,
    device,
    sensor,
    harvest,
    journal,
    worker,
    workerPage,
    managerPage;
  try {
    await check(
      "workflow UI creates farm proposal, compares and approves through real API",
      async () => {
        await visit(owner, "/farms");
        await button(owner, "Đề xuất tạo vườn").click();
        const dialog = owner.getByRole("dialog");
        await dialog
          .getByLabel("Số chứng nhận vườn", { exact: true })
          .fill("WEB-WORKFLOW");
        await dialog
          .getByLabel("Địa chỉ vườn")
          .fill("Vườn kiểm thử các module mới");
        await dialog.getByLabel("Diện tích", { exact: true }).fill("4");
        await dialog.getByLabel("Vĩ độ", { exact: true }).fill("10");
        await dialog.getByLabel("Kinh độ", { exact: true }).fill("106");
        const request = await save(owner, "farms/requests");
        assert.equal(request.status, "Pending");
        const accepted = await review(admin, "farm", request.id);
        assert.equal(accepted.status, "Accepted");
        farm = await http(
          `farms/${accepted.farm_id}`,
          "GET",
          undefined,
          ownerToken,
        );
        assert.equal(farm.owner_id, ownerId);
        await visit(owner, "/zones");
        await button(owner, "Thêm khu vực").click();
        const form = owner.getByRole("dialog");
        await form
          .getByLabel("Vườn trồng", { exact: true })
          .selectOption(farm.id);
        await form.getByLabel("Tên khu vực").fill("Khu workflow");
        await form.getByLabel("Diện tích", { exact: true }).fill("1");
        await form
          .getByLabel("Tiêu chuẩn canh tác", { exact: true })
          .selectOption(standard.id);
        await form.getByLabel("Vĩ độ", { exact: true }).fill("10");
        await form.getByLabel("Kinh độ", { exact: true }).fill("106");
        zone = await save(owner, "zones");
        await visit(owner, "/trees");
        await button(owner, "Thêm cây sầu riêng").click();
        const treeForm = owner.getByRole("dialog");
        await treeForm.getByLabel("Khu vực trồng").selectOption(zone.id);
        await treeForm.getByLabel("Giống sầu riêng").fill("Ri6 workflow");
        await treeForm
          .getByLabel("Ngày trồng", { exact: true })
          .fill("2024-05-01T08:00");
        await treeForm.getByLabel("Vĩ độ", { exact: true }).fill("10");
        await treeForm.getByLabel("Kinh độ", { exact: true }).fill("106");
        tree = await save(owner, "trees");
        assert.match(tree.tree_code, /^DRN-/);
      },
    );
    await check(
      "tree proposal approval and stale conflict require explicit recheck",
      async () => {
        await visit(admin, `/trees/${tree.id}`);
        await button(admin, "Đề xuất chỉnh sửa").click();
        await admin
          .getByRole("dialog")
          .getByLabel("Giống sầu riêng")
          .fill("Monthong workflow");
        const proposal = await save(admin, `trees/${tree.id}/update-requests`);
        await visit(owner, `/requests?kind=tree&id=${proposal.id}`);
        await owner.getByText("Monthong workflow", { exact: true }).waitFor();
        assert.equal(
          (await review(owner, "tree", proposal.id)).status,
          "Accepted",
        );
        await visit(admin, `/trees/${tree.id}`);
        await button(admin, "Đề xuất chỉnh sửa").click();
        await admin
          .getByRole("dialog")
          .getByLabel("Giống sầu riêng")
          .fill("Đề xuất lỗi thời");
        const stale = await save(admin, `trees/${tree.id}/update-requests`);
        await http(
          `trees/${tree.id}`,
          "PATCH",
          { variety: "Chủ cập nhật mới" },
          ownerToken,
        );
        await visit(owner, `/requests?kind=tree&id=${stale.id}`);
        await button(owner, "Chấp nhận đề xuất").click();
        await button(owner.getByRole("dialog"), "Xác nhận").click();
        await owner.getByRole("alert").waitFor();
        assert.equal(
          await button(owner.getByRole("dialog"), "Xác nhận").isDisabled(),
          true,
        );
        assert.equal(
          (await http(`trees/${tree.id}`, "GET", undefined, ownerToken))
            .variety,
          "Chủ cập nhật mới",
        );
        await button(owner.getByRole("dialog"), "Đóng").click();
        await button(owner, "Từ chối / rút đề xuất").click();
        assert.equal(
          (await save(owner, `tree-requests/${stale.id}/reject`, "PATCH"))
            .status,
          "Rejected",
        );
      },
    );
    await check(
      "device sensor actuator forms, scoped tabs and nullable thresholds",
      async () => {
        await visit(owner, "/devices");
        await button(owner, "Thêm trạm IoT").click();
        let dialog = owner.getByRole("dialog");
        await dialog.getByLabel("Khu vực lắp đặt").selectOption(zone.id);
        await dialog.getByLabel("Mã trạm phần cứng").fill("WORKFLOW_STATION");
        await dialog.getByLabel("Ngày lắp đặt").fill("2026-10-01T08:00");
        await dialog.getByLabel("Chi phí", { exact: true }).fill("2500000");
        device = await save(owner, "devices");
        await visit(owner, `/devices/${device.id}`);
        await button(owner, "Thêm cảm biến").click();
        dialog = owner.getByRole("dialog");
        await dialog
          .getByLabel("Trạm IoT", { exact: true })
          .selectOption(device.id);
        await dialog.getByLabel("Tên cảm biến").fill("Nhiệt độ workflow");
        await dialog
          .getByLabel("Loại cảm biến")
          .selectOption("air_temperature");
        await dialog.getByLabel("Mã luồng dữ liệu").fill("temperature");
        await dialog.getByLabel("Đơn vị cấu hình").fill("C");
        sensor = await save(owner, "sensors");
        assert.equal(sensor.min_threshold, null);
        await owner
          .getByRole("tab", { name: "Bơm / van", exact: true })
          .click();
        await button(owner, "Thêm bơm / van").click();
        dialog = owner.getByRole("dialog");
        await dialog
          .getByLabel("Trạm IoT", { exact: true })
          .selectOption(device.id);
        await dialog.getByLabel("Tên bơm / van").fill("Bơm workflow");
        await dialog
          .getByLabel("Mục đích", { exact: true })
          .selectOption("shared");
        await dialog.getByLabel("Mã khả năng phần cứng").fill("6");
        const actuator = await save(owner, "actuators");
        assert.equal(actuator.capability_id, 6);
        await owner
          .getByRole("tab", { name: "Cây trong khu vực", exact: true })
          .click();
        await owner
          .getByRole("link", { name: tree.tree_code, exact: true })
          .waitFor();
        await visit(owner, `/sensors/${sensor.id}`);
        await button(owner, "Chỉnh sửa").click();
        await owner
          .getByRole("dialog")
          .getByLabel("Tên cảm biến")
          .fill("Cảm biến đã sửa");
        assert.equal(
          (await save(owner, `sensors/${sensor.id}`, "PATCH")).min_threshold,
          null,
        );
        await visit(admin, `/devices/${device.id}`);
        await button(admin, "Đề xuất chỉnh sửa").click();
        await admin
          .getByRole("dialog")
          .getByLabel("Chi phí", { exact: true })
          .fill("2600000");
        const proposal = await save(
          admin,
          `devices/${device.id}/update-requests`,
        );
        await review(owner, "device", proposal.id);
        assert.equal(
          (await http(`devices/${device.id}`, "GET", undefined, ownerToken))
            .cost,
          2600000,
        );
      },
    );
    await check(
      "assignment invite acceptance, read-only metadata and author harvest confirmation",
      async () => {
        worker = await http(
          "auth/login",
          "POST",
          { phone_number: "0900000010", password: workerPassword },
          undefined,
          200,
        );
        workerPage = await session(worker.access_token);
        await visit(owner, `/assignments?zone_id=${zone.id}`);
        await button(owner, "Mời phụ trách khu vực").click();
        await owner
          .getByRole("dialog")
          .getByLabel("Mã tài khoản Farmer được mời")
          .fill(worker.user.id);
        const invite = await save(
          owner,
          `zones/${zone.id}/assignment-requests`,
        );
        await review(workerPage, "assignment", invite.id);
        await visit(workerPage, `/trees/${tree.id}`);
        await workerPage
          .getByRole("heading", { name: tree.tree_code, exact: true })
          .waitFor();
        assert.equal(await button(workerPage, "Chỉnh sửa").count(), 0);
        await visit(workerPage, "/tree-harvests");
        await button(workerPage, "Ghi nhận thu hoạch").click();
        const dialog = workerPage.getByRole("dialog");
        await dialog.getByLabel("Cây thu hoạch").selectOption(tree.id);
        await dialog.getByLabel("Tên mùa vụ").fill("Vụ workflow");
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts();
        const part = (key) => parts.find((x) => x.type === key).value;
        await dialog
          .getByLabel("Ngày thu hoạch thực tế (lịch Việt Nam)")
          .fill(`${part("year")}-${part("month")}-${part("day")}`);
        await dialog.getByLabel("Số quả", { exact: true }).fill("10");
        await dialog.getByLabel("Khối lượng (kg)").fill("20");
        await dialog.getByLabel("Mã lô thu hoạch").fill("WORKFLOW-BATCH");
        harvest = await save(workerPage, "tree-harvests");
        await visit(workerPage, `/tree-harvests/${harvest.id}`);
        await button(workerPage, "Gửi xác nhận thu hoạch").click();
        assert.equal(
          (
            await save(
              workerPage,
              `tree-harvests/${harvest.id}/submit`,
              "PATCH",
              "Xác nhận",
            )
          ).status,
          "Pending",
        );
        const requests = await http(
          `harvest-requests?harvest_id=${harvest.id}`,
          "GET",
          undefined,
          ownerToken,
        );
        await visit(owner, `/requests?kind=harvest&id=${requests.items[0].id}`);
        const snapshot = owner.locator(".workflow-summary");
        await snapshot
          .getByRole("row")
          .filter({ hasText: /người tạo/i })
          .getByText(worker.user.user_name, { exact: true })
          .waitFor();
        await snapshot.getByText(tree.tree_code, { exact: true }).waitFor();
        const snapshotText = await snapshot.textContent();
        assert.ok(snapshotText.includes("Người tạo"));
        assert.ok(snapshotText.includes("Thời điểm tạo"));
        assert.ok(!snapshotText.includes("created_by"));
        assert.ok(!snapshotText.includes("created_at"));
        assert.ok(!snapshotText.includes("tree_id"));
        assert.ok(!snapshotText.includes(worker.user.id));
        assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(snapshotText));
        await owner.screenshot({
          path: `${screenshots}/readable-harvest-request.png`,
          fullPage: true,
        });
        await review(owner, "harvest", requests.items[0].id);
        assert.equal(
          (
            await http(
              `tree-harvests/${harvest.id}`,
              "GET",
              undefined,
              ownerToken,
            )
          ).status,
          "Confirmed",
        );
      },
    );
    await check(
      "former harvest author sends reason only, owner prepares and Admin approves correction",
      async () => {
        const assignments = await http(
          `zone-assignments?zone_id=${zone.id}`,
          "GET",
          undefined,
          ownerToken,
        );
        await http(
          `zone-assignments/${assignments.items[0].assignment.id}/end`,
          "PATCH",
          {},
          ownerToken,
        );
        await visit(workerPage, `/tree-harvests/${harvest.id}`);
        await button(workerPage, "Yêu cầu đính chính").click();
        const dialog = workerPage.getByRole("dialog");
        assert.equal(
          await dialog.getByLabel("Số quả", { exact: true }).count(),
          0,
        );
        await dialog
          .getByLabel("Lý do đính chính")
          .fill("Bổ sung số quả thực tế");
        const correction = await save(
          workerPage,
          `tree-harvests/${harvest.id}/correction-requests`,
        );
        assert.equal(correction.proposed_changes, null);
        await visit(owner, `/requests?kind=harvest&id=${correction.id}`);
        await button(owner, "Chuẩn bị nội dung đính chính").click();
        await owner
          .getByRole("dialog")
          .getByLabel("Số quả", { exact: true })
          .fill("12");
        await save(owner, `harvest-requests/${correction.id}/changes`, "PATCH");
        await review(admin, "harvest", correction.id);
        const value = await http(
          `tree-harvests/${harvest.id}`,
          "GET",
          undefined,
          ownerToken,
        );
        assert.equal(value.fruit_count, 12);
        assert.equal(value.updated_by, ownerId);
      },
    );
    await check(
      "journal Watering edit, automatic lock, correction lineage and real chain verification",
      async () => {
        await visit(owner, "/cultivation-events");
        await button(owner, "Thêm nhật ký").click();
        let dialog = owner.getByRole("dialog");
        await dialog
          .getByLabel("Khu vực", { exact: true })
          .selectOption(zone.id);
        await dialog.getByLabel("Thời lượng tưới (phút)").fill("15");
        await dialog.getByLabel("Lượng nước (lít, tùy chọn)").fill("120");
        await dialog
          .getByLabel("Ghi chú", { exact: true })
          .fill("Tưới workflow");
        journal = await save(
          owner,
          "cultivation-events",
          "POST",
          "Lưu nhật ký",
        );
        const deadline = journal.lock_at;
        await visit(owner, `/cultivation-events/${journal._id}`);
        await button(owner, "Chỉnh sửa nhật ký").click();
        await owner
          .getByRole("dialog")
          .getByLabel("Thời lượng tưới (phút)")
          .fill("18");
        assert.equal(
          (
            await save(
              owner,
              `cultivation-events/${journal._id}`,
              "PATCH",
              "Lưu nhật ký",
            )
          ).lock_at,
          deadline,
        );
        const store = app.get(
          apiModule("cultivation-events/cultivation-events.store")
            .CultivationEventsStore,
        );
        // Move this fixture's deadline into the past before hashing; leave the global
        // clock, JWT validity and unrelated fixtures unchanged.
        const stored = store.records.get(journal._id);
        stored.created_at = new Date(Date.now() - 16 * 60000).toISOString();
        stored.lock_at = new Date(Date.now() - 1000).toISOString();
        store.lockDue();
        await button(owner, "Kiểm tra trạng thái").click();
        await button(owner, "Tạo bản đính chính").click();
        dialog = owner.getByRole("dialog");
        await dialog.getByLabel("Thời lượng tưới (phút)").fill("20");
        await dialog
          .getByLabel("Lý do đính chính")
          .fill("Đối chiếu thời gian tưới");
        const corrected = await save(
          owner,
          `cultivation-events/${journal._id}/corrections`,
          "POST",
          "Lưu nhật ký",
        );
        assert.equal(corrected.reference_event_id, journal._id);
        assert.equal(corrected.status, "Pending");
        assert.equal(
          (
            await http(
              `cultivation-events/${journal._id}`,
              "GET",
              undefined,
              ownerToken,
            )
          ).details.duration_minutes,
          18,
        );
        await owner.getByRole("link", { name: /Bản đính chính/ }).waitFor();
        await button(owner, "Kiểm tra chuỗi khu vực").click();
        await owner
          .getByRole("dialog")
          .getByText("Chuỗi nhật ký đã khóa toàn vẹn.", { exact: true })
          .waitFor();
        await button(owner.getByRole("dialog"), "Đóng").click();
        await visit(admin, `/cultivation-events/${journal._id}`);
        await admin
          .getByRole("heading", { name: "Lịch sử các phiên bản", exact: true })
          .waitFor();
        assert.equal(await button(admin, "Tạo bản đính chính").count(), 0);
      },
    );
    await check(
      "Manager cooperative update verifies email then SMS before applying fields",
      async () => {
        const manager = await http(
          "auth/login",
          "POST",
          { phone_number: "0900000011", password: managerPassword },
          undefined,
          200,
        );
        managerPage = await session(manager.access_token);
        const coops = await http(
          "cooperatives",
          "GET",
          undefined,
          manager.access_token,
        );
        const coop = coops.items[0];
        await visit(managerPage, `/cooperatives/${coop.id}`);
        await button(managerPage, "Yêu cầu cập nhật HTX").click();
        const dialog = managerPage.getByRole("dialog");
        assert.equal(
          await dialog.getByLabel("Số chứng nhận", { exact: true }).count(),
          0,
        );
        await dialog
          .getByLabel("Tên hợp tác xã", { exact: true })
          .fill("HTX đã xác minh workflow");
        const request = await save(
          managerPage,
          `cooperatives/${coop.id}/update-requests`,
        );
        assert.equal(
          (
            await http(
              `cooperatives/${coop.id}`,
              "GET",
              undefined,
              manager.access_token,
            )
          ).cooperative_name,
          coop.cooperative_name,
        );
        await visit(managerPage, `/cooperative-updates?id=${request.id}`);
        await managerPage
          .getByLabel("Mã xác minh email")
          .fill(codes.get(manager.user.gmail));
        await button(managerPage, "Xác minh mã").click();
        await button(managerPage, "Gửi mã xác minh điện thoại").click();
        await managerPage.getByLabel("Mã xác minh điện thoại").waitFor();
        const sms = await http(
          `cooperative-update-requests/${request.id}/test-sms`,
          "GET",
          undefined,
          manager.access_token,
        );
        await managerPage
          .getByLabel("Mã xác minh điện thoại")
          .fill(sms.messages.at(-1).otp);
        await button(managerPage, "Xác minh mã").click();
        await managerPage
          .getByRole("link", {
            name: "Xem thông tin HTX đã cập nhật",
            exact: true,
          })
          .waitFor();
        assert.equal(
          (
            await http(
              `cooperatives/${coop.id}`,
              "GET",
              undefined,
              manager.access_token,
            )
          ).cooperative_name,
          "HTX đã xác minh workflow",
        );
      },
    );
    await check(
      "new modules remain balanced on desktop, low viewport and mobile with working dialogs",
      async () => {
        for (const viewport of [
          { width: 1440, height: 1000 },
          { width: 1366, height: 640 },
          { width: 390, height: 844 },
        ]) {
          await owner.setViewportSize(viewport);
          for (const path of [
            "/farms",
            "/zones",
            "/trees",
            "/tree-harvests",
            "/cultivation-events",
            "/devices",
            `/devices/${device.id}`,
            "/requests?kind=farm",
            "/assignments",
            "/cooperatives",
          ]) {
            await visit(owner, path);
            await owner.locator("h1").waitFor();
            await owner.waitForFunction(
              () =>
                !document.querySelector(
                  '.page-content .data-state[role="status"]',
                ),
            );
            assert(
              await owner.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
              `${path} overflows ${viewport.width}`,
            );
          }
          await visit(owner, "/cultivation-events");
          await button(owner, "Thêm nhật ký").click();
          await owner
            .getByRole("dialog")
            .getByLabel("Khu vực", { exact: true })
            .selectOption(zone.id);
          await owner
            .getByRole("dialog")
            .getByLabel("Hoạt động", { exact: true })
            .selectOption("Fertilizing");
          await owner
            .getByRole("dialog")
            .getByLabel("Vật tư 1", { exact: true })
            .selectOption({ label: "Vật tư kiểm thử 01 (g)" });
          await owner
            .getByRole("dialog")
            .getByLabel("Lượng vật tư 1", { exact: true })
            .fill("5");
          await owner.screenshot({
            path: `${screenshots}/workflow-dialog-${viewport.width}.png`,
          });
          await button(owner.getByRole("dialog"), "Đóng").click();
          await visit(owner, "/devices");
          await owner.locator("tbody tr").first().waitFor();
          const firstCell = await owner
            .locator("tbody td")
            .first()
            .boundingBox();
          assert(
            firstCell.width >= 180,
            "Device identifier column remains readable",
          );
          await owner.screenshot({
            path: `${screenshots}/workflow-iot-${viewport.width}.png`,
            fullPage: true,
          });
        }
      },
    );
  } catch (error) {
    for (const context of contexts)
      for (const page of context.pages()) {
        await page.screenshot({
          path: `${screenshots}/workflow-failure-${contexts.indexOf(context)}.png`,
        });
        console.log(
          `Workflow failure at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 1400)}`,
        );
      }
    throw error;
  } finally {
    for (const context of contexts) await context.close();
  }
}
