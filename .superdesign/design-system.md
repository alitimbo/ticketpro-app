# TicketPro design system

TicketPro is a Windows-first Tauri desktop SaaS for professional MikroTik Hotspot and voucher management. The interface must feel reliable, operational, secure and easy to read for WiFi-zone owners, administrators and operators.

## Brand

- Always use the real transparent TicketPro logo from `src-tauri/icons/icon.png` in logo positions.
- Product label: `TicketPro`.
- Signature: `par Akicorp Solutions`.
- Primary palette comes directly from the logo: navy `#051b5b`, electric blue `#0666fd`, cyan `#38a5ff`.
- Never invent another logo, substitute initials, or add decorative gradients outside this palette.

## Foundations

- Inter/system sans typography; compact but readable desktop density.
- Light application background `#f5f8fd`, white surfaces, dark navy text.
- Small radii (6–10px), subtle navy shadows and fine cool-gray borders.
- Status colors are functional: green success, amber warning, red error, gray offline.
- Motion is restrained and purposeful: short fades, soft scale-in, spinner rotation and subtle status pulse. Respect `prefers-reduced-motion`.

## Startup splash target

- Full Tauri window, no sidebar or route content visible underneath.
- Centered official TicketPro logo, approximately 112–144px depending on viewport.
- `TicketPro` title and small `par Akicorp Solutions` signature.
- One concise live status such as `Préparation de votre espace sécurisé…` with a minimal animated indicator.
- White-to-very-light-blue background with a restrained blue ambient glow; no heavy card, no progress percentage, no fake multi-step timeline.
- It remains visible while local SQLite, authentication restoration and the initial app shell become ready, with a short graceful exit transition only after readiness.
- Accessible `role="status"`, `aria-live="polite"`, and reduced-motion fallback.
- Must not impose a fixed artificial delay; a small minimum display time around 500–700ms is acceptable only to prevent visual flashing.
