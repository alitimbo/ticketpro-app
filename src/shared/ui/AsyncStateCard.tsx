import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";

export type AsyncStateCardStatus = "loading" | "error";

type AsyncStateCardProps = {
  description: string;
  errorDescription: string;
  errorTitle: string;
  loadingDescription?: string;
  loadingTitle?: string;
  onRetry?: () => void;
  retryLabel?: string;
  status: AsyncStateCardStatus;
  title: string;
};

export function AsyncStateCard({
  description,
  errorDescription,
  errorTitle,
  loadingDescription = "Chargement des données en cours.",
  loadingTitle = "Chargement…",
  onRetry,
  retryLabel = "Réessayer",
  status,
  title
}: AsyncStateCardProps) {
  const isLoading = status === "loading";

  return (
    <Card
      actions={!isLoading && onRetry ? <Button icon={RefreshCw} onClick={onRetry}>{retryLabel}</Button> : undefined}
      description={description}
      title={title}
    >
      <div
        aria-live="polite"
        className={`async-state-card async-state-card--${status}`}
        role={isLoading ? "status" : "alert"}
      >
        {isLoading ? <LoaderCircle aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <div>
          <strong>{isLoading ? loadingTitle : errorTitle}</strong>
          <span>{isLoading ? loadingDescription : errorDescription}</span>
        </div>
      </div>
    </Card>
  );
}
