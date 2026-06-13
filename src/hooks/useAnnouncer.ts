import { useContext } from "react";
import { AnnouncerContext } from "@/components/AnnouncerContext";

export function useAnnouncer(): (message: string) => void {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) {
    throw new Error("useAnnouncer must be used within an AnnouncerProvider");
  }
  return ctx.announce;
}
