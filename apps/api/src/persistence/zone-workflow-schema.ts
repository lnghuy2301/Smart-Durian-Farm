export const ZONE_WORKFLOW_SCHEMA = String.raw`
CREATE UNIQUE INDEX zone_one_pending_update ON technical.workflow_requests(lower(target_key))
 WHERE module='zones' AND status='Pending' AND target_key IS NOT NULL;
`;
