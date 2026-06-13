import { ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import GlobalSearch from "@/components/GlobalSearch";

interface Props {
  children: ReactNode;
}

export default function MainLayout({ children }: Props) {
  const { t } = useTranslation("common");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="app-shell flex h-screen w-screen bg-surface text-text-primary overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-accent-blue focus:text-white focus:font-medium text-sm"
      >
        {t("skipToMainContent")}
      </a>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />
      <main id="main-content" className="app-main flex-1 overflow-y-auto" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
