import assert from "node:assert/strict";

export async function checkPdfAuth({ page, origin, check, screenshots }) {
  await check(
    "PDF registration keeps orchard geometry across roles at desktop and low viewport",
    async () => {
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 1366, height: 640 },
        { width: 1024, height: 600 },
        { width: 390, height: 844 },
        { width: 320, height: 740 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/register`);
        await page
          .getByRole("button", { name: "Nhà nông", exact: true })
          .waitFor();
        const photo = page.locator(".auth-intro-photo");
        const before = await photo.boundingBox();
        const card = await page.locator(".auth-card").boundingBox();
        const password = await page
          .getByLabel("Mật khẩu", { exact: true })
          .boundingBox();
        for (const role of ["Quản lý HTX", "Nhà nông", "Quản lý HTX"]) {
          await page.getByRole("button", { name: role, exact: true }).click();
          await page.waitForFunction(() =>
            [
              ...document.querySelectorAll(
                ".registration-email, .registration-identity-fields > .field",
              ),
            ].every((element) =>
              element
                .getAnimations()
                .every((animation) => animation.playState === "finished"),
            ),
          );
          assert.deepEqual(await photo.boundingBox(), before);
          const after = await page.locator(".auth-card").boundingBox();
          assert.ok(
            Math.abs(after.height - card.height) <= 1,
            `${role} changes card height at ${viewport.width}: ${card.height} -> ${after.height}`,
          );
          const afterPassword = await page
            .getByLabel("Mật khẩu", { exact: true })
            .boundingBox();
          assert.ok(
            Math.abs(afterPassword.y - password.y) <= 1,
            `${role} moves password at ${viewport.width}`,
          );
        }
        await page
          .getByRole("button", { name: "Gửi mã xác minh email", exact: true })
          .scrollIntoViewIfNeeded();
        const submit = await page
          .getByRole("button", { name: "Gửi mã xác minh email", exact: true })
          .boundingBox();
        assert.ok(submit.y >= 0 && submit.y + submit.height <= viewport.height);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        );
        const footer = await page.locator(".auth-intro-footer").boundingBox();
        if (footer) assert.ok(footer.y + footer.height <= viewport.height);
        await page.screenshot({
          path: `${screenshots}/pdf-register-${viewport.width}x${viewport.height}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/register`);
      await page
        .getByRole("button", { name: "Quản lý HTX", exact: true })
        .click();
      assert.equal(await page.locator(".auth-intro-photo").isVisible(), false);
      await page
        .getByRole("button", { name: "Gửi mã xác minh email", exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page.screenshot({
        path: `${screenshots}/pdf-register-mobile.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await check(
    "PDF password is visible only while held and hides on release or blur",
    async () => {
      for (const path of ["login", "register"]) {
        await page.goto(`${origin}/${path}`);
        const input = page.getByLabel("Mật khẩu", { exact: true });
        const eye = page.getByRole("button", {
          name: "Nhấn giữ để xem mật khẩu",
          exact: true,
        });
        await eye.hover();
        await page.mouse.down();
        assert.equal(await input.getAttribute("type"), "text");
        await page.mouse.up();
        assert.equal(await input.getAttribute("type"), "password");
        await eye.click();
        assert.equal(await input.getAttribute("type"), "password");
        await eye.focus();
        await page.keyboard.down("Space");
        assert.equal(await input.getAttribute("type"), "text");
        await page.keyboard.up("Space");
        assert.equal(await input.getAttribute("type"), "password");
        await page.keyboard.down("Space");
        await input.focus();
        await page.keyboard.up("Space");
        assert.equal(await input.getAttribute("type"), "password");
      }
    },
  );
}
