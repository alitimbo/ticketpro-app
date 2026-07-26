import { NavLink } from "react-router-dom";
import type { IconComponent, RoleVisibility } from "./types";

type SidebarItemProps = RoleVisibility & {
  end?: boolean;
  icon: IconComponent;
  label: string;
  to: string;
};

export function SidebarItem({ allowedRoles: _allowedRoles, end, icon: Icon, label, to }: SidebarItemProps) {
  return (
    <NavLink
      className={({ isActive }) =>
        isActive ? "sidebar-item sidebar-item--active" : "sidebar-item"
      }
      end={end}
      title={label}
      to={to}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}
