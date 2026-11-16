import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  orderRequestFields,
  RequestValue,
} from "../src/pages/requestPresentation";
import type { ChangeRequest } from "../src/pages/Requests";

const farm = "12345678-1234-4234-8234-123456789012";
const request = {
  owner_id: "owner",
  zone_snapshot: { zone_name: "Khu Ri6", farm_id: farm },
} as unknown as ChangeRequest;
test("request snapshots keep original values and put coordinates together before area", () => {
  const source = {
    id: "record",
    latitude: 12.67,
    area_size: 0.5,
    longitude: 108.2,
    farm_id: farm,
  };
  const ordered = orderRequestFields(source);
  expect(Object.keys(ordered)).toEqual([
    "id",
    "farm_id",
    "latitude",
    "longitude",
    "area_size",
  ]);
  expect(ordered).toEqual(source);
});
test("missing relation labels never present a raw UUID as a garden or cooperative name", () => {
  expect(
    renderToStaticMarkup(
      <RequestValue field="farm_id" value={farm} request={request} />,
    ),
  ).toBe("Vườn trong lời mời");
  expect(
    renderToStaticMarkup(
      <RequestValue field="cooperative_id" value={farm} request={request} />,
    ),
  ).not.toContain(farm);
  expect(
    renderToStaticMarkup(
      <RequestValue field="id" value={farm} request={request} />,
    ),
  ).toContain(farm);
  expect(
    renderToStaticMarkup(
      <RequestValue field="latitude" value={12.67} request={request} />,
    ),
  ).toBe("12.67");
});
