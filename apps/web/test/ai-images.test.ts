import { expect, test } from "vitest";
import { validateImage } from "../src/pages/ai/types";

test("AI upload rejects empty, oversized or disguised files before sending", async () => {
  await expect(validateImage(new File([], "empty.png"))).rejects.toThrow(
    "5 MB",
  );
  await expect(
    validateImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png")),
  ).rejects.toThrow("5 MB");
  await expect(
    validateImage(
      new File(["not an image"], "photo.png", { type: "image/png" }),
    ),
  ).rejects.toThrow("định dạng");
  await expect(
    validateImage(
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "photo.png",
      ),
    ),
  ).resolves.toBeUndefined();
  await expect(
    validateImage(new File([new Uint8Array([255, 216, 255, 0])], "photo.jpg")),
  ).resolves.toBeUndefined();
});
