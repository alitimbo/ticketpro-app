import type { ReactNode } from "react";
import type { IconComponent } from "./types";

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  icon: IconComponent;
  title: string;
};

export function EmptyState({ action, description, icon: Icon, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon aria-hidden="true" />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__description">{description}</p>
      {action}
    </div>
  );
}
