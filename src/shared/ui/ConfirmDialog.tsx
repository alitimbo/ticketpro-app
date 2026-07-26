import { Button } from "./Button";

type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

export function ConfirmDialog({
  cancelLabel = "Annuler",
  confirmLabel = "Confirmer",
  description,
  isOpen,
  onCancel,
  onConfirm,
  title
}: ConfirmDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="confirm-dialog" role="dialog">
        <h2 className="confirm-dialog__title">{title}</h2>
        <p className="confirm-dialog__description">{description}</p>
        <div className="confirm-dialog__actions">
          <Button onClick={onCancel} variant="ghost">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant="primary">
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
