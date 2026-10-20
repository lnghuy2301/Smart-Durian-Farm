import { AgriculturalMaterial } from '../materials/materials.service';

export const TARGET_TYPES = ['Zone', 'Tree'] as const;
export const ACTION_TYPES = ['Watering', 'Spraying', 'Fertilizing'] as const;
export const EVENT_STATUSES = ['Pending', 'Locked'] as const;
export const LOCK_DELAY_MS = 15 * 60 * 1000;
export const EVENT_CAPACITY = 10000;

export interface MaterialSnapshot {
  material_id: string;
  quantity: number;
  name: string;
  material_type: AgriculturalMaterial['material_type'];
  unit: string;
  default_dosage: string;
  quarantine_days: number;
  standard_linked: boolean;
}

export interface EventDetails {
  standard_snapshot: { standard_id: string; code: string; name: string };
  note: string | null;
  duration_minutes?: number;
  water_volume_l?: number | null;
  materials?: MaterialSnapshot[];
  warnings: { code: 'MATERIAL_OUTSIDE_STANDARD'; material_id: string }[];
}

// Field cấp gốc theo CULTIVATION_EVENTS trong ERD; tác giả/thời gian/hash
// chỉ backend sinh, không nhận bằng chứng quyền từ body.
export interface CultivationEvent {
  _id: string;
  farmer_id: string;
  target_id: string;
  target_type: typeof TARGET_TYPES[number];
  action_type: typeof ACTION_TYPES[number];
  details: EventDetails;
  status: typeof EVENT_STATUSES[number];
  is_correction: boolean;
  reference_event_id: string | null;
  root_event_id: string | null;
  correction_reason: string | null;
  created_at: string;
  locked_at: string | null;
  lock_at: string;
  previous_hash: string | null;
  hash: string | null;
}

// Private authority context outside the business document; Mongo persists it in
// PERSISTENCE_STATE. Corrections retain the ORIGINAL assignment and timestamp.
export interface EventContext {
  zone_id: string;
  farm_id: string;
  author_id: string;
  assignment_id: string | null;
  original_created_at: string;
  root_id: string;
}
