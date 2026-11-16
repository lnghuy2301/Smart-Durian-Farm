import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/pages/ai/ChatMarkdown";

test("assistant Markdown renders bold, lists and code as elements", () => {
  const html = renderToStaticMarkup(
    <ChatMarkdown
      text={"**Tưới nước**\n\n1. Giữ ẩm\n2. Theo dõi\n\n`ghi chú`"}
    />,
  );
  expect(html).toContain("<strong>Tưới nước</strong>");
  expect(html).toContain("<ol>");
  expect(html).toContain("<li>Giữ ẩm</li>");
  expect(html).toContain("<code>ghi chú</code>");
});

test("assistant output cannot inject HTML, script URLs or tracking images", () => {
  const html = renderToStaticMarkup(
    <ChatMarkdown
      text={
        "<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![track](https://example.com/pixel)"
      }
    />,
  );
  expect(html).not.toContain("<script");
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<img");
});
