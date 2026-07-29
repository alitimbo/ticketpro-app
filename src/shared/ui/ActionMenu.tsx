import { MoreVertical } from "lucide-react";
import { useState } from "react";
import type { IconComponent, RoleVisibility } from "./types";

type ActionMenuItem = RoleVisibility & {
  icon?: IconComponent;
  label: string;
  onSelect: () => void;
};

type ActionMenuProps = {
  disabled?: boolean;
  items: ActionMenuItem[];
  open?: boolean;
};

export function ActionMenu({ disabled = false, items, open }: ActionMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = disabled ? false : open ?? internalOpen;

  return (
    <div className="action-menu" onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Actions"
        className="action-menu__button"
        disabled={disabled}
        onClick={() => setInternalOpen((current) => !current)}
        type="button"
      >
        <MoreVertical aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="action-menu__panel" role="menu">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <button
                className="action-menu__item"
                key={item.label}
                onClick={() => {
                  item.onSelect();
                  setInternalOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                {Icon ? <Icon aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
