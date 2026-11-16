// SQL nội bộ: caller bind $1=role, $2=user UUID, $3=Accepted Zone UUIDs.
// Alias z luôn là public.zones; không nhận SQL/identifiers từ HTTP.
export const ZONE_READ_SCOPE = `($1::text='Admin' OR EXISTS(SELECT 1 FROM public.farms f WHERE f.id=z.farm_id AND
  (($1='Farmer' AND f.owner_id=$2::uuid) OR ($1='Manager' AND EXISTS(SELECT 1 FROM public.cooperatives c WHERE c.id=f.cooperative_id AND c.manager_id=$2::uuid))))
  OR ($1='Farmer' AND z.id=ANY($3::uuid[])))`;
