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
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} type={type} {...props}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
