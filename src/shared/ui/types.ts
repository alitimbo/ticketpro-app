import type { ComponentType, ReactNode, SVGProps } from "react";

export type AppStatus = "active" | "offline" | "error" | "success" | "warning";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type RoleVisibility = {
  allowedRoles?: string[];
};

export type WithChildren = {
  children: ReactNode;
};
