import * as React from "react";

import { cn } from "@/lib/utils";

const ChartContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-h-[240px] w-full items-center justify-center text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);
ChartContainer.displayName = "ChartContainer";

export { ChartContainer };
