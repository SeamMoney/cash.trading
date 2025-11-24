import type React from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // <CHANGE> Changed from bg-accent to bg-border/20 to match app's border colors
      className={cn("bg-border/20 animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
