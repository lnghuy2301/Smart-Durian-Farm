export const TREE_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX tree_one_pending_update ON technical.workflow_requests(lower(target_key))
WHERE module='trees' AND status='Pending' AND target_key IS NOT NULL;
`;
