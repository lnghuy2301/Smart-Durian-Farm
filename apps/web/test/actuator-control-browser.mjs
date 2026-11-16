import assert from "node:assert/strict";

// Real Nest + MQTT.js over loopback, simulated ACK only. No live farm/hardware.
export async function checkActuatorControl({
  browser,
  origin,
  http,
  check,
  broker,
  app,
  apiModule,
  ownerToken,
  adminToken,
  standard,
  screenshots,
  errors,
}) {
  const contexts = [];
  const timers = new Set();
  const actions = (page) =>
    page.getByRole("region", { name: "Thao tác điều khiển", exact: true });
  const command = (page, name) =>
    actions(page).getByRole("button", { name: new RegExp(`^${name}`) });
  const stateText = (page, text) =>
    page.locator(".control-state-grid").getByText(text, { exact: true });
  async function until(predicate, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.fail("Control fixture timed out");
  }
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
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  const { AuthService } = apiModule("auth/auth.service");
  const bucket = app.get(AuthService).rateLimits.buckets.get("login");
  if (bucket) bucket.startedAt = Date.now() - 60001;
  const managerToken = (
    await http(
      "auth/login",
      "POST",
      { phone_number: "0900000011", password: "BrowserOnly123!" },
      undefined,
      200,
    )
  ).access_token;
  const workerToken = (
    await http(
      "auth/login",
      "POST",
      { phone_number: "0900000010", password: "ResetBrowserOnly123!" },
      undefined,
      200,
    )
  ).access_token;
  const manager = await http("auth/me", "GET", undefined, managerToken);
  const worker = await http("auth/me", "GET", undefined, workerToken);
  const cooperative = (
    await http("cooperatives?limit=100&offset=0", "GET", undefined, adminToken)
  ).items.find((item) => item.manager_id === manager.id);
  assert(cooperative);
  const proposal = await http(
    "farms/requests",
    "POST",
    {
      area_size: 2,
      address: "Vườn điều khiển kiểm thử cô lập",
      certificate_number: "CONTROL-WEB",
      longitude: 106,
      latitude: 10,
    },
    ownerToken,
  );
  const accepted = await http(
    `farm-requests/${proposal.id}/approve`,
    "PATCH",
    {},
    adminToken,
  );
  const farmId = accepted.farm_id;
  let join = await http(
    `farms/${farmId}/join-requests`,
    "POST",
    { cooperative_id: cooperative.id },
    ownerToken,
  );
  for (const signer of join.required_approvals.filter(
    (item) => !item.approved_at,
  )) {
    join = await http(
      `farm-requests/${join.id}/approve`,
      "PATCH",
      {},
      signer.role === "Admin" ? adminToken : managerToken,
    );
  }
  assert.equal(join.status, "Accepted");
  const zone = await http(
    "zones",
    "POST",
    {
      farm_id: farmId,
      standard_id: standard.id,
      zone_name: "Khu tưới kiểm thử",
      area_size: 1,
      longitude: 106,
      latitude: 10,
    },
    ownerToken,
  );
  async function install(station_id) {
    const device = await http(
      "devices",
      "POST",
      {
        zone_id: zone.id,
        station_id,
        installed_at: "2026-10-19T08:00:00+07:00",
        cost: 2600000,
      },
      ownerToken,
    );
    const actuators = [];
    for (const [capability_id, purpose] of [
      [2, "shared"],
      [4, "watering"],
      [3, "spraying"],
    ])
      actuators.push(
        await http(
          "actuators",
          "POST",
          {
            device_id: device.id,
            name: `Bơm/van ${capability_id}`,
            capability_id,
            purpose,
          },
          ownerToken,
        ),
      );
    return { device, actuators };
  }
  const { device, actuators } = await install("CONTROL_UI_STATION");
  for (const [stream, type, name, unit] of [
    ["301", "air_temperature", "Nhiệt độ không khí", "C"],
    ["302", "air_humidity", "Độ ẩm không khí", "%"],
    ["303", "soil_moisture", "Độ ẩm đất", "%rH"],
  ]) {
    await http(
      "sensors",
      "POST",
      {
        device_id: device.id,
        name,
        sensor_type: type,
        data_stream_id: stream,
        unit,
      },
      ownerToken,
    );
  }
  broker.publish(device.station_id, [
    { dataStreamId: 301, result: "28.5 C" },
    { dataStreamId: 302, result: "78 %" },
    { dataStreamId: 303, result: "65 %rH" },
  ]);
  const second = (await install("CONTROL_UI_OTHER")).device;
  const base = `actuator-tasks/devices/${device.id}`;
  const deviceState = () => http(`${base}/state`, "GET", undefined, ownerToken);
  const task = (id) =>
    http(`actuator-tasks/${id}`, "GET", undefined, ownerToken);
  let policy = "auto",
    held = [];
  broker.onControl((packet) => {
    if (!packet.station.startsWith("CONTROL_UI_")) return;
    const action = packet.wire.taskingParameters.action;
    const capability = packet.wire.targets[0].taskingCapabilityId;
    if (
      (policy === "holdOn" && action === 1) ||
      (policy === "failPump" && capability === 2)
    ) {
      held.push(packet);
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      broker.ack(packet);
    }, 120);
    timers.add(timer);
  });
  const owner = await session(ownerToken);
  const posted = [];
  owner.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/commands"))
      posted.push(request.postDataJSON());
  });
  const visit = (page) =>
    page.goto(`${origin}/actuator-control?device_id=${device.id}`);
  async function start(operation, double = false) {
    await command(
      owner,
      operation === "Watering" ? "Tưới nước" : "Phun thuốc",
    ).click();
    const dialog = owner.getByRole("dialog");
    await dialog.getByText(device.station_id, { exact: true }).waitFor();
    const response = owner.waitForResponse(
      (r) =>
        r.url().endsWith(`${base}/commands`) && r.request().method() === "POST",
    );
    const button = dialog.getByRole("button", {
      name: operation === "Watering" ? "Gửi lệnh tưới" : "Gửi lệnh phun",
      exact: true,
    });
    if (double)
      await button.evaluate((node) => {
        node.click();
        node.click();
      });
    else await button.click();
    return response;
  }
  async function stop() {
    await until(async () => await command(owner, "Dừng").isEnabled());
    const response = owner.waitForResponse(
      (r) =>
        r.url().endsWith(`${base}/commands`) && r.request().method() === "POST",
    );
    await command(owner, "Dừng").click();
    assert.equal((await response).status(), 202);
    await until(async () => (await deviceState()).acknowledged_mode === "Off");
    await stateText(owner, "Đã nhận đủ lệnh dừng").waitFor();
  }
  try {
    await check(
      "control selection sends nothing until confirmed, real Reset then Watering ACK and physical Unknown",
      async () => {
        await owner.goto(`${origin}/actuator-control`);
        await owner
          .getByLabel("Vườn trồng", { exact: true })
          .selectOption(farmId);
        await owner
          .getByLabel("Khu vực", { exact: true })
          .selectOption(zone.id);
        await owner
          .getByLabel("Trạm điều khiển", { exact: true })
          .selectOption(device.id);
        await stateText(owner, "Chưa xác định").first().waitFor();
        await owner
          .getByRole("heading", {
            name: "Điều khiển tưới/phun thuốc",
            exact: true,
          })
          .waitFor();
        assert.equal(await owner.locator(".control-readings").count(), 0);
        const farmLabel = await owner
          .getByLabel("Vườn trồng", { exact: true })
          .locator(`option[value="${farmId}"]`)
          .innerText();
        assert.ok(!farmLabel.includes("CONTROL-WEB"));
        assert.equal(posted.length, 0);
        await command(owner, "Tưới nước").click();
        await owner
          .getByRole("dialog")
          .getByRole("button", { name: "Quay lại", exact: true })
          .click();
        assert.equal(posted.length, 0);
        const begin = broker.commands.length;
        const response = await start("Watering", true);
        assert.equal(response.status(), 202);
        const accepted = await response.json();
        assert(accepted.task.response_payload.reset_task_id);
        await until(
          async () => (await deviceState()).acknowledged_mode === "Watering",
        );
        await stateText(owner, "Đã nhận đủ lệnh tưới").waitFor();
        assert.equal(posted.length, 1, "Double tap must not submit twice");
        assert.deepEqual(posted[0], { operation: "Watering" });
        assert.deepEqual(
          broker.commands
            .slice(begin)
            .map((entry) => [
              entry.wire.targets[0].taskingCapabilityId,
              entry.wire.taskingParameters.action,
            ]),
          [
            [2, 0],
            [4, 0],
            [3, 0],
            [4, 1],
            [2, 1],
          ],
        );
        assert.equal((await deviceState()).physical_state, "Unknown");
        await owner
          .getByRole("article", {
            name: "Tiến trình Chuẩn bị trước khi bật",
            exact: true,
          })
          .waitFor();
        assert.equal(await command(owner, "Phun thuốc").isDisabled(), true);
        await stop();
      },
    );
    await check(
      "control Stop preempts pending Start, duplicate Stop disabled and late ACK cannot restore mode",
      async () => {
        policy = "holdOn";
        held = [];
        const response = await start("Spraying");
        const pending = (await response.json()).task;
        await until(() => held.length === 1);
        assert.equal((await task(pending._id)).status, "Pending");
        await stop();
        assert.equal(
          (await task(pending._id)).error_message,
          "CANCELLED_BY_STOP",
        );
        broker.ack(held[0]);
        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal((await deviceState()).acknowledged_mode, "Off");
        policy = "auto";
      },
    );
    await check(
      "control failed Start retains error and tracks RecoveryStop without false physical Off",
      async () => {
        policy = "failPump";
        held = [];
        const response = await start("Watering");
        const submitted = (await response.json()).task;
        await until(
          async () =>
            !!(await task(submitted._id)).response_payload.recovery_task_id,
          18000,
        );
        const failed = await task(submitted._id);
        assert.equal(failed.status, "Failed");
        assert.equal(failed.error_message, "ACK_TIMEOUT");
        const recoveryId = failed.response_payload.recovery_task_id;
        assert.equal((await task(recoveryId)).status, "Pending");
        await owner
          .getByRole("article", {
            name: "Tiến trình Dừng phục hồi",
            exact: true,
          })
          .waitFor();
        await until(async () => await command(owner, "Dừng").isDisabled());
        await stateText(owner, "Chưa xác định").first().waitFor();
        await owner.screenshot({
          path: `${screenshots}/control-recovery-desktop.png`,
          fullPage: true,
        });
        policy = "auto";
        for (const packet of held.filter(
          (entry) => entry.wire.taskingParameters.action === 0,
        ))
          broker.ack(packet);
        await until(
          async () => (await deviceState()).acknowledged_mode === "Off",
        );
        assert.equal((await task(submitted._id)).status, "Failed");
        assert.equal((await task(recoveryId)).status, "Confirmed");
        await stateText(owner, "Đã nhận đủ lệnh dừng").waitFor();
      },
    );
    await check(
      "control ambiguous POST does not retry, explicit recheck reconciles accepted real command",
      async () => {
        const route = `**/api/${base}/commands`;
        await owner.route(
          route,
          async (request) => {
            await request.fetch();
            await request.abort("failed");
          },
          { times: 1 },
        );
        const count = posted.length;
        await command(owner, "Tưới nước").click();
        await owner
          .getByRole("dialog")
          .getByRole("button", { name: "Gửi lệnh tưới", exact: true })
          .click();
        await actions(owner)
          .getByText(/Chưa rõ kết quả gửi lệnh/)
          .waitFor();
        await until(
          async () => (await deviceState()).acknowledged_mode === "Watering",
        );
        assert.equal(posted.length, count + 1);
        assert.equal(await command(owner, "Tưới nước").isDisabled(), true);
        await actions(owner)
          .getByRole("button", { name: "Kiểm tra lại trạng thái", exact: true })
          .click();
        await stop();
      },
    );
    await check(
      "control Admin and Manager view scoped tasks without command controls",
      async () => {
        for (const token of [adminToken, managerToken]) {
          const reader = await session(token);
          let posts = 0;
          reader.on("request", (request) => {
            if (
              request.method() === "POST" &&
              request.url().endsWith("/commands")
            )
              posts++;
          });
          await visit(reader);
          await stateText(reader, "Đã nhận đủ lệnh dừng").waitFor();
          await actions(reader)
            .getByText(/Bạn có quyền xem/)
            .waitFor();
          assert.equal(await command(reader, "Tưới nước").count(), 0);
          assert.equal(await command(reader, "Dừng").count(), 0);
          assert.equal(posts, 0);
        }
      },
    );
    await check(
      "control Inactive metadata blocks ON and OFF; history errors alone do not disable valid Stop",
      async () => {
        await http(
          `actuators/${actuators[0].id}`,
          "PATCH",
          { status: "Inactive" },
          ownerToken,
        );
        await actions(owner)
          .getByRole("button", {
            name: "Kiểm tra lại trạng thái điều khiển",
            exact: true,
          })
          .click();
        await until(
          async () =>
            !owner.isClosed() && (await command(owner, "Dừng").isDisabled()),
        );
        assert.equal(await command(owner, "Tưới nước").isDisabled(), true);
        assert.equal(await command(owner, "Dừng").isDisabled(), true);
        await http(
          `actuators/${actuators[0].id}`,
          "PATCH",
          { status: "Active" },
          ownerToken,
        );
        await owner.route(`**/api/${base}?*`, (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "Fixture history unavailable" }),
          }),
        );
        await actions(owner)
          .getByRole("button", {
            name: "Kiểm tra lại trạng thái điều khiển",
            exact: true,
          })
          .click();
        await owner
          .getByRole("region", { name: "Lịch sử lệnh", exact: true })
          .getByRole("alert")
          .waitFor();
        await until(async () => await command(owner, "Dừng").isEnabled());
        await owner.unroute(`**/api/${base}?*`);
        await actions(owner)
          .getByRole("button", {
            name: "Kiểm tra lại trạng thái điều khiển",
            exact: true,
          })
          .click();
      },
    );
    await check(
      "control broker unavailable and failed state reads disable commands without replay",
      async () => {
        const stateRoute = `**/api/${base}/state`;
        const count = posted.length;
        await owner.route(stateRoute, async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            json: { ...(await response.json()), broker_ready: false },
          });
        });
        await actions(owner)
          .getByRole("button", {
            name: "Kiểm tra lại trạng thái điều khiển",
            exact: true,
          })
          .click();
        await owner
          .getByText("Kênh gửi lệnh chưa sẵn sàng", { exact: true })
          .waitFor();
        assert.equal(await command(owner, "Tưới nước").isDisabled(), true);
        assert.equal(await command(owner, "Dừng").isDisabled(), true);
        await owner.unroute(stateRoute);
        await owner.route(stateRoute, (route) => route.abort("failed"));
        await actions(owner)
          .getByRole("button", {
            name: "Kiểm tra lại trạng thái điều khiển",
            exact: true,
          })
          .click();
        await owner.locator(".control-station").getByRole("alert").waitFor();
        assert.equal(await owner.locator(".control-state-grid").count(), 0);
        assert.equal(await command(owner, "Dừng").isDisabled(), true);
        await owner.unroute(stateRoute);
        await actions(owner)
          .getByRole("button", { name: "Kiểm tra lại trạng thái", exact: true })
          .click();
        await until(async () => await command(owner, "Dừng").isEnabled());
        assert.equal(posted.length, count);
      },
    );
    await check(
      "control assignee can Stop older hidden work, command and loses cached task data at assignment end",
      async () => {
        policy = "holdOn";
        held = [];
        const oldResponse = await start("Watering");
        const olderTask = (await oldResponse.json()).task;
        await until(() => held.length === 1);
        const invitation = await http(
          `zones/${zone.id}/assignment-requests`,
          "POST",
          {
            user_id: worker.id,
            end_date: null,
          },
          ownerToken,
        );
        const assigned = await http(
          `assignment-requests/${invitation.id}/approve`,
          "PATCH",
          {},
          workerToken,
        );
        const workerPage = await session(workerToken);
        await visit(workerPage);
        const workerState = await http(
          `${base}/state`,
          "GET",
          undefined,
          workerToken,
        );
        assert.equal(workerState.busy, true);
        assert.equal(
          workerState.active_task_id,
          null,
          "Older task stays outside the new assignment's history",
        );
        await until(async () => await command(workerPage, "Dừng").isEnabled());
        assert.equal(
          await workerPage
            .getByText("Vườn điều khiển kiểm thử cô lập", { exact: false })
            .count(),
          0,
          "Assignee must not read the owner's Farm profile",
        );
        await command(workerPage, "Dừng").click();
        await stateText(workerPage, "Đã nhận đủ lệnh dừng").waitFor();
        assert.equal(
          (await task(olderTask._id)).error_message,
          "CANCELLED_BY_STOP",
        );
        policy = "auto";
        await until(
          async () => await command(workerPage, "Tưới nước").isEnabled(),
        );
        await command(workerPage, "Tưới nước").click();
        await workerPage
          .getByRole("dialog")
          .getByRole("button", { name: "Gửi lệnh tưới", exact: true })
          .click();
        await stateText(workerPage, "Đã nhận đủ lệnh tưới").waitFor();
        await command(workerPage, "Dừng").click();
        await stateText(workerPage, "Đã nhận đủ lệnh dừng").waitFor();
        await http(
          `zone-assignments/${assigned.assignment_id}/end`,
          "PATCH",
          {},
          ownerToken,
        );
        await workerPage
          .getByText(/Không còn truy cập được trạm hoặc lệnh/)
          .waitFor();
        assert.equal(
          await workerPage
            .locator(
              ".control-state-grid, .control-task, .control-history-list",
            )
            .count(),
          0,
        );
        assert.equal(
          await workerPage
            .getByText(device.station_id, { exact: true })
            .count(),
          0,
        );
      },
    );
    await check(
      "control responsive layouts and switching stations discard old state without sending commands",
      async () => {
        const before = posted.length;
        for (const viewport of [
          { width: 1440, height: 1000 },
          { width: 1366, height: 640 },
          { width: 390, height: 844 },
          { width: 320, height: 720 },
        ]) {
          await owner.setViewportSize(viewport);
          await visit(owner);
          await stateText(owner, "Đã nhận đủ lệnh dừng").waitFor();
          assert(
            await owner.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            `Control body overflow ${viewport.width}`,
          );
          await owner.screenshot({
            path: `${screenshots}/control-${viewport.width}.png`,
            fullPage: true,
          });
          await command(owner, "Phun thuốc").click();
          await owner
            .getByRole("dialog")
            .getByRole("button", { name: "Gửi lệnh phun", exact: true })
            .waitFor();
          assert(
            await owner
              .getByRole("dialog")
              .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          );
          await owner
            .getByRole("dialog")
            .getByRole("button", { name: "Quay lại", exact: true })
            .click();
        }
        await owner
          .getByLabel("Trạm điều khiển", { exact: true })
          .selectOption(second.id);
        await stateText(owner, "Chưa xác định").first().waitFor();
        assert.equal(await owner.locator(".control-task").count(), 0);
        assert.equal(posted.length, before);
      },
    );
  } catch (error) {
    await owner.screenshot({
      path: `${screenshots}/control-failure.png`,
      fullPage: true,
    });
    console.log((await owner.locator("body").innerText()).slice(-5000));
    throw error;
  } finally {
    broker.onControl(undefined);
    for (const timer of timers) clearTimeout(timer);
    for (const context of contexts) await context.close();
  }
}
