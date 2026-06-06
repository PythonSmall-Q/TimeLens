import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import clsx from "clsx";

type AsyncStateVariant = "loading" | "empty" | "error";

interface AsyncStateCardProps {
  variant: AsyncStateVariant;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}

export default function AsyncStateCard({
  variant,
  title,
  hint,
  action,
  compact = false,
}: AsyncStateCardProps) {
  const Icon = variant === "loading" ? Loader2 : variant === "error" ? AlertTriangle : Inbox;

  return (
    <div
      className={clsx(
        "glass-card text-center",
        compact ? "p-6" : "p-8",
      )}
    >
      <div className="mx-auto mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-hover/70">
        <Icon
          size={18}
          className={clsx(
            variant === "loading" && "animate-spin text-accent-blue",
            variant === "error" && "text-accent-red",
            variant === "empty" && "text-text-muted",
          )}
        />
      </div>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
      {action && <div className="mt-3 flex items-center justify-center">{action}</div>}
    </div>
  );
}
