export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

// Chỉ chuẩn hóa để chống đăng ký trùng; login giữ đúng dạng số đã lưu.
export function phoneIdentity(phone: string): string {
  const digits = phone.replace(/^\+/, '');
  return /^0\d{9}$/.test(digits) ? `84${digits.slice(1)}` : digits;
}
