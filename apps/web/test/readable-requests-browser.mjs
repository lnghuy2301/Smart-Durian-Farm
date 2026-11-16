/* global document, window, getComputedStyle */
import assert from "node:assert/strict";

export async function assertReadableRequest(page, names, hiddenIds = []) {
  await page.waitForFunction((expected) => {
    const text = [...document.querySelectorAll(".request-summary")]
      .map((node) => node.textContent)
      .join(" ");
    return expected.every((name) => text.includes(name));
  }, names);
  const list = await page.locator(".request-list tbody").innerText();
  assert.ok(
    !/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(list),
    "List summaries do not expose raw references",
  );
  const detail = page.locator(".workflow-summary");
  for (const id of hiddenIds)
    assert.ok(!(await detail.innerText()).includes(id));
  const labels = await detail.locator("tbody th").allTextContents();
  if (labels.includes("Vĩ độ")) {
    assert.equal(labels.indexOf("Kinh độ"), labels.indexOf("Vĩ độ") + 1);
    assert.ok(labels.indexOf("Diện tích (ha)") > labels.indexOf("Kinh độ"));
  }
}

export async function checkGardenTransition({
  page,
  origin,
  http,
  workerToken,
  adminToken,
  standardId,
  firstFarm,
  firstZone,
  screenshots,
}) {
  const proposal = await http(
    "farms/requests",
    "POST",
    {
      area_size: 2,
      address: "Vườn thứ hai kiểm tra chuyển cảnh",
      certificate_number: "TRANSITION-B",
      longitude: 106.12,
      latitude: 10.25,
    },
    workerToken,
  );
  const accepted = await http(
    `farm-requests/${proposal.id}/approve`,
    "PATCH",
    {},
    adminToken,
  );
  const secondZone = await http(
    "zones",
    "POST",
    {
      farm_id: accepted.farm_id,
      standard_id: standardId,
      zone_name: "Khu vực chuyển cảnh B",
      area_size: 1,
      longitude: 106.12,
      latitude: 10.25,
    },
    workerToken,
  );
  const devices = [];
  for (const [zone, station] of [
    [firstZone, "TRANSITION_STATION_A"],
    [secondZone.id, "TRANSITION_STATION_B"],
  ])
    devices.push(
      await http(
        "devices",
        "POST",
        {
          zone_id: zone,
          station_id: station,
          installed_at: "2026-10-01T00:00:00+07:00",
          cost: 1000,
          status: "Active",
        },
        workerToken,
      ),
    );
  await page.goto(`${origin}/farms?view=devices&farm_id=${firstFarm}`);
  await page
    .getByRole("link", { name: devices[0].station_id, exact: true })
    .waitFor();
  await page.locator('.stable-content-frame[aria-busy="false"]').waitFor();
  const frame = page.locator(".stable-content-frame");
  await page.getByText("Chưa có số đo", { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".stable-content-frame")
      .getAnimations()
      .every((animation) => animation.playState === "finished"),
  );
  const before = await frame.boundingBox();
  const beforeGeometry = await frame.evaluate((element) => ({
    style: element.style.blockSize,
    content: element.firstElementChild.getBoundingClientRect().height,
  }));
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const route = `**/api/zones?farm_id=${accepted.farm_id}*`;
  await page.route(route, async (request) => {
    await blocked;
    await request.continue().catch(() => {});
  });
  try {
    await page
      .getByLabel("Vườn trồng", { exact: true })
      .selectOption(accepted.farm_id);
    await page.locator('.stable-content-frame[aria-busy="true"]').waitFor();
    const pendingHeight = (await frame.boundingBox()).height;
    const pendingGeometry = await frame.evaluate((element) => ({
      style: element.style.blockSize,
      content: element.firstElementChild.getBoundingClientRect().height,
    }));
    assert.ok(
      Math.abs(pendingHeight - before.height) <= 1,
      `Pending frame height ${pendingHeight} differs from ${before.height}; ${JSON.stringify({ beforeGeometry, pendingGeometry })}`,
    );
    assert.equal(
      await page
        .getByRole("link", { name: devices[0].station_id, exact: true })
        .count(),
      0,
    );
    release();
    await page
      .getByRole("link", { name: devices[1].station_id, exact: true })
      .waitFor();
    await page.locator('.stable-content-frame[aria-busy="false"]').waitFor();
    assert.equal(
      await page.getByLabel("Khu vực", { exact: true }).inputValue(),
      secondZone.id,
    );
    await page.screenshot({
      path: `${screenshots}/garden-transition-devices.png`,
      fullPage: true,
    });
  } finally {
    release();
    await page.unroute(route);
  }
  return devices[1];
}

