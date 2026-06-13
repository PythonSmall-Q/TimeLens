import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { AnnouncerContext } from "./AnnouncerContext";

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const queuedRef = useRef<string | null>(null);

  const announce = useCallback((msg: string) => {
    // Clear first so screen readers treat repeated identical messages as new announcements.
    queuedRef.current = msg;
    setMessage("");
  }, []);

  useEffect(() => {
    if (queuedRef.current === null) return;
    const msg = queuedRef.current;
    queuedRef.current = null;
    const id = requestAnimationFrame(() => setMessage(msg));
    return () => cancelAnimationFrame(id);
  }, [message]);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}
