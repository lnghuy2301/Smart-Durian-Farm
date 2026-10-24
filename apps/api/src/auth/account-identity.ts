export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

// Cùng identity cho uniqueness và đăng nhập/OTP; không đổi số lưu hoặc số gửi provider.
export function phoneIdentity(phone: string): string {
  const digits = phone.replace(/^\+/, '');
  return /^0\d{9}$/.test(digits) ? `84${digits.slice(1)}` : digits;
}
