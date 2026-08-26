import { useTranslation } from "react-i18next";

export default function Loading() {
  const { t } = useTranslation("common");
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-surface-border border-t-accent-blue"
        aria-label={t("loading")}
      />
    </div>
  );
}
