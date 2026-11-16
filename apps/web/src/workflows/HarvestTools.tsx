import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../auth/session";
import {
  ConfirmDialog,
  EditorDialog,
  WorkflowLinks,
  useCollection,
  type Values,
} from "./shared";
import { harvestFields } from "./harvestConfig";
import type { Farm, Harvest, Tree, Zone } from "../types/api";
export function HarvestTools({
  item,
  onSaved,
}: {
  item?: Harvest;
  onSaved: () => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const trees = useCollection<Tree>("trees", user.role === "Farmer");
  const zones = useCollection<Zone>("zones", user.role === "Farmer");
  const farms = useCollection<Farm>("farms", user.role === "Farmer");
  const [action, setAction] = useState<
    "create" | "edit" | "submit" | "delete" | "correct"
  >();
  const tree = trees.data?.find((x) => x.id === item?.tree_id);
  const zone = zones.data?.find((x) => x.id === tree?.zone_id);
  const owner = farms.data?.some(
    (x) => x.id === zone?.farm_id && x.owner_id === user.id,
  );
  const author = item?.created_by === user.id;
  const working = user.role === "Farmer" && !!tree;
  function saved() {
    if (action === "delete") {
      navigate("/tree-harvests");
      return;
    }
    setAction(undefined);
    onSaved();
  }
  const before = item ? ({ ...item } as Values) : undefined;
  return (
    <>
      <WorkflowLinks kind="harvest">
        <Link className="button secondary" to="/harvest-backdates">
          Quyền nhập bù
        </Link>
        {!item && user.role === "Farmer" && !!trees.data?.length && (
          <button className="button" onClick={() => setAction("create")}>
            Ghi nhận thu hoạch
          </button>
        )}
        {item?.status === "Draft" && working && (author || owner) && (
          <>
            <button className="button" onClick={() => setAction("edit")}>
              Sửa bản nháp
            </button>
            <button
              className="button secondary"
              onClick={() => setAction("delete")}
            >
              Xóa bản nháp
            </button>
            {author && (
              <button className="button" onClick={() => setAction("submit")}>
                Gửi xác nhận thu hoạch
              </button>
            )}
          </>
        )}
        {item?.status === "Confirmed" &&
          user.role === "Farmer" &&
          (author || owner) && (
            <button className="button" onClick={() => setAction("correct")}>
              Yêu cầu đính chính
            </button>
          )}
      </WorkflowLinks>
      {(action === "create" || action === "edit") && (
        <EditorDialog
          title={
            action === "create"
              ? "Ghi nhận thu hoạch"
              : "Sửa bản nháp thu hoạch"
          }
          fields={harvestFields}
          initial={before}
          before={before}
          path={item ? `tree-harvests/${item.id}` : "tree-harvests"}
          method={item ? "PATCH" : "POST"}
          onClose={() => setAction(undefined)}
          onSaved={saved}
        >
          <p className="muted">
            Một cây có một hồ sơ trong một ngày. Mã lô chỉ dùng cho cùng khu vực
            và ngày thu hoạch. Nhập bù quá 7 ngày cần quyền còn hạn của Admin.
          </p>
        </EditorDialog>
      )}
      {(action === "submit" || action === "delete") && item && (
        <ConfirmDialog
          title={
            action === "submit" ? "Gửi xác nhận thu hoạch" : "Xóa bản nháp"
          }
          path={`tree-harvests/${item.id}${action === "submit" ? "/submit" : ""}`}
          method={action === "delete" ? "DELETE" : "PATCH"}
          onClose={() => setAction(undefined)}
          onSaved={saved}
        >
          <p>
            {action === "submit"
              ? owner
                ? "Bạn là chủ vườn và tác giả; hồ sơ sẽ được xác nhận ngay khi gửi."
                : "Chủ vườn sẽ kiểm tra và xác nhận hồ sơ của bạn."
              : "Bản nháp này sẽ bị xóa sau khi xác nhận."}
          </p>
        </ConfirmDialog>
      )}
      {action === "correct" && item && (
        <EditorDialog
          title="Yêu cầu đính chính thu hoạch"
          fields={[
            ...(working ? harvestFields.filter((x) => !x.createOnly) : []),
            {
              key: "reason",
              label: "Lý do đính chính",
              type: "textarea",
              maxLength: 500,
            },
          ]}
          initial={before}
          before={working ? before : undefined}
          path={`tree-harvests/${item.id}/correction-requests`}
          transform={(body) => {
            const { reason, ...changes } = body;
            return {
              reason,
              ...(Object.keys(changes).length ? { changes } : {}),
            };
          }}
          onClose={() => setAction(undefined)}
          onSaved={saved}
        >
          <p className="muted">
            {working
              ? "Dữ liệu đã xác nhận giữ nguyên cho đến khi Manager HTX hoặc Admin của vườn độc lập duyệt."
              : "Bạn đã hết quyền ghi mới tại khu vực; chỉ gửi lý do để chủ vườn bổ sung nội dung."}
          </p>
        </EditorDialog>
      )}
    </>
  );
}
export function HarvestPrepare({
  id,
  snapshot,
  allowed,
  onSaved,
}: {
  id: string;
  snapshot: Record<string, unknown>;
  allowed: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return allowed ? (
    <>
      <button className="button secondary" onClick={() => setOpen(true)}>
        Chuẩn bị nội dung đính chính
      </button>
      {open && (
        <EditorDialog
          title="Bổ sung thay đổi thu hoạch"
          fields={harvestFields}
          initial={snapshot as Values}
          before={snapshot as Values}
          path={`harvest-requests/${id}/changes`}
          method="PATCH"
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </>
  ) : null;
}
