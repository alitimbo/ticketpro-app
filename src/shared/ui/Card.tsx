import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: string;
  interactive?: boolean;
  title?: string;
};

export function Card({
  actions,
  children,
  className = "",
  description,
  interactive = false,
  title,
  ...props
}: CardProps) {
  const classes = ["card", interactive ? "card--interactive" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} {...props}>
      {title || description || actions ? (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {description ? <p className="card__description">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
