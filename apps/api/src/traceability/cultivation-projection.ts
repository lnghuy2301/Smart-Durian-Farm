import { createHash } from 'node:crypto';
import { CultivationEvent } from '../cultivation-events/cultivation-events.types';
import { compareEvents } from '../cultivation-events/cultivation-chain';
import { PublicTarget, PublicVersion } from './traceability.types';

// Shared whitelist for RAM and database. Build complete Locked lineages before
// filtering target, so A→B corrections remain visible on both QR pages.
export function projectCultivation(records: CultivationEvent[], tree: string, zone: string, zoneName: string, code: (tree: string) => string): PublicVersion[] {
  const roots = new Map<string, CultivationEvent[]>();
  for (const event of [...records].sort(compareEvents)) {
    const root = event.root_event_id ?? event._id, versions = roots.get(root) ?? [];
    versions.push(event); roots.set(root, versions);
  }
  const matches = (event: CultivationEvent) => event.target_type === 'Zone' ? event.target_id === zone : event.target_id === tree;
  const target = (event: CultivationEvent): PublicTarget => ({ type: event.target_type, label: event.target_type === 'Zone' ? zoneName : code(event.target_id) });
  const relevant = [...roots.entries()].filter(([, versions]) => versions.some(matches)).sort((a, b) => compareEvents(b[1].at(-1)!, a[1].at(-1)!));
  const items: PublicVersion[] = [];
  for (const [root, versions] of relevant) {
    const latest = versions.at(-1)!, latestTarget = target(latest);
    const historyKey = createHash('sha256').update(`smart-durian/trace-history/v1/${root}`).digest('hex');
    versions.forEach((event, index) => {
      const details: PublicVersion['details'] = { standard_snapshot: { code: event.details.standard_snapshot.code, name: event.details.standard_snapshot.name } };
      if (event.action_type === 'Watering') { details.duration_minutes = event.details.duration_minutes; details.water_volume_l = event.details.water_volume_l ?? null; }
      else details.materials = (event.details.materials ?? []).map((material) => ({ name: material.name, quantity: material.quantity, unit: material.unit, standard_linked: material.standard_linked }));
      // Never spread event/details/materials: notes, actor IDs and reasons are private.
      items.push({ history_key: historyKey, version: index + 1, latest_version: versions.length, is_correction: event.is_correction,
        is_latest: event._id === latest._id, applies_to_tree: matches(event), latest_applies_to_tree: matches(latest),
        target: target(event), latest_target: latestTarget, action_type: event.action_type, entered_at: event.created_at, locked_at: event.locked_at!, details });
    });
  }
  return items;
}
