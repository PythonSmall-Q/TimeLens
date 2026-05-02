import { ReactNode, useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import GlobalSearch from "@/components/GlobalSearch";

interface Props {
  children: ReactNode;
}

export default function MainLayout({ children }: Props) {
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
    <div className="flex h-screen w-screen bg-surface text-text-primary overflow-hidden">
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
