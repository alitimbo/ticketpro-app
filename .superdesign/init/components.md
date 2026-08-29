# TicketPro shared UI components

Framework: React 19 with TypeScript. UI primitives are custom components styled by `src/styles.css`.

## `src/shared/ui/Button.tsx`

Reusable action button with primary, secondary, ghost and danger variants.

```tsx
import type { ButtonHTMLAttributes } from "react";
import type { IconComponent, RoleVisibility } from "./types";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  RoleVisibility & {
    icon?: IconComponent;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "normal" | "large";
  };

export function Button({
  allowedRoles: _allowedRoles,
  children,
  className = "",
  icon: Icon,
  size = "normal",
  variant = "secondary",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    variant !== "secondary" ? `button--${variant}` : "",
    size === "large" ? "button--large" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <button className={classes} type={type} {...props}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
```

## `src/shared/ui/Card.tsx`

Standard TicketPro content surface.

```tsx
import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: string;
  interactive?: boolean;
  title?: string;
};

export function Card({ actions, children, className = "", description, interactive = false, title, ...props }: CardProps) {
  const classes = ["card", interactive ? "card--interactive" : "", className].filter(Boolean).join(" ");
  return (
    <section className={classes} {...props}>
      {title || description || actions ? (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {description ? <p className="card__description">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
```

## `src/shared/ui/StatusDot.tsx`

Compact status indicator.

```tsx
import type { AppStatus } from "./types";

type StatusDotProps = { label: string; status: AppStatus };

export function StatusDot({ label, status }: StatusDotProps) {
  return <span className={`status-dot status-dot--${status}`}>{label}</span>;
}
```

## `src/shared/ui/Badge.tsx`

Small semantic label.

```tsx
import type { HTMLAttributes } from "react";
import type { AppStatus } from "./types";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { status?: AppStatus };

export function Badge({ children, className = "", status = "active", ...props }: BadgeProps) {
  return <span className={["badge", `badge--${status}`, className].filter(Boolean).join(" ")} {...props}>{children}</span>;
}
```

## `src/shared/ui/AsyncStateCard.tsx`

Loader/error card pattern already used throughout the application.

```tsx
import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";

export type AsyncStateCardStatus = "loading" | "error";
type AsyncStateCardProps = {
  description: string;
  errorDescription: string;
  errorTitle: string;
  loadingDescription?: string;
  loadingTitle?: string;
  onRetry?: () => void;
  retryLabel?: string;
  status: AsyncStateCardStatus;
  title: string;
};

export function AsyncStateCard({
  description,
  errorDescription,
  errorTitle,
  loadingDescription = "Chargement des données en cours.",
  loadingTitle = "Chargement…",
  onRetry,
  retryLabel = "Réessayer",
  status,
  title
}: AsyncStateCardProps) {
  const isLoading = status === "loading";
  return (
    <Card actions={!isLoading && onRetry ? <Button icon={RefreshCw} onClick={onRetry}>{retryLabel}</Button> : undefined} description={description} title={title}>
      <div aria-live="polite" className={`async-state-card async-state-card--${status}`} role={isLoading ? "status" : "alert"}>
        {isLoading ? <LoaderCircle aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <div>
          <strong>{isLoading ? loadingTitle : errorTitle}</strong>
          <span>{isLoading ? loadingDescription : errorDescription}</span>
        </div>
      </div>
    </Card>
  );
}
```

## `src/shared/ui/Toast.tsx`

Semantic notification pattern.

```tsx
import type { ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import type { AppStatus } from "./types";

type ToastProps = { message: string; status?: Exclude<AppStatus, "offline">; title: string };
const icons = { active: Info, error: XCircle, success: CheckCircle2, warning: TriangleAlert };

export function Toast({ message, status = "active", title }: ToastProps) {
  const Icon = icons[status];
  return (
    <div className={`toast toast--${status}`} role="status">
      <Icon aria-hidden="true" />
      <div><p className="toast__title">{title}</p><p className="toast__message">{message}</p></div>
    </div>
  );
}

export function ToastRegion({ children }: { children: ReactNode }) {
  return <div className="toast-region">{children}</div>;
}
```
