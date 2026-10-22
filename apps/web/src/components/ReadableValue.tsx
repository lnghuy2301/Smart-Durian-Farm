import { createContext, useContext, useCallback, type ReactNode } from "react";
import { useSession } from "../auth/session";
import { useResource } from "../hooks/useResource";
import { displayValue } from "./presentation";

const References = createContext<Record<string, string>>({});
export function ReferenceScope({
  kind,
  id,
  children,
}: {
  kind: string;
  id: string;
  children: ReactNode;
}) {
  const { api, user } = useSession();
  const path = `display-references/${kind}/${id}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<{ labels: Record<string, string> }>(path, { signal }),
    [api, path],
  );
  const resource = useResource(`${user.id}:${path}`, load);
  // No persistent/global directory cache: names belong to this authenticated
  // resource scope and disappear when the session/page is unmounted.
  return (
    <References.Provider
      value={{ [user.id]: `${user.user_name} (bạn)`, ...resource.data?.labels }}
    >
      {children}
    </References.Provider>
  );
}
export function useReferences() {
  return useContext(References);
}
export function RecordReference({
  kind,
  id,
  field,
  value,
}: {
  kind: string;
  id: string;
  field: string;
  value: unknown;
}) {
  return (
    <ReferenceScope kind={kind} id={id}>
      <ReadableValue field={field} value={value} />
    </ReferenceScope>
  );
}
export function ReadableValue({
  field,
  value,
}: {
  field: string;
  value: unknown;
}) {
  const references = useReferences();
  const text = displayValue(field, value, references);
  const resolved =
    typeof value === "string" &&
    references[value] &&
    /_(?:id|by)$/.test(field) &&
    field !== "_id";
  return <span title={resolved ? `ID: ${value}` : undefined}>{text}</span>;
}
