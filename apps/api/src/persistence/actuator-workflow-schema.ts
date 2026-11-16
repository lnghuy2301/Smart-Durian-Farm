export const ACTUATOR_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX actuator_one_pending_update ON technical.workflow_requests(lower(target_key))
WHERE module='actuators' AND status='Pending' AND target_key IS NOT NULL;
`;
