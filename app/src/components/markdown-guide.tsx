import * as React from "react"

/**
 * Лёгкий рендер подмножества Markdown, которое использует руководство
 * docs/getting-started-guide.md: заголовки #..####, **жирный**, *курсив*,
 * `код`, маркированные и нумерованные списки (с одним уровнем вложенности),
 * таблицы, чек-листы «- [ ]», горизонтальные разделители «---» и
 * callout-абзацы, начинающиеся с «⚠️».
 *
 * Намеренно не подключаем react-markdown — рендер чистый, без зависимостей,
 * и бандлится в серверный компонент.
 */

// Сентинел для экранированной звёздочки «\*» (например, поля «Название \*»).
const ESC = String.fromCharCode(1)

function unesc(s: string): string {
  return s.split(ESC).join("*")
}

/** Инлайн-форматирование внутри одной строки. */
function renderInline(raw: string, kp: string): React.ReactNode[] {
  const text = raw.replace(/\\\*/g, ESC)
  const nodes: React.ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(unesc(text.slice(last, m.index)))
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${kp}-b${i}`}>{unesc(m[1])}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(
        <code
          key={`${kp}-c${i}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {unesc(m[2])}
        </code>,
      )
    } else if (m[3] !== undefined) {
      nodes.push(<em key={`${kp}-i${i}`}>{unesc(m[3])}</em>)
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(unesc(text.slice(last)))
  return nodes
}

/** Текст заголовка без разметки — для оглавления. */
function stripFmt(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\\\*/g, "*").trim()
}

const isHr = (l: string) => /^---+\s*$/.test(l.trim())
const isTable = (l: string) => l.trimStart().startsWith("|")
const isChecklist = (l: string) => /^\s*-\s+\[[ xX]\]\s+/.test(l)
const isBullet = (l: string) => /^\s*-\s+/.test(l) && !isChecklist(l)
const isOrdered = (l: string) => /^\s*\d+\.\s+/.test(l)

