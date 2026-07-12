import type { AppStatus } from "./types";

type StatusDotProps = {
  label: string;
  status: AppStatus;
};

export function StatusDot({ label, status }: StatusDotProps) {
  return <span className={`status-dot status-dot--${status}`}>{label}</span>;
}
