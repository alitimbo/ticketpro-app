import type { HTMLAttributes } from "react";
import type { AppStatus } from "./types";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  status?: AppStatus;
};

export function Badge({ children, className = "", status = "active", ...props }: BadgeProps) {
  return (
    <span className={["badge", `badge--${status}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
