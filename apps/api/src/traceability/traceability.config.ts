export interface TraceabilityConfig { publicBaseUrl: string }
export const TRACEABILITY_CONFIG = Symbol('TRACEABILITY_CONFIG');

export function readTraceabilityConfig(env: NodeJS.ProcessEnv): TraceabilityConfig {
  const value = env.TRACE_PUBLIC_BASE_URL?.trim() ?? 'http://localhost:5173';
  // Không dùng Host/X-Forwarded-Host từ request để sinh QR: nội dung QR phải
  // đến từ cấu hình tin cậy, không bị thay domain bởi header hoặc query client.
  try {
    const url = new URL(value);
    if (value.length > 200 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || ![url.origin, `${url.origin}/`].includes(value)) {
      throw new Error();
    }
    return { publicBaseUrl: url.origin };
  } catch { throw new Error('TRACE_PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment (max 200 characters)'); }
}
