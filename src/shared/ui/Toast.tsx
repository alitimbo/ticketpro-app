import type { ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import type { AppStatus } from "./types";

type ToastProps = {
  message: string;
  status?: Exclude<AppStatus, "offline">;
  title: string;
};

const icons = {
  active: Info,
  error: XCircle,
  success: CheckCircle2,
  warning: TriangleAlert
};

export function Toast({ message, status = "active", title }: ToastProps) {
  const Icon = icons[status];

  return (
    <div className={`toast toast--${status}`} role="status">
      <Icon aria-hidden="true" />
      <div>
        <p className="toast__title">{title}</p>
        <p className="toast__message">{message}</p>
      </div>
    </div>
  );
}

export function ToastRegion({ children }: { children: ReactNode }) {
  return <div className="toast-region">{children}</div>;
}
