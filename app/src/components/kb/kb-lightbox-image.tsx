"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

// Картинка статьи базы знаний с просмотром в полном размере по клику.
// Клиентский компонент — используется из серверного <KbArticleBody> (читалка
// /knowledge и предпросмотр /admin/.../preview, оба рендерят один и тот же body).
// Оверлей на примитивах base-ui: фокус-трап, Esc и блокировка скролла — из коробки.
// Закрытие: клик по фону (Backdrop вокруг картинки), крестик или Esc.
export function KbLightboxImage({ src, alt }: { src: string; alt: string }) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger
        render={<button type="button" />}
        className="mx-auto block w-fit max-w-full cursor-zoom-in"
        aria-label={alt ? `Открыть изображение в полном размере: ${alt}` : "Открыть изображение в полном размере"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-w-full rounded-lg border transition hover:opacity-90" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/80 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[95dvh] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <DialogPrimitive.Title className="sr-only">Просмотр изображения</DialogPrimitive.Title>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="block max-h-[95dvh] max-w-[95vw] rounded-lg object-contain shadow-2xl"
          />
          <DialogPrimitive.Close
            render={<button type="button" />}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-2 text-white transition hover:bg-black/70"
          >
            <XIcon className="size-5" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
