/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Clickjacking engeli
  { key: "X-Frame-Options", value: "DENY" },
  // MIME type sniffing engeli
  { key: "X-Content-Type-Options", value: "nosniff" },
  // XSS filter (eski tarayıcılar)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Referrer bilgisi sınırla
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS — HTTPS zorunlu (1 yıl)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Permissions Policy — gereksiz tarayıcı API'lerini kapat
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Content Security Policy
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",   // Next.js HMR için gerekli
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
]

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
