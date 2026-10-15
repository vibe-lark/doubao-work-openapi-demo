// EmptyState — the "there's nothing here yet" surface: centered icon + title + optional description and
// action. Use it for empty lists, no-results-after-filter, and blank tabs (never a bare empty div).
import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Usually a lucide icon element, e.g. <Inbox className="size-6" />. */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Optional CTA, e.g. a <Button>. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
