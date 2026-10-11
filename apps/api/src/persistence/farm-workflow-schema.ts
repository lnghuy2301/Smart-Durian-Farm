// Create chưa có target_key nên được đề xuất nhiều Farm cho cùng Farmer.
// Các request của Farm đã có UUID chỉ chiếm slot trong lúc Pending.
export const FARM_WORKFLOW_SCHEMA = String.raw`
CREATE UNIQUE INDEX farm_one_pending_request ON technical.workflow_requests(lower(target_key))
 WHERE module='farms' AND status='Pending' AND target_key IS NOT NULL;
`;
