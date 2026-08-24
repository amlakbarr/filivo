export function sanitizeAnalyticsError(value: unknown) {
  return String(value || "خطای ثبت‌نشده")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(
      /bearer\s+[a-zA-Z0-9._-]+/gi,
      "Bearer [REDACTED]"
    )
    .replace(
      /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      "[REDACTED]"
    )
    .replace(
      /(api[_-]?key|token|password)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]"
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
