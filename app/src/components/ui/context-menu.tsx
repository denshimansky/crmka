"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"

// Нативный base-ui ContextMenu — сам ловит правый клик / long-press и корректно
// работает с подменю. Стили синхронизированы с DropdownMenu.

export function ContextMenu({
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props}>{children}</ContextMenuPrimitive.Root>
}

// Совместимый API с моей старой обёрткой: asChild раскрывает render-prop base-ui.
// Дети элемента-обёртки переезжают в children триггера.
export function ContextMenuTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode
  asChild?: boolean
}) {
  if (asChild && React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: React.ReactNode }>
    const inner = element.props.children
    const elementWithoutChildren = React.cloneElement(element, { children: undefined })
    return (
      <ContextMenuPrimitive.Trigger render={elementWithoutChildren}>
        {inner}
      </ContextMenuPrimitive.Trigger>
    )
  }
  return <ContextMenuPrimitive.Trigger>{children}</ContextMenuPrimitive.Trigger>
}

export function ContextMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={4}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 min-w-[180px] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>) {
  return <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger>) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={0}
        alignOffset={-3}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          className={cn(
            "z-50 w-auto min-w-[160px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 outline-none data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}