function renderTable(rows: string[], key: number): React.ReactNode {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())

  const parsed = rows.map(cells)
  const sepIdx = parsed.findIndex(
    (r) => r.length > 0 && r.every((c) => /^:?-+:?$/.test(c)),
  )
  const header = sepIdx > 0 ? parsed[sepIdx - 1] : null
  const body = parsed.filter(
    (_, idx) => idx !== sepIdx && !(sepIdx > 0 && idx === sepIdx - 1),
  )

  return (
    <div key={key} className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {header && (
          <thead>
            <tr className="border-b bg-muted/50">
              {header.map((c, ci) => (
                <th
                  key={ci}
                  className="px-3 py-2 text-left align-bottom font-semibold"
                >
                  {renderInline(c, `th${key}-${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className="px-3 py-2 align-top">
                  {renderInline(c, `td${key}-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderBulletList(rawLines: string[], key: number): React.ReactNode {
  // Один уровень вложенности по отступу (>= 2 пробела = подпункт).
  type Node = { text: string; children: string[] }
  const items: Node[] = []
  for (const l of rawLines) {
    const indent = l.length - l.trimStart().length
    const text = l.replace(/^\s*-\s+/, "")
    if (indent >= 2 && items.length > 0) {
      items[items.length - 1].children.push(text)
    } else {
      items.push({ text, children: [] })
    }
  }
  return (
    <ul key={key} className="my-3 ml-1 space-y-1.5">
      {items.map((it, idx) => (
        <li key={idx} className="text-sm leading-relaxed">
          <span className="mr-2 text-muted-foreground">•</span>
          {renderInline(it.text, `bl${key}-${idx}`)}
          {it.children.length > 0 && (
            <ul className="ml-5 mt-1.5 space-y-1">
              {it.children.map((c, ci) => (
                <li key={ci} className="text-sm leading-relaxed">
                  <span className="mr-2 text-muted-foreground">◦</span>
                  {renderInline(c, `bl${key}-${idx}-${ci}`)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function renderOrderedList(rawLines: string[], key: number): React.ReactNode {
  type Node = { text: string; children: string[] }
  const items: Node[] = []
  for (const l of rawLines) {
    if (isOrdered(l)) {
      items.push({ text: l.replace(/^\s*\d+\.\s+/, ""), children: [] })
    } else if (items.length > 0) {
      // вложенный «- » подпункт под текущим номером
      items[items.length - 1].children.push(l.replace(/^\s*-\s+/, ""))
    }
  }
  return (
    <ol key={key} className="my-3 ml-5 list-decimal space-y-1.5">
      {items.map((it, idx) => (
        <li key={idx} className="pl-1 text-sm leading-relaxed">
          {renderInline(it.text, `ol${key}-${idx}`)}
          {it.children.length > 0 && (
            <ul className="ml-1 mt-1.5 list-none space-y-1">
              {it.children.map((c, ci) => (
                <li key={ci} className="text-sm leading-relaxed">
                  <span className="mr-2 text-muted-foreground">◦</span>
                  {renderInline(c, `ol${key}-${idx}-${ci}`)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function renderChecklist(rawLines: string[], key: number): React.ReactNode {
  const items = rawLines.map((l) => {
    const m = l.match(/^\s*-\s+\[([ xX])\]\s+(.*)$/)!
    return { checked: m[1].toLowerCase() === "x", text: m[2] }
  })
  return (
    <ul key={key} className="my-3 space-y-1.5">
      {items.map((it, idx) => (
        <li key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-muted-foreground/40 text-[10px]">
            {it.checked ? "✓" : ""}
          </span>
          <span>{renderInline(it.text, `cl${key}-${idx}`)}</span>
        </li>
      ))}
    </ul>
  )
}

export function MarkdownGuide({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: React.ReactNode[] = []
  const toc: { id: string; title: string }[] = []
  let i = 0
  let key = 0
  let h2 = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === "") {
      i++
      continue
    }

    if (isHr(line)) {
      blocks.push(<hr key={key++} className="my-7 border-border" />)
      i++
      continue
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const txt = h[2].trim()
      if (level === 1) {
        blocks.push(
          <h1
            key={key++}
            className="mb-4 mt-2 text-2xl font-bold tracking-tight"
          >
            {renderInline(txt, `h${key}`)}
          </h1>,
        )
      } else if (level === 2) {
        const id = `section-${h2++}`
        toc.push({ id, title: stripFmt(txt) })
        blocks.push(
          <h2
            key={key++}
            id={id}
            className="mb-3 mt-9 scroll-mt-20 border-b pb-2 text-xl font-bold"
          >
            {renderInline(txt, `h${key}`)}
          </h2>,
        )
      } else if (level === 3) {
        blocks.push(
          <h3 key={key++} className="mb-2 mt-6 text-base font-semibold">
            {renderInline(txt, `h${key}`)}
          </h3>,
        )
      } else {
        blocks.push(
          <h4
            key={key++}
            className="mb-1 mt-4 text-sm font-semibold text-muted-foreground"
          >
            {renderInline(txt, `h${key}`)}
          </h4>,
        )
      }
      i++
      continue
    }

    if (isTable(line)) {
      const tbl: string[] = []
      while (i < lines.length && isTable(lines[i])) {
        tbl.push(lines[i])
        i++
      }
      blocks.push(renderTable(tbl, key++))
      continue
    }

    if (isChecklist(line)) {
      const raw: string[] = []
      while (i < lines.length && isChecklist(lines[i])) {
        raw.push(lines[i])
        i++
      }
      blocks.push(renderChecklist(raw, key++))
      continue
    }

    if (isBullet(line)) {
      const raw: string[] = []
      while (i < lines.length && isBullet(lines[i])) {
        raw.push(lines[i])
        i++
      }
      blocks.push(renderBulletList(raw, key++))
      continue
    }

    if (isOrdered(line)) {
      const raw: string[] = []
      while (
        i < lines.length &&
        (isOrdered(lines[i]) || /^\s{2,}-\s+/.test(lines[i]))
      ) {
        raw.push(lines[i])
        i++
      }
      blocks.push(renderOrderedList(raw, key++))
      continue
    }

    // одиночная строка — абзац или callout
    if (line.trimStart().startsWith("⚠️")) {
      blocks.push(
        <div
          key={key++}
          className="my-3 rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-2 text-sm leading-relaxed dark:bg-amber-950/20"
        >
          {renderInline(line.trim(), `p${key}`)}
        </div>,
      )
    } else {
      blocks.push(
        <p key={key++} className="my-3 text-sm leading-relaxed">
          {renderInline(line, `p${key}`)}
        </p>,
      )
    }
    i++
  }

  return (
    <div>
      {toc.length > 0 && (
        <nav className="mb-8 rounded-lg border bg-muted/30 p-4">
          <p className="mb-3 text-sm font-semibold">Содержание</p>
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {toc.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="text-sm text-muted-foreground hover:text-primary hover:underline"
                >
                  {t.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="max-w-none">{blocks}</div>
    </div>
  )
}
