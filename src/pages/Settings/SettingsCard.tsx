import clsx from "clsx";

export interface SettingsCardProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  contentClassName?: string;
}

export default function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
  onClick,
  className,
  contentClassName,
}: SettingsCardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={clsx(
        "glass-card settings-card p-4 space-y-4",
        onClick &&
          "cursor-pointer border border-surface-border hover:border-accent-blue/40 hover:bg-accent-blue/10 transition-colors text-left",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="p-2 rounded-lg bg-accent-blue/10 text-accent-blue shrink-0">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary truncate">{title}</h3>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
      </div>
      {children !== undefined && (
        <div className={clsx("space-y-3", contentClassName)}>
          {children}
        </div>
      )}
      {footer}
    </div>
  );
}
