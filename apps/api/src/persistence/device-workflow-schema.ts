export const DEVICE_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX device_one_pending_update ON technical.workflow_requests(lower(target_key))
WHERE module='devices' AND status='Pending' AND target_key IS NOT NULL;
`;
