# TicketPro theme

## Compact token summary

- Font: Inter, fallback to system sans-serif and Segoe UI.
- Brand navy: `#051b5b`; brand blue/primary: `#0666fd`; cyan: `#38a5ff`.
- Brand gradient: `linear-gradient(135deg, #051b5b 0%, #0666fd 68%, #38a5ff 100%)`.
- Background: `#f5f8fd`; surface: `#ffffff`; muted surface: `#f8fafe`.
- Text: `#0b1739`; muted: `#53627a`; subtle: `#7f8ba0`.
- Border: `#dce5f2`; strong border: `#bfccdf`; focus ring: `rgba(6, 102, 253, 0.22)`.
- Success: `#168a55`; warning: `#b7791f`; error: `#c83a3a`; offline: `#7a8494`.
- Radius: 6px / 8px / 10px. Shadows use navy tint, from subtle to `0 20px 45px rgba(5,27,91,.14)`.
- Desktop-first Tauri window: 1200×760 default, 960×640 minimum.
- Motion: loaders rotate around 0.8s linear; status indicators use restrained blue/green pulse; transitions are short (roughly 160–240ms).

## Relevant raw source from `src/styles.css`

```css
:root {
  --color-brand-navy: #051b5b;
  --color-brand-blue: #0666fd;
  --color-brand-cyan: #38a5ff;
  --color-brand-gradient: linear-gradient(135deg, #051b5b 0%, #0666fd 68%, #38a5ff 100%);
  --color-primary: #0666fd;
  --color-primary-hover: #0759d9;
  --color-primary-active: #0649b8;
  --color-primary-strong: #051b5b;
  --color-primary-soft: #eaf2ff;
  --color-primary-soft-hover: #dceaff;
  --color-primary-border: #bfd6ff;
  --color-primary-border-strong: #8fb8ff;
  --color-focus-ring: rgba(6, 102, 253, 0.22);
  --color-selection: rgba(6, 102, 253, 0.14);
  --color-bg: #f5f8fd;
  --color-surface: #ffffff;
  --color-surface-muted: #f8fafe;
  --color-border: #dce5f2;
  --color-border-strong: #bfccdf;
  --color-text: #0b1739;
  --color-muted: #53627a;
  --color-subtle: #7f8ba0;
  --color-success: #168a55;
  --color-success-soft: #eaf8f1;
  --color-warning: #b7791f;
  --color-warning-soft: #fff7e6;
  --color-error: #c83a3a;
  --color-error-soft: #fff0f0;
  --color-offline: #7a8494;
  --color-offline-soft: #f0f2f5;
  --shadow-sm: 0 1px 2px rgba(5, 27, 91, 0.07);
  --shadow-md: 0 12px 28px rgba(5, 27, 91, 0.1);
  --shadow-lg: 0 20px 45px rgba(5, 27, 91, 0.14);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  color: var(--color-text);
  background: var(--color-bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { min-width: 320px; min-height: 100vh; margin: 0; }
.app-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 100vh; background: var(--color-bg); }
.sidebar { display: flex; flex-direction: column; gap: 18px; min-height: 100vh; padding: 16px 12px; border-right: 1px solid var(--color-border); color: var(--color-text); background: var(--color-surface); }
.sidebar__mark { width: 40px; height: 40px; flex: 0 0 40px; object-fit: contain; }
```

The full stylesheet is `src/styles.css` (6,950 lines). For generation, use this compact summary plus only the selectors relevant to the requested target; never pass the whole stylesheet payload.
