import { afterEach, expect, test, vi } from "vitest";
import { ApiClient, ApiError, queryString } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());
test("an interrupted email request explains the API connection failure without resending or closing Admin", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 502 }));
  vi.stubGlobal("fetch", fetcher);
  const unauthorized = vi.fn();
  await expect(
    new ApiClient("/api", undefined, unauthorized).request(
      "auth/registration/email/request",
      {
        method: "POST",
        body: { phone_number: "0900000098", gmail: "manager@example.org" },
      },
    ),
  ).rejects.toMatchObject({
    status: 502,
    message: expect.stringContaining("Kết nối tới API bị ngắt"),
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(unauthorized).not.toHaveBeenCalled();
});
test("late 401 from the previous JWT cannot close the same account after activity renewed its token", async () => {
  let release!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const expired = vi.fn(),
    client = new ApiClient("/api", "old-token", expired);
  const old = client.request("farms");
  const rejected = expect(old).rejects.toMatchObject({ status: 401 });
  client.replaceToken("renewed-token");
  release(
    new Response(JSON.stringify({ message: "Expired previous JWT" }), {
      status: 401,
    }),
  );
  await rejected;
  expect(expired).not.toHaveBeenCalled();
  await client.request("auth/me");
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
    "Bearer renewed-token",
  );
});
test("disposing while JSON is still being read cannot return another session data", async () => {
  let release!: (body: unknown) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    }),
  );
  const client = new ApiClient("/api", "old");
  const request = client.request("farms");
  const check = expect(request).rejects.toMatchObject({ name: "AbortError" });
  await reading;
  client.dispose();
  release({ items: ["private"] });
  await check;
});
test("query encoding preserves + timezone and omits only absent filters", () => {
  expect(
    queryString({ from: "2026-10-08T08:00:00+07:00", offset: 0, q: undefined }),
  ).toBe("?from=2026-10-08T08%3A00%3A00%2B07%3A00&offset=0");
});
test("401 closes only authenticated sessions; login 401 remains a form error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Sai token" }), { status: 401 }),
      ),
  );
  const expired = vi.fn();
  await expect(
    new ApiClient("/api", "token", expired).request("auth/me"),
  ).rejects.toBeInstanceOf(ApiError);
  expect(expired).toHaveBeenCalledOnce();
  await expect(
    new ApiClient("/api", undefined, expired).request("auth/login", {
      method: "POST",
      body: {},
    }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(expired).toHaveBeenCalledOnce();
});
test("mutation conflicts are returned once without automatic retries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ message: "Đã xử lý" }), { status: 409 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new ApiClient("/api", "token").request("users/id/approve", {
      method: "PATCH",
      body: {},
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledOnce();
});
test("closing a session rejects an old response and blocks further requests", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((accept) => {
          resolve = accept;
        }),
    ),
  );
  const client = new ApiClient("/api", "old");
  const pending = client.request("farms");
  const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  client.dispose();
  resolve(new Response(JSON.stringify({ items: ["private"] })));
  await check;
  await expect(client.request("farms")).rejects.toMatchObject({
    name: "AbortError",
  });
});
