import {
  Building2,
  ClipboardCheck,
  FileClock,
  Leaf,
  Map,
  Package,
  Radio,
  Sprout,
  Trees,
  Users,
  Droplets,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../types/api";

interface NavigationItem {
  to: string;
  title: string;
  icon: LucideIcon;
  paths?: string[];
}
export interface NavigationGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavigationItem[];
}
const items = {
  farms: { to: "/farms", title: "Vườn trồng", icon: Leaf },
  zones: { to: "/zones", title: "Khu vực", icon: Map },
  trees: { to: "/trees", title: "Cây trồng", icon: Trees },
  assignments: {
    to: "/assignments",
    title: "Phân công & lịch sử",
    icon: Users,
  },
  journals: {
    to: "/cultivation-events",
    title: "Nhật ký canh tác",
    icon: ClipboardCheck,
  },
  harvests: { to: "/tree-harvests", title: "Thu hoạch", icon: Sprout },
  iot: { to: "/iot", title: "Giám sát môi trường", icon: Radio },
  control: {
    to: "/actuator-control",
    title: "Điều khiển tưới / phun",
    icon: Droplets,
  },
  devices: {
    to: "/devices",
    title: "Thiết bị & cảm biến",
    icon: Radio,
    paths: ["/devices", "/sensors", "/actuators"],
  },
  cooperatives: { to: "/cooperatives", title: "Hợp tác xã", icon: Building2 },
  managers: { to: "/pending-managers", title: "Duyệt Manager", icon: Users },
  updates: {
    to: "/cooperative-updates",
    title: "Yêu cầu cập nhật HTX",
    icon: FileClock,
  },
  notifications: {
    to: "/farm-notifications",
    title: "Thông báo HTX",
    icon: Building2,
  },
  materials: { to: "/materials", title: "Vật tư", icon: Package },
  standards: {
    to: "/standards",
    title: "Tiêu chuẩn & vật tư liên kết",
    icon: ClipboardCheck,
  },
  requests: { to: "/requests", title: "Phiếu đề xuất", icon: ClipboardCheck },
  backdates: {
    to: "/harvest-backdates",
    title: "Quyền nhập bù thu hoạch",
    icon: FileClock,
  },
  work: { to: "/assigned-work", title: "Khu vực đang phụ trách", icon: Map },
} satisfies Record<string, NavigationItem>;

// These are navigation contexts, never additional roles or permission grants.
// Farm-specific actions still resolve owner_id through the existing screens/API.
export function navigationForRole(role: Role): NavigationGroup[] {
  const production = {
    id: "production",
    title: role === "Admin" ? "Tra cứu sản xuất" : "Theo dõi sản xuất",
    icon: Sprout,
    items: [
      items.journals,
      items.harvests,
      items.iot,
      { ...items.control, title: "Theo dõi lệnh tưới / phun" },
      items.devices,
    ],
  };
  const catalogs = {
    id: "catalogs",
    title: "Danh mục canh tác",
    icon: Package,
    items: [items.standards, items.materials],
  };
  if (role === "Admin")
    return [
      {
        id: "administration",
        title: "Tài khoản & HTX",
        icon: Building2,
        items: [items.managers, items.cooperatives],
      },
      {
        id: "requests",
        title: "Yêu cầu cần xử lý",
        icon: ClipboardCheck,
        items: [items.requests, items.backdates, items.updates],
      },
      catalogs,
      {
        ...production,
        items: [
          items.farms,
          items.zones,
          items.trees,
          items.assignments,
          ...production.items,
        ],
      },
    ];
  if (role === "Manager")
    return [
      {
        id: "cooperative",
        title: "HTX của tôi",
        icon: Building2,
        items: [items.cooperatives, items.updates, items.notifications],
      },
      {
        id: "requests",
        title: "Yêu cầu cần xử lý",
        icon: ClipboardCheck,
        items: [items.requests],
      },
      {
        id: "members",
        title: "Vườn thành viên",
        icon: Leaf,
        items: [items.farms, items.zones, items.trees, items.assignments],
      },
      production,
    ];
  return [
    {
      id: "owned",
      title: "Vườn của tôi",
      icon: Leaf,
      items: [{ ...items.farms, title: "Vườn & quản lý khu vực" }],
    },
    {
      id: "assigned",
      title: "Công việc được giao",
      icon: Users,
      items: [items.work, items.assignments],
    },
    {
      id: "production",
      title: "Canh tác & theo dõi",
      icon: Sprout,
      items: [
        {
          ...items.zones,
          title: "Khu vực, cây & thiết bị",
          paths: ["/zones", "/trees", "/devices", "/sensors", "/actuators"],
        },
        {
          ...items.journals,
          to: "/cultivation-events?mine=1",
          title: "Nhật ký & lịch sử của tôi",
        },
        items.harvests,
        items.iot,
        items.control,
      ],
    },
    {
      id: "requests",
      title: "Yêu cầu & tra cứu",
      icon: ClipboardCheck,
      items: [
        items.requests,
        items.backdates,
        items.standards,
        items.materials,
      ],
    },
  ];
}
export function selectedNavigation(role: Role, pathname: string) {
  for (const group of navigationForRole(role)) {
    const item = group.items.find((entry) =>
      (entry.paths ?? [entry.to.split("?")[0]]).some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
      ),
    );
    if (item) return { group, item };
  }
  return undefined;
}
// Shared read-only resource URLs remain available even when absent from a role's
// sidebar. Only intrinsically role-specific pages have a role route guard.
export const routeRoles = {
  administration: ["Admin"],
  cooperativeUpdates: ["Admin", "Manager"],
  cooperativeNotifications: ["Manager"],
  assignedWork: ["Farmer"],
} satisfies Record<string, Role[]>;
