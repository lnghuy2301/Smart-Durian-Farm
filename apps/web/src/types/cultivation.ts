export type Activity = "Watering" | "Spraying" | "Fertilizing" | "Other";
export interface Journal {
  _id: string;
  farmer_id: string;
  target_type: "Zone" | "Tree";
  target_id: string;
  action_type: Activity;
  status: "Pending" | "Locked";
  is_correction: boolean;
  reference_event_id: string | null;
  root_event_id: string | null;
  correction_reason: string | null;
  created_at: string;
  lock_at: string;
  locked_at: string | null;
  previous_hash: string | null;
  hash: string | null;
  details: {
    note: string | null;
    activity_name?: string;
    duration_minutes?: number;
    water_volume_l?: number | null;
    standard_snapshot: { standard_id: string; code: string; name: string };
    materials?: {
      material_id: string;
      quantity: number;
      name: string;
      material_type: string;
      unit: string;
      default_dosage: string;
      quarantine_days: number;
      standard_linked: boolean;
    }[];
    warnings: { code: "MATERIAL_OUTSIDE_STANDARD"; material_id: string }[];
  };
}
export const activityLabels: Record<Activity, string> = {
  Watering: "Tưới nước",
  Spraying: "Phun thuốc",
  Fertilizing: "Bón phân",
  Other: "Công việc khác",
};
