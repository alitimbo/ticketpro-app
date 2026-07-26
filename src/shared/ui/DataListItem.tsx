import type { ReactNode } from "react";
import type { IconComponent } from "./types";

type DataListItemProps = {
  actions?: ReactNode;
  description?: string;
  icon: IconComponent;
  meta?: ReactNode;
  title: string;
};

export function DataListItem({ actions, description, icon: Icon, meta, title }: DataListItemProps) {
  return (
    <article className="data-list-item">
      <div className="data-list-item__main">
        <span className="data-list-item__icon">
          <Icon aria-hidden="true" />
        </span>
        <div>
          <h3 className="data-list-item__title">{title}</h3>
          {description ? <p className="data-list-item__description">{description}</p> : null}
        </div>
      </div>
      <div className="data-list-item__meta">
        {meta}
        {actions}
      </div>
    </article>
  );
}
