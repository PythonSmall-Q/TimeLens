import {
  LayoutDashboard,
  Layers,
  Settings,
  Bell,
  Tag,
  Target,
  Focus,
  Globe,
  Code2,
} from "lucide-react";

export const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, labelKey: "dashboard:title" },
  { to: "/widgets", icon: Layers, labelKey: "widgets:widgetCenter" },
  { to: "/limits", icon: Bell, labelKey: "limits:title" },
  { to: "/browser", icon: Globe, labelKey: "browserUsage:title" },
  { to: "/vscode", icon: Code2, labelKey: "dashboard:vscodeInsights" },
  { to: "/categories", icon: Tag, labelKey: "categories:title" },
  { to: "/goals", icon: Target, labelKey: "goals:title" },
  { to: "/focus", icon: Focus, labelKey: "focus:title" },
  { to: "/settings", icon: Settings, labelKey: "settings:title" },
] as const;
