// StatCard — a single KPI tile (label, big value, optional hint / icon / trend). Drop several in a grid
// for a dashboard summary row. Built on the shadcn Card so it inherits the active skin.
import * as React from "react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Small caption under the value, e.g. "vs. last week". */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Signed delta styling for the hint: positive = green, negative = red, neutral = muted. */
  trend?: "up" | "down" | "neutral";
  className?: string;
}

const trendClass: Record<NonNullable<StatCardProps["trend"]>, string> = {
  up: "text-chart-3",
  down: "text-destructive",
  neutral: "text-muted-foreground",
};

export function StatCard({ label, value, hint, icon, trend = "neutral", className }: StatCardProps) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
          {hint && <span className={cn("text-xs", trendClass[trend])}>{hint}</span>}
        </div>
        {icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
