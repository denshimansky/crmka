import { Fragment } from "react"
import { renderInline } from "@/components/markdown-guide"
import { KbVideo } from "@/components/kb/kb-video"

// Рендер статьи базы знаний из блоков. Серверный компонент; блок-видео —
// клиентский <KbVideo>. Безопасно: текст рендерится React-узлами (renderInline),
// без dangerouslySetInnerHTML; видео — только через нормализованный embed.

export interface KbArticleBlock {
  id: string
  type: "heading" | "text" | "image" | "video"
  text: string | null
  level: number | null
  mediaUrl: string | null
  caption: string | null
}

function TextBlock({ text, keyBase }: { text: string; keyBase: string }) {
  // Пустая строка (\n\n) разделяет абзацы; одиночный перенос строки (Enter)
  // сохраняется как <br> внутри абзаца — иначе строки склеивались в сплошной
  // текст, т.к. <p> схлопывает одиночные \n в пробел (баг #87).
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={`${keyBase}-${i}`} className="my-3 text-sm leading-relaxed">
          {p.split("\n").map((line, li) => (
            <Fragment key={`${keyBase}-${i}-${li}`}>
              {li > 0 && <br />}
              {renderInline(line, `${keyBase}-${i}-${li}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  )
}

export function KbArticleBody({ blocks }: { blocks: KbArticleBlock[] }) {
  return (
    <div className="max-w-none">
      {blocks.map((b) => {
        switch (b.type) {
          case "heading":
            return b.level === 3 ? (
              <h3 key={b.id} className="mb-2 mt-6 text-base font-semibold">
                {renderInline(b.text || "", `h-${b.id}`)}
              </h3>
            ) : (
              <h2 key={b.id} className="mb-3 mt-8 border-b pb-2 text-xl font-bold">
                {renderInline(b.text || "", `h-${b.id}`)}
              </h2>
            )
          case "text":
            return <TextBlock key={b.id} text={b.text || ""} keyBase={`t-${b.id}`} />
          case "image":
            return b.mediaUrl ? (
              <figure key={b.id} className="my-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.mediaUrl}
                  alt={b.caption || ""}
                  className="mx-auto max-w-full rounded-lg border"
                />
                {b.caption && (
                  <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">
                    {b.caption}
                  </figcaption>
                )}
              </figure>
            ) : null
          case "video":
            return b.mediaUrl ? <KbVideo key={b.id} url={b.mediaUrl} caption={b.caption} /> : null
          default:
            return null
        }
      })}
    </div>
  )
}
