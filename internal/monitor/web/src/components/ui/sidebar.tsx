import * as React from "react";

import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = "17rem";

const SidebarProvider = ({
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    style={
      {
        "--sidebar-width": SIDEBAR_WIDTH,
        ...style
      } as React.CSSProperties
    }
    className={cn("group/sidebar-wrapper flex h-full min-h-0 w-full", className)}
    {...props}
  >
    {children}
  </div>
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <aside
      ref={ref}
      className={cn(
        "h-full min-h-0 w-[var(--sidebar-width)] shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "hidden flex-col md:flex",
        className
      )}
      {...props}
    />
  )
);
Sidebar.displayName = "Sidebar";

const SidebarInset = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}
      {...props}
    />
  )
);
SidebarInset.displayName = "SidebarInset";

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex min-h-16 shrink-0 items-center gap-3 px-4", className)} {...props} />
  )
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-3", className)}
      {...props}
    />
  )
);
SidebarContent.displayName = "SidebarContent";

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("shrink-0 border-t border-sidebar-border p-3", className)} {...props} />
  )
);
SidebarFooter.displayName = "SidebarFooter";

const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-1", className)} {...props} />
  )
);
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("px-2 py-1 text-xs font-medium text-sidebar-foreground/60", className)}
      {...props}
    />
  )
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarMenu = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn("grid gap-1", className)} {...props} />
  )
);
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn("min-w-0", className)} {...props} />
  )
);
SidebarMenuItem.displayName = "SidebarMenuItem";

type SidebarMenuButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive?: boolean;
};

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, isActive, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left text-sm outline-none",
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50",
        isActive &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-sm",
        className
      )}
      data-active={isActive}
      {...props}
    />
  )
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
};