export async function checkDashboardLinks(page, origin) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/`);
  const overview = page.locator(".sidebar nav > a").first();
  const group = page.locator(".role-nav-toggle").first();
  await page.mouse.move(0, 0);
  for (const item of [overview, group]) {
    assert.equal(
      await item.evaluate((element) => getComputedStyle(element).fontWeight),
      "400",
    );
    await item.hover();
    assert.equal(
      await item.evaluate((element) => getComputedStyle(element).fontWeight),
      "600",
    );
    await page.mouse.move(0, 0);
    assert.equal(
      await item.evaluate((element) => getComputedStyle(element).fontWeight),
      "400",
    );
  }
  const card = page.locator(".stat-card:not(.accent)").first();
  await card.waitFor();
  await page.mouse.move(0, 0);
  const initial = await card.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await card.hover();
  const hovered = await card.evaluate(
    (element) => getComputedStyle(element).color,
  );
  assert.notEqual(initial, hovered);
  await card.click();
  await page.goBack();
  await card.waitFor();
  await page.mouse.move(0, 0);
  assert.equal(
    await card.evaluate((element) => getComputedStyle(element).color),
    initial,
  );
  return page
    .locator("h1")
    .first()
    .evaluate((element) => ({
      font: getComputedStyle(element).fontFamily,
      size: getComputedStyle(element).fontSize,
    }));
}

export async function checkJournalRows({
  page,
  origin,
  http,
  token,
  zoneId,
  screenshots,
}) {
  for (let index = 1; index <= 23; index++)
    await http(
      "cultivation-events",
      "POST",
      {
        target_type: "Zone",
        target_id: zoneId,
        action_type: "Other",
        details: {
          activity_name: `Công việc dòng ${index}`,
          note: `Ghi chú đầy đủ dòng ${index}`,
        },
      },
      token,
    );
  await page.goto(`${origin}/cultivation-events?zone_id=${zoneId}`);
  const rows = page.locator(".journal-list tbody tr");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 10);
  assert.ok((await rows.first().innerText()).includes("Công việc dòng 23"));
  assert.ok(
    (await rows.first().innerText()).includes("Ghi chú đầy đủ dòng 23"),
  );
  await page.screenshot({
    path: `${screenshots}/journal-rows-desktop.png`,
    fullPage: true,
  });
  for (const expected of [10, 3]) {
    const response = page.waitForResponse(
      (response) =>
        response.url().includes("cultivation-events?") && response.ok(),
    );
    await page.getByRole("button", { name: "Sau", exact: true }).click();
    await response;
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".journal-list tbody tr").length === count,
      expected,
    );
    await rows.first().waitFor();
    assert.equal(await rows.count(), expected);
  }
}

export async function checkTelemetryPages({
  page,
  origin,
  http,
  token,
  device,
  broker,
}) {
  // The receiver requires active sensor metadata for every incoming stream.
  for (let index = 0; index < 23; index++) {
    await http(
      "sensors",
      "POST",
      {
        device_id: device.id,
        name: `Cảm biến kiểm thử ${index + 1}`,
        sensor_type: "air_temperature",
        data_stream_id: String(400 + index),
        unit: "C",
      },
      token,
    );
  }
  broker.publish(
    device.station_id,
    Array.from({ length: 23 }, (_, index) => ({
      dataStreamId: 400 + index,
      result: `${index} C`,
    })),
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      (
        await http(
          `telemetry/devices/${device.id}/latest?limit=1&offset=0`,
          "GET",
          undefined,
          token,
        )
      ).total === 23
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const preview = await http(
    `telemetry/devices/${device.id}/latest?limit=1&offset=0`,
    "GET",
    undefined,
    token,
  );
  assert.equal(preview.total, 23, "Fixture readings arrived through MQTT");
  await page.goto(`${origin}/devices/${device.id}`);
  await page
    .locator(".device-reading-preview strong")
    .getByText(`${preview.items[0].value} C`, { exact: true })
    .waitFor();
  await page.goto(`${origin}/iot`);
  await page
    .getByLabel("Thiết bị / mã trạm", { exact: true })
    .selectOption(device.id);
  await page.waitForFunction(
    () => document.querySelectorAll(".sensor-card").length === 10,
  );
  const latest = page.locator(".device-monitor > .pagination");
  await latest.getByRole("button", { name: "Sau", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".device-monitor > .pagination")
      ?.textContent.includes("11–20"),
  );
  assert.equal(await page.locator(".sensor-card").count(), 10);
  await latest.getByRole("button", { name: "Sau", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".sensor-card").length === 3,
  );
  assert.ok(
    (await page.locator(".sensor-card strong").allTextContents()).some((text) =>
      /^0\s*C$/.test(text),
    ),
  );
  const history = page.locator(".monitor-section").filter({
    has: page.getByRole("heading", { name: "Lịch sử số đo", exact: true }),
  });
  await history.locator("tbody tr").first().waitFor();
  assert.equal(await history.locator("tbody tr").count(), 12);
  await history.getByRole("button", { name: "Sau", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".monitor-section:last-of-type tbody tr")
        .length === 11,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
}
