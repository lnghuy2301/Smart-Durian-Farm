import { ReadableValue, useReferences } from "../components/ReadableValue";
import type { ChangeRequest } from "./Requests";
import { useSession } from "../auth/session";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function orderRequestFields(source: Record<string, unknown>) {
  const preferred = [
    "id",
    "zone_name",
    "address",
    "farm_id",
    "owner_id",
    "user_id",
    "latitude",
    "longitude",
    "area_size",
  ];
  return Object.fromEntries(
    [
      ...preferred.filter((key) => Object.hasOwn(source, key)),
      ...Object.keys(source).filter((key) => !preferred.includes(key)),
    ].map((key) => [key, source[key]]),
  );
}
export function RequestValue({
  field,
  value,
  request,
}: {
  field: string;
  value: unknown;
  request: ChangeRequest;
}) {
  const references = useReferences();
  if (typeof value === "number" && ["latitude", "longitude"].includes(field))
    return <>{String(value)}</>;
  if (field === "farm_id") {
    const name =
      request.farm_snapshot?.address ??
      (typeof value === "string" ? references[value] : undefined);
    if (typeof name === "string" && name) return <>{name}</>;
    const owner = references[request.owner_id];
    return <>{owner ? `Vườn của ${owner}` : "Vườn trong lời mời"}</>;
  }
  if (
    typeof value === "string" &&
    uuid.test(value) &&
    /_(?:id|by)$/.test(field) &&
    !references[value]
  ) {
    return (
      <>
        {field === "cooperative_id"
          ? "Chưa tải được tên HTX"
          : field === "zone_id"
            ? String(request.zone_snapshot?.zone_name ?? "Khu vực trong phiếu")
            : "Chưa tải được tên liên quan"}
      </>
    );
  }
  return <ReadableValue field={field} value={value} />;
}
export function RequestSummary({ request }: { request: ChangeRequest }) {
  const { user } = useSession();
  const snapshot = request.farm_snapshot ?? request.zone_snapshot;
  return (
    <div className="request-summary">
      {typeof snapshot?.address === "string" && (
        <span>Vườn: {snapshot.address}</span>
      )}
      {typeof snapshot?.zone_name === "string" && (
        <>
          <span>Khu vực: {snapshot.zone_name}</span>
          <span>
            Vườn:{" "}
            <RequestValue
              field="farm_id"
              value={snapshot.farm_id}
              request={request}
            />
          </span>
        </>
      )}
      {request.cooperative_id &&
        !(user.role === "Manager" && request.action === "Join") && (
          <span>
            {request.action === "Join"
              ? "HTX đề nghị gia nhập"
              : "HTX liên quan"}
            :{" "}
            <RequestValue
              field="cooperative_id"
              value={request.cooperative_id}
              request={request}
            />
          </span>
        )}
      <span>
        {request.action === "Assign" ? "Người mời" : "Người gửi"}:{" "}
        <RequestValue
          field="proposed_by"
          value={
            request.requested_by ?? request.proposed_by ?? request.owner_id
          }
          request={request}
        />
      </span>
    </div>
  );
}
