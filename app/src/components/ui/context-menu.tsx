"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"

// Контекстное меню (ПКМ). База — base-ui Menu, но триггер по contextmenu
// и виртуальный якорь в координатах курсора. Стили синхронизированы
// с DropdownMenu, чтобы визуально совпадало.

interface ContextMenuContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  anchor: { getBoundingClientRect: () => DOMRect } | null
  openAt: (x: number, y: number) => void
}

const Ctx = React.createContext<ContextMenuContextValue | null>(null)

function useCtx() {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("ContextMenu components must be inside <ContextMenu>")
  return v
}

export function ContextMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = React.useState(false)
  const [anchor, setAnchor] = React.useState<ContextMenuContextValue["anchor"]>(null)
  // После открытия base-ui ловит следующий mouseup/mousedown как outside-press
  // и сразу закрывает меню. Заглушаем первые ~250мс попыток закрытия после
  // программного открытия. Эту же защёлку используем при правом клике по другой
  // строке (контекстное меню должно «перепрыгнуть» без короткого закрытия).
  const justOpenedAt = React.useRef(0)

  const setOpen = React.useCallback((v: boolean) => {
    if (!v && Date.now() - justOpenedAt.current < 250) return
    setOpenState(v)
  }, [])

  const openAt = React.useCallback((x: number, y: number) => {
    setAnchor({
      getBoundingClientRect: () => ({
        x, y, top: y, left: x, right: x, bottom: y,
        width: 0, height: 0,
        toJSON: () => ({}),
      } as DOMRect),
    })
    justOpenedAt.current = Date.now()
    // Открываем на следующий тик, чтобы текущий contextmenu-цикл (включая
    // последующий mouseup) полностью завершился до того, как base-ui навесит
    // слушатели outside-press.
    setTimeout(() => setOpenState(true), 0)
  }, [])

  return (
    <Ctx.Provider value={{ open, setOpen, anchor, openAt }}>
      {/* modal=true — обязательно для контекстного меню с подменю: иначе
          base-ui интерпретирует наведение на SubmenuTrigger как выход за
          пределы родительского popup и закрывает всё меню. */}
      <MenuPrimitive.Root open={open} onOpenChange={setOpen} modal>
        {children}
      </MenuPrimitive.Root>
    </Ctx.Provider>
  )
}

// Оборачивает любой элемент-строку и ловит правый клик. Сам элемент рендерится
// через render-prop, чтобы не плодить лишний div вокруг <tr>.
export function ContextMenuTrigger({
  children,
  asChild,
}: {
  children: React.ReactElement
  asChild?: boolean
}) {
  const { openAt } = useCtx()
  const original = (children.props as { onContextMenu?: (e: React.MouseEvent) => void }).onContextMenu
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openAt(e.clientX, e.clientY)
    original?.(e)
  }
  if (asChild) {
    return React.cloneElement(children, { onContextMenu } as React.HTMLAttributes<HTMLElement>)
  }
  return <span onContextMenu={onContextMenu}>{children}</span>
}

export function ContextMenuContent({
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props) {
  const { anchor } = useCtx()
  if (!anchor) return null
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={4}
      >
        <MenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 min-w-[180px] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
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

export function ContextMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

export function ContextMenuSubContent({
  className,
  ...props
}: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        side="right"
        align="start"
        sideOffset={0}
        alignOffset={-3}
      >
        <MenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          className={cn(
            "z-50 w-auto min-w-[160px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 outline-none data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}
