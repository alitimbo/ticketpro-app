import type { IconComponent } from "./types";
import { Card } from "./Card";

type StatCardProps = {
  icon: IconComponent;
  label: string;
  value: string;
  hint?: string;
};

export function StatCard({ hint, icon: Icon, label, value }: StatCardProps) {
  return (
    <Card className="stat-card">
      <div className="stat-card__top">
        <div>
          <p className="stat-card__label">{label}</p>
          <p className="stat-card__value">{value}</p>
        </div>
        <span className="stat-card__icon">
          <Icon aria-hidden="true" />
        </span>
      </div>
      {hint ? <p className="stat-card__hint">{hint}</p> : null}
    </Card>
  );
}
