"use client"

import { rutubeEmbedUrl } from "@/lib/kb-video"

// Встраиваемый плеер RuTube. Хранится ссылка/ID, рендерим адаптивный iframe —
// без dangerouslySetInnerHTML.
export function KbVideo({ url, caption }: { url: string; caption?: string | null }) {
  const embed = rutubeEmbedUrl(url)
  if (!embed) return null
  return (
    <figure className="my-5">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
        <iframe
          src={embed}
          className="absolute inset-0 h-full w-full"
          allow="clipboard-write; autoplay; fullscreen"
          allowFullScreen
          title={caption || "Видео"}
        />
      </div>
      {caption && (
        <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  )
}
