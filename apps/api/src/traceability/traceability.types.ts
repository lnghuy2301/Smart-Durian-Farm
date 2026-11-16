import { CultivationEvent } from '../cultivation-events/cultivation-events.types';
import { HarvestDetails } from '../tree-harvests/tree-harvests.types';
import { TREE_STATUSES } from '../trees/trees.types';

export interface PublicTarget { type: 'Zone' | 'Tree'; label: string }
export interface PublicVersion {
  history_key: string;
  version: number;
  latest_version: number;
  is_correction: boolean;
  is_latest: boolean;
  applies_to_tree: boolean;
  latest_applies_to_tree: boolean;
  target: PublicTarget;
  latest_target: PublicTarget;
  action_type: CultivationEvent['action_type'];
  entered_at: string;
  locked_at: string;
  details: {
    standard_snapshot: { code: string; name: string };
    duration_minutes?: number;
    water_volume_l?: number | null;
    materials?: { name: string; quantity: number; unit: string; standard_linked: boolean }[];
  };
}
export interface PublicTrace {
  tree: { tree_code: string; variety: string; plant_date: string; status: typeof TREE_STATUSES[number] };
  zone: { name: string };
  cooperative: { name: string } | null;
  standard: { code: string; name: string; status: 'Active' | 'Inactive' };
  trace_url: string;
}
export interface PublicHarvest extends HarvestDetails { confirmation_state: 'Confirmed' }
