import { useEffect, useMemo } from "react";
import { WidgetClient } from "@/widgets/sdk";

interface UseWidgetClientOptions {
  widgetId: string;
  widgetType: string;
}

/**
 * Returns a memoized WidgetClient for first-party widgets.
 * The client is disposed automatically when the component unmounts.
 */
export function useWidgetClient({ widgetId, widgetType }: UseWidgetClientOptions): WidgetClient {
  const client = useMemo(
    () => new WidgetClient({ widgetId, widgetType }),
    [widgetId, widgetType],
  );

  useEffect(() => {
    return () => {
      client.dispose();
    };
  }, [client]);

  return client;
}
