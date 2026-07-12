import type { ButtonHTMLAttributes } from "react";
import type { IconComponent } from "./types";

type FilterButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: IconComponent;
};

export function FilterButton({
  active = false,
  children,
  className = "",
  icon: Icon,
  type = "button",
  ...props
}: FilterButtonProps) {
  return (
    <button
      className={["filter-button", active ? "filter-button--active" : "", className]
        .filter(Boolean)
        .join(" ")}
      type={type}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
