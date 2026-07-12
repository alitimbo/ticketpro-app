import type { IconComponent } from "./types";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

type PagePlaceholderProps = {
  area: "Global" | "Routeur" | "Connexion";
  icon: IconComponent;
  title: string;
  description: string;
};

export function PagePlaceholder({ area, description, icon, title }: PagePlaceholderProps) {
  return (
    <div className="page-stack">
      <PageHeader description={description} eyebrow={area} title={title} />
      <Card>
        <EmptyState
          description="Cet espace est prêt à recevoir les prochaines fonctions, avec une interface claire pour l’opérateur."
          icon={icon}
          title="Aucune donnée à afficher"
        />
      </Card>
    </div>
  );
}
