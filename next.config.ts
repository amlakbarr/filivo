import type {
  NextConfig,
} from "next";

const securityHeaders = [
  /*
   * جلوگیری از MIME sniffing
   */
  {
    key:
      "X-Content-Type-Options",

    value:
      "nosniff",
  },

  /*
   * جلوگیری از نمایش سایت داخل iframe
   * سایت‌های دیگر.
   *
   * SAMEORIGIN اجازه iframe از همین Origin
   * را می‌دهد.
   */
  {
    key:
      "X-Frame-Options",

    value:
      "SAMEORIGIN",
  },

  /*
   * کنترل اطلاعات Referer که به سایت‌های
   * دیگر ارسال می‌شود.
   */
  {
    key:
      "Referrer-Policy",

    value:
      "strict-origin-when-cross-origin",
  },

  /*
   * قابلیت‌هایی که این اپلیکیشن فعلاً
   * نیازی به آن‌ها ندارد.
   *
   * microphone را عمداً نبسته‌ایم تا اگر
   * بعداً Voice Chat اضافه شد مانع آن نشود.
   */
  {
    key:
      "Permissions-Policy",

    value:
      [
        "camera=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
      ].join(
        ", "
      ),
  },

  /*
   * Browsers نباید DNS Prefetch ناخواسته
   * برای لینک‌های صفحه انجام دهند.
   */
  {
    key:
      "X-DNS-Prefetch-Control",

    value:
      "off",
  },
];

/*
 * ============================================
 * HSTS
 *
 * فقط Production.
 *
 * روی Production فرض ما HTTPS است.
 * فعلاً includeSubDomains و preload را
 * اضافه نمی‌کنیم تا Subdomain دیگری
 * ناخواسته تحت تأثیر قرار نگیرد.
 * ============================================
 */

if (
  process.env.NODE_ENV ===
  "production"
) {
  securityHeaders.push({
    key:
      "Strict-Transport-Security",

    value:
      "max-age=31536000",
  });
}

/*
 * ============================================
 * Next.js Config
 * ============================================
 */

const nextConfig:
  NextConfig = {
  /*
   * حذف:
   *
   * X-Powered-By: Next.js
   *
   * اطلاعات Framework بی‌دلیل به Client
   * اعلام نمی‌شود.
   */
  poweredByHeader:
    false,
  devIndicators:
    false,

  /*
   * ==========================================
   * Global Security Headers
   * ==========================================
   */

  async headers() {
    return [
      {
        source:
          "/:path*",

        headers:
          securityHeaders,
      },
    ];
  },
};

export default nextConfig;