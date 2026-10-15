import { cn } from "@/lib/utils"

// Shimmer sweep instead of stock opacity pulse — the moving highlight reads as "loading",
// the pulse reads as "broken". Gradient runs muted -> +7% foreground -> muted.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklab,var(--foreground)_7%,var(--muted))_40%,var(--muted)_60%)] bg-[size:320%_100%] animate-[skeleton-shimmer_1.3s_ease-in-out_infinite]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
