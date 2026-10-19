export const SENSOR_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX sensor_one_pending_update ON technical.workflow_requests(lower(target_key))
WHERE module='sensors' AND status='Pending' AND target_key IS NOT NULL;
`;
