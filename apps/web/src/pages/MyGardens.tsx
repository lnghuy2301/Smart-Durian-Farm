import { useSearchParams } from "react-router-dom";
import { useCallback, useState } from "react";
import { StableContentFrame } from "../components/StableContentFrame";
import { useSession } from "../auth/session";
import { DataState, Field, Notice } from "../components/ui";
import { useCollection, useOwnedFarms } from "../workflows/shared";
import {
  ResourceList,
  ResourcePage,
  farmDefinition,
  zoneDefinition,
  treeDefinition,
} from "./Resources";
import { deviceDefinition } from "./IotResources";
import type { Zone } from "../types/api";

const views = {
  farms: "Vườn của tôi",
  zones: "Khu vực",
  trees: "Cây trồng",
  devices: "Thiết bị",
};
type View = keyof typeof views;
export function FarmsPage() {
  const { user } = useSession();
  return user.role === "Farmer" ? (
    <MyGardens />
  ) : (
    <ResourcePage definition={farmDefinition} />
  );
}
function MyGardens() {
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view") ?? "farms";
  const view: View = Object.hasOwn(views, requestedView)
    ? (requestedView as View)
    : "farms";
  const farms = useOwnedFarms();
  const requestedFarm = params.get("farm_id");
  // This hub is the ownership context only. Never fall back to an assigned
  // Zone or use is_owner to grant management of a different Farm.
  const farm = requestedFarm
    ? farms.data?.find((item) => item.id === requestedFarm)
    : farms.data?.[0];
  const zones = useCollection<Zone>(
    `zones?farm_id=${farm?.id ?? ""}`,
    !!farm && (view === "trees" || view === "devices"),
  );
  const requestedZone = params.get("zone_id");
  const zone = requestedZone
    ? zones.data?.find(
        (item) => item.id === requestedZone && item.farm_id === farm?.id,
      )
    : zones.data?.find((item) => item.farm_id === farm?.id);
  const contentKey = `${view}/${farm?.id ?? ""}/${zone?.id ?? ""}`;
  const [loadedKey, setLoadedKey] = useState("");
  const onSettled = useCallback(() => setLoadedKey(contentKey), [contentKey]);
  const pending =
    !!farm &&
    (view === "zones"
      ? loadedKey !== contentKey
      : zones.loading || (!!zone && loadedKey !== contentKey));
  const change = (key: "view" | "farm_id" | "zone_id", value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams();
      next.set("view", key === "view" ? value : view);
      const selectedFarm = key === "farm_id" ? value : previous.get("farm_id");
      if (selectedFarm) next.set("farm_id", selectedFarm);
      if (key === "zone_id") next.set("zone_id", value);
      return next;
    });
  return (
    <>
      <nav className="workflow-tabs" aria-label="Nội dung vườn của tôi">
        {Object.entries(views).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`button secondary ${view === key ? "selected" : ""}`}
            aria-pressed={view === key}
            onClick={() => change("view", key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === "farms" ? (
        <ResourceList
          definition={{
            ...farmDefinition,
            title: "Vườn của tôi",
            subtitle: "Quản lý vườn, khu vực, cây trồng và thiết bị của bạn.",
          }}
        />
      ) : (
        <>
          <p className="table-note">
            Chọn vườn của bạn để xem dữ liệu liên quan. Công việc nhận ở vườn
            khác nằm trong Công việc được giao.
          </p>
          <DataState resource={farms}>
            {(owned) =>
              owned.length ? (
                <>
                  <div className="panel toolbar">
                    <Field label="Vườn trồng">
                      <select
                        value={farm?.id ?? ""}
                        onChange={(event) =>
                          change("farm_id", event.target.value)
                        }
                      >
                        <option value="" disabled>
                          Chọn vườn của tôi
                        </option>
                        {owned.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.address}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(view === "trees" || view === "devices") && (
                      <Field label="Khu vực">
                        <select
                          value={zone?.id ?? ""}
                          disabled={zones.loading || !!zones.error}
                          onChange={(event) =>
                            change("zone_id", event.target.value)
                          }
                        >
                          <option value="" disabled>
                            {zones.loading
                              ? "Đang tải khu vực…"
                              : "Chọn khu vực"}
                          </option>
                          {zones.data
                            ?.filter((item) => item.farm_id === farm?.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.zone_name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </div>
                  <StableContentFrame pending={pending}>
                    {!farm ? (
                      <Notice kind="warning">
                        Vườn được chọn không thuộc danh sách vườn của bạn. Hãy
                        chọn lại.
                      </Notice>
                    ) : view === "zones" ? (
                      <ResourceList
                        key={farm.id}
                        onSettled={onSettled}
                        definition={{
                          ...zoneDefinition,
                          title: "Khu vực trong vườn",
                          relationships: [],
                          fixedFilters: { farm_id: farm.id },
                        }}
                      />
                    ) : (
                      <DataState resource={zones}>
                        {() =>
                          zone ? (
                            view === "trees" ? (
                              <ResourceList
                                key={zone.id}
                                onSettled={onSettled}
                                definition={{
                                  ...treeDefinition,
                                  relationships: [],
                                  fixedFilters: { zone_id: zone.id },
                                }}
                              />
                            ) : (
                              <ResourceList
                                key={zone.id}
                                onSettled={onSettled}
                                definition={{
                                  ...deviceDefinition,
                                  relationships: [],
                                  fixedFilters: { zone_id: zone.id },
                                }}
                              />
                            )
                          ) : (
                            <Notice>
                              Chưa có khu vực phù hợp trong vườn này. Mở tab Khu
                              vực để tạo khu vực theo quyền hiện có.
                            </Notice>
                          )
                        }
                      </DataState>
                    )}
                  </StableContentFrame>
                </>
              ) : (
                <Notice>
                  Bạn chưa có vườn được duyệt. Mở tab Vườn của tôi để gửi yêu
                  cầu tạo vườn.
                </Notice>
              )
            }
          </DataState>
        </>
      )}
    </>
  );
}
