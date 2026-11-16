// Bổ sung rule certificate UNIQUE của MockCooperativeStore; không sửa 001.
// Dữ liệu trùng sẵn có làm migration fail/rollback, không tự xóa/gộp/đổi mã.
export const COOPERATIVE_SCHEMA_V2 = String.raw`
CREATE UNIQUE INDEX cooperatives_certificate_number ON public.cooperatives(certificate_number);
`;
