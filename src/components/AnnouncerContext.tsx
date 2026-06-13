import { createContext } from "react";

interface AnnouncerContextValue {
  announce: (message: string) => void;
}

export const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);
