import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useStatsStore } from "@/stores/statsStore";
import TodayOverview from "./TodayOverview";
import AppRankingChart from "./AppRankingChart";
import HourlyTimeline from "./HourlyTimeline";
import AppList from "./AppList";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayString, daysAgo } from "@/utils/format";

export default function Dashboard() {
  const { t } = useTranslation(["common", "dashboard"]);
  const { selectedDate, setSelectedDate, fetchToday, loading } = useStatsStore();

  useEffect(() => {
    fetchToday();
  }, []);

  const isToday = selectedDate === todayString();

  const goBack = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const goForward = () => {
    if (isToday) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const displayDate = isToday
    ? t("common:today")
    : selectedDate === daysAgo(1)
    ? t("common:yesterday")
    : selectedDate;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:title")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("dashboard:screenTime")}</p>
        </div>
        {/* Date navigator */}
        <div className="flex items-center gap-2 bg-surface-card rounded-xl px-3 py-1.5 border border-surface-border">
          <button
            onClick={goBack}
            className="text-text-secondary hover:text-text-primary transition-colors p-0.5"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm text-text-primary font-medium w-24 text-center">
            {displayDate}
          </span>
          <button
            onClick={goForward}
            disabled={isToday}
            className="text-text-secondary hover:text-text-primary transition-colors p-0.5
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-4 text-text-muted text-sm">{t("common:loading")}</div>
      )}

      {/* Overview cards */}
      <TodayOverview />

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <AppRankingChart />
        <HourlyTimeline />
      </div>

      {/* Full list */}
      <AppList />
    </div>
  );
}
