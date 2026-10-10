export interface TraceSummary {
  tree: {
    tree_code: string;
    variety: string;
    plant_date: string;
    status: "Active" | "Dead" | "Removed";
  };
  zone: { name: string };
  cooperative: { name: string } | null;
  standard: { code: string; name: string; status: "Active" | "Inactive" };
  trace_url: string;
}
export interface TraceTarget {
  type: "Zone" | "Tree";
  label: string;
}
export interface TraceVersion {
  history_key: string;
  version: number;
  latest_version: number;
  is_correction: boolean;
  is_latest: boolean;
  applies_to_tree: boolean;
  latest_applies_to_tree: boolean;
  target: TraceTarget;
  latest_target: TraceTarget;
  action_type: "Watering" | "Spraying" | "Fertilizing";
  entered_at: string;
  locked_at: string;
  details: {
    standard_snapshot: { code: string; name: string };
    duration_minutes?: number;
    water_volume_l?: number | null;
    materials?: {
      name: string;
      quantity: number;
      unit: string;
      standard_linked: boolean;
    }[];
  };
}
export interface TraceHarvest {
  season_name: string;
  harvest_date: string;
  fruit_count: number;
  total_weight_kg: number;
  batch_code: string;
  confirmation_state: "Confirmed";
}
