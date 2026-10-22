import assert from "node:assert/strict";

// All records belong to the existing isolated Nest test application. No .env,
// production database, hardware or real email/SMS is used here.
export async function checkRoleNavigation({
  browser,
  origin,
  http,
  check,
  app,
  apiModule,
  ownerToken,
  adminToken,
  standard,
  codes,
  screenshots,
  errors,
}) {
  const contexts = [];
  const { AuthService } = apiModule("auth/auth.service");
  const bucket = app.get(AuthService).rateLimits.buckets.get("login");
  if (bucket) bucket.startedAt = Date.now() - 60001;
  const password = "RoleFixtureOnly123!";
  const worker = (
    await http("auth/register", "POST", {
      user_name: "Farmer nhận việc sidebar",
      phone_number: "0900000086",
      password,
      role: "Farmer",
    })
  ).user;
  const workerToken = (
    await http(
      "auth/login",
      "POST",
      { phone_number: worker.phone_number, password },
      undefined,
      200,
    )
  ).access_token;
  const email = "role-navigation@example.com",
    managerPhone = "0900000087";
  const issued = await http(
    "auth/registration/email/request",
    "POST",
    { phone_number: managerPhone, gmail: email },
    undefined,
    202,
  );
  const verified = await http(
    "auth/registration/email/verify",
    "POST",
    {
      phone_number: managerPhone,
      gmail: email,
      verification_id: issued.verification_id,
      otp: codes.get(email),
    },
    undefined,
    200,
  );
  const pendingManager = (
    await http("auth/register", "POST", {
      user_name: "Manager sidebar",
      phone_number: managerPhone,
      gmail: email,
      password,
      role: "Manager",
      email_verification_token: verified.email_verification_token,
    })
  ).user;
  const ownProposal = await http(
    "farms/requests",
    "POST",
    {
      area_size: 2,
      address: "Vườn riêng của Farmer nhận việc",
      certificate_number: "NAV-OWN-FARM",
      longitude: 106,
      latitude: 10,
    },
    workerToken,
  );
  const outerProposal = await http(
    "farms/requests",
    "POST",
    {
      area_size: 2,
      address: "Vườn giao việc cho Farmer",
      certificate_number: "NAV-OTHER-FARM",
      longitude: 106,
      latitude: 10,
    },
    ownerToken,
  );
  const outer = await http(
    `farm-requests/${outerProposal.id}/approve`,
    "PATCH",
    {},
    adminToken,
  );
  const workZone = await http(
    "zones",
    "POST",
    {
      farm_id: outer.farm_id,
      standard_id: standard.id,
      zone_name: "Khu vực nhận việc sidebar",
      area_size: 1,
      longitude: 106,
      latitude: 10,
    },
    ownerToken,
  );
  const invitation = await http(
    `zones/${workZone.id}/assignment-requests`,
    "POST",
    { user_id: worker.id },
    ownerToken,
  );
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
  const admin = await session(adminToken),
    farmer = await session(workerToken);
  const visit = (page, path) => page.goto(`${origin}${path}`);
  const heading = (page, name) =>
    page.getByRole("heading", { name, exact: true }).waitFor();
  const group = (page, name) =>
    page.locator(".sidebar nav").getByRole("button", { name, exact: true });
  const noSystemMenu = async (page) => {
    assert.equal(
      await page.locator('.sidebar a[href="/pending-managers"]').count(),
      0,
    );
    assert.equal(
      await page.locator('.sidebar a[href="/cooperatives/new"]').count(),
      0,
    );
    assert.equal(await page.locator('.sidebar a[href*="ai"]').count(), 0);
  };
  let manager;
  try {
    await check(
      "role navigation Admin prioritizes real pending work and keeps secondary groups collapsed",
      async () => {
        await visit(admin, "/");
        await heading(admin, "Tổng quan hệ thống");
        await admin.locator(".stat-card").first().waitFor();
        assert(
          (await admin.locator(".stat-card").first().innerText()).includes(
            "Manager chờ duyệt",
          ),
        );
        await admin.locator('.role-inbox-item[href*="kind=farm"]').waitFor();
        assert.equal(await admin.locator(".role-nav-toggle").count(), 4);
        assert.equal(
          await admin.locator('.role-nav-toggle[aria-expanded="true"]').count(),
          0,
        );
        await group(admin, "Yêu cầu cần xử lý").click();
        await admin
          .locator('.sidebar a[href="/harvest-backdates"]')
          .waitFor({ state: "visible" });
        await group(admin, "Danh mục canh tác").click();
        assert.equal(
          await group(admin, "Yêu cầu cần xử lý").getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(
          await admin.locator('.role-nav-toggle[aria-expanded="true"]').count(),
          1,
        );
        await visit(admin, "/standards");
        assert.equal(
          await group(admin, "Danh mục canh tác").getAttribute("aria-expanded"),
          "true",
        );
        assert.equal(
          await admin
            .locator('.sidebar a[href="/standards"]')
            .getAttribute("aria-current"),
          "page",
        );
        await admin.screenshot({
          path: `${screenshots}/role-admin-navigation.png`,
          fullPage: true,
        });
      },
    );
    await check(
      "role navigation Farmer without Farm or assignment sees onboarding, real invitation and direct URL guards",
      async () => {
        await visit(farmer, "/");
        await farmer
          .getByRole("region", { name: "Vườn của tôi", exact: true })
          .getByText(/Bạn chưa có vườn được duyệt/)
          .waitFor();
        await farmer
          .getByRole("region", { name: "Công việc được giao", exact: true })
          .getByText(/Bạn chưa có khu vực đang phụ trách/)
          .waitFor();
        await farmer
          .getByRole("link", { name: "Gửi yêu cầu tạo vườn", exact: true })
          .waitFor();
        await farmer
          .locator('.role-inbox-item[href*="kind=assignment"]')
          .waitFor();
        await noSystemMenu(farmer);
        for (const path of [
          "/pending-managers",
          "/cooperatives/new",
          "/farm-notifications",
          "/cooperative-updates",
        ]) {
          await visit(farmer, path);
          await heading(farmer, "Không có quyền truy cập");
        }
        await visit(farmer, "/account");
        assert.equal(
          await farmer
            .locator(".role-account-link")
            .getAttribute("aria-current"),
          "page",
        );
      },
    );
    await check(
      "role navigation assigned-only Farmer accepts invitation and enters current Zone without owner actions",
      async () => {
        await visit(farmer, "/assigned-work");
        await heading(farmer, "Công việc được giao");
        await farmer
          .locator('.role-inbox-item[href*="kind=assignment"]')
          .waitFor();
        await visit(farmer, `/requests?kind=assignment&id=${invitation.id}`);
        await farmer
          .getByRole("button", { name: "Chấp nhận đề xuất", exact: true })
          .click();
        await farmer
          .getByRole("dialog")
          .getByRole("button", { name: "Xác nhận", exact: true })
          .click();
        await farmer
          .getByRole("button", { name: "Chấp nhận đề xuất", exact: true })
          .waitFor({ state: "hidden" });
        await visit(farmer, "/assigned-work");
        await farmer
          .getByRole("link", { name: /Khu vực nhận việc sidebar/ })
          .waitFor();
        await farmer
          .getByRole("link", { name: /Khu vực nhận việc sidebar/ })
          .click();
        await heading(farmer, workZone.zone_name);
        assert.equal(
          await farmer
            .getByRole("button", { name: "Chỉnh sửa", exact: true })
            .count(),
          0,
        );
        await visit(farmer, `/farms/${outer.farm_id}`);
        await farmer.getByRole("alert").waitFor();
        assert.equal(
          await farmer
            .getByRole("heading", { name: "NAV-OTHER-FARM", exact: true })
            .count(),
          0,
        );
      },
    );
    await check(
      "role navigation mixed owner and assignee uses per-Farm ownership rather than global is_owner",
      async () => {
        const approved = await http(
          `farm-requests/${ownProposal.id}/approve`,
          "PATCH",
          {},
          adminToken,
        );
        const ownedZone = await http(
          "zones",
          "POST",
          {
            farm_id: approved.farm_id,
            standard_id: standard.id,
            zone_name: "Khu vực sở hữu sidebar",
            area_size: 1,
            longitude: 106,
            latitude: 10,
          },
          workerToken,
        );
        assert.equal(
          (await http("auth/me", "GET", undefined, workerToken)).is_owner,
          true,
        );
        await visit(farmer, "/");
        const owned = farmer.getByRole("region", {
          name: "Vườn của tôi",
          exact: true,
        });
        const assigned = farmer.getByRole("region", {
          name: "Công việc được giao",
          exact: true,
        });
        await owned.getByText("NAV-OWN-FARM", { exact: true }).waitFor();
        await assigned.getByText(workZone.zone_name, { exact: true }).waitFor();
        assert.equal(
          await owned.getByText("NAV-OTHER-FARM", { exact: true }).count(),
          0,
        );
        assert.equal(
          await owned.getByText(workZone.zone_name, { exact: true }).count(),
          0,
        );
        await visit(farmer, `/zones/${workZone.id}`);
        await heading(farmer, workZone.zone_name);
        assert.equal(
          await farmer
            .getByRole("button", { name: "Chỉnh sửa", exact: true })
            .count(),
          0,
        );
        await visit(farmer, `/zones/${ownedZone.id}`);
        await heading(farmer, ownedZone.zone_name);
        await farmer
          .getByRole("button", { name: "Chỉnh sửa", exact: true })
          .waitFor();
        await visit(farmer, "/");
        await owned.getByText("NAV-OWN-FARM", { exact: true }).waitFor();
        await farmer.screenshot({
          path: `${screenshots}/role-farmer-mixed-desktop.png`,
          fullPage: true,
        });
      },
    );
    await check(
      "role navigation ended assignment removes current work while personal journal and assignment history remain",
      async () => {
        const journal = await http(
          "cultivation-events",
          "POST",
          {
            target_type: "Zone",
            target_id: workZone.id,
            action_type: "Watering",
            details: { duration_minutes: 12 },
          },
          workerToken,
        );
        const assignment = (
          await http(
            "zone-assignments?limit=100&offset=0",
            "GET",
            undefined,
            workerToken,
          )
        ).items.find((entry) => entry.assignment.zone_id === workZone.id);
        await http(
          `zone-assignments/${assignment.assignment.id}/end`,
          "PATCH",
          {},
          ownerToken,
        );
        await visit(farmer, "/assigned-work");
        await farmer
          .getByRole("region", { name: "Công việc được giao", exact: true })
          .getByText(/Bạn chưa có khu vực đang phụ trách/)
          .waitFor();
        assert.equal(
          await farmer
            .getByRole("link", { name: /Khu vực nhận việc sidebar/ })
            .count(),
          0,
        );
        await farmer
          .getByRole("link", { name: "Nhật ký & lịch sử của tôi", exact: true })
          .last()
          .click();
        await farmer
          .locator(`a[href="/cultivation-events/${journal._id}"]`)
          .first()
          .waitFor();
        await visit(farmer, "/assignments");
        await farmer
          .getByRole("cell", { name: workZone.zone_name, exact: true })
          .waitFor();
      },
    );
    await check(
      "role navigation Manager empty HTX gives scoped guidance then surfaces Join work without owner tools",
      async () => {
        const approval = await http(
          `users/${pendingManager.id}/approve`,
          "PATCH",
          {
            cooperative: {
              cooperative_name: "HTX sidebar chưa có vườn",
              director: "Đại diện sidebar",
              certificate_number: "NAV-HTX",
              address: "Địa chỉ kiểm thử",
              contact_number: managerPhone,
            },
          },
          adminToken,
        );
        const managerToken = (
          await http(
            "auth/login",
            "POST",
            { phone_number: managerPhone, password },
            undefined,
            200,
          )
        ).access_token;
        manager = await session(managerToken);
        await visit(manager, "/");
        await heading(manager, "HTX chưa có vườn thành viên");
        await manager.locator(".manager-stats").waitFor();
        assert.deepEqual(
          await manager
            .locator(".manager-stats .stat-card > strong")
            .allTextContents(),
          ["0", "0", "0", "0"],
        );
        await noSystemMenu(manager);
        assert.equal(
          await manager
            .getByRole("heading", { name: "Vườn trong HTX", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await manager.getByLabel("Tìm chứng nhận hoặc địa chỉ vườn").count(),
          0,
        );
        assert.equal(
          await manager.locator('.sidebar a[href="/materials"]').count(),
          0,
        );
        assert.equal(
          await manager
            .locator('.sidebar a[href="/harvest-backdates"]')
            .count(),
          0,
        );
        for (const path of [
          "/pending-managers",
          "/cooperatives/new",
          "/assigned-work",
        ]) {
          await visit(manager, path);
          await heading(manager, "Không có quyền truy cập");
        }
        const ownFarm = (
          await http("farms?limit=100&offset=0", "GET", undefined, workerToken)
        ).items.find((farm) => farm.owner_id === worker.id);
        const joined = await http(
          `farms/${ownFarm.id}/join-requests`,
          "POST",
          { cooperative_id: approval.cooperative.id },
          workerToken,
        );
        await http(
          `farm-requests/${joined.id}/approve`,
          "PATCH",
          {},
          adminToken,
        );
        await visit(manager, "/");
        await manager.locator('.role-inbox-item[href*="kind=farm"]').waitFor();
        await manager.screenshot({
          path: `${screenshots}/role-manager-empty-join.png`,
          fullPage: true,
        });
      },
    );
    await check(
      "role navigation remains balanced at 320px mobile and short desktop, closes menu and marks nested pages",
      async () => {
        for (const [page, path] of [
          [admin, "/"],
          [farmer, "/"],
          [manager, "/"],
        ]) {
          for (const viewport of [
            { width: 1366, height: 640 },
            { width: 320, height: 740 },
          ]) {
            await page.setViewportSize(viewport);
            await visit(page, path);
            await page.locator(".stat-card").first().waitFor();
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
            );
            if (viewport.width === 320) {
              await page
                .getByRole("button", { name: "Mở menu", exact: true })
                .click();
              await page.keyboard.press("Escape");
              assert.equal(await page.locator(".sidebar.open").count(), 0);
            }
          }
        }
        await farmer
          .getByRole("button", { name: "Mở menu", exact: true })
          .click();
        await group(farmer, "Công việc được giao").click();
        await farmer.locator('.sidebar a[href="/assigned-work"]').click();
        await heading(farmer, "Công việc được giao");
        assert.equal(await farmer.locator(".sidebar.open").count(), 0);
        await farmer.waitForFunction(
          () =>
            document.querySelector(".sidebar").getBoundingClientRect().right <=
            0,
        );
        assert.equal(
          await group(farmer, "Công việc được giao").getAttribute(
            "aria-expanded",
          ),
          "true",
        );
        await farmer.screenshot({
          path: `${screenshots}/role-farmer-mobile-work.png`,
          fullPage: true,
        });
        await farmer.setViewportSize({ width: 1440, height: 1000 });
      },
    );
    await check(
      "role navigation failed context and inbox reads clear their own data without invented zero counts",
      async () => {
        await farmer.route("**/api/zone-assignments?*", (route) =>
          route.abort(),
        );
        await visit(farmer, "/");
        await farmer.locator(".role-workspace").getByRole("alert").waitFor();
        assert.equal(
          await farmer
            .locator(".role-workspace")
            .getByText("NAV-OWN-FARM", { exact: true })
            .count(),
          0,
        );
        await farmer.unroute("**/api/zone-assignments?*");
        await farmer
          .locator(".role-workspace")
          .getByRole("button", { name: "Thử lại", exact: true })
          .click();
        await farmer
          .locator(".role-workspace")
          .getByText("NAV-OWN-FARM", { exact: true })
          .waitFor();
        await farmer.route("**/api/farm-requests?*", (route) => route.abort());
        await visit(farmer, "/");
        await farmer
          .locator(".role-inbox")
          .getByText(/Chưa tải được đề xuất/)
          .waitFor();
        assert.equal(
          await farmer.locator('.role-inbox-item[href*="kind=farm"]').count(),
          0,
        );
        assert.equal(
          await farmer
            .locator(".role-inbox")
            .getByText(/Không có đề xuất đang chờ/)
            .count(),
          0,
        );
        await farmer.unroute("**/api/farm-requests?*");
      },
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}
