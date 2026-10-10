// Chỉ các yêu cầu HTX đang xử lý mới chiếm slot Manager. Giữ lịch sử terminal.
export const COOPERATIVE_WORKFLOW_SCHEMA = String.raw`
CREATE UNIQUE INDEX cooperative_one_pending_manager ON technical.workflow_requests(requested_by)
 WHERE module='cooperatives' AND action='ManagerUpdate'
 AND status IN ('EmailPending','EmailSending','EmailVerified','SmsSending','SmsPending','SmsChecking');
`;
