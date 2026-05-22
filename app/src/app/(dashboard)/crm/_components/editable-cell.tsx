"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

type Endpoint = { url: string; field: string }

export type SelectOption = { value: string; label: string }

type CommonProps = {
  endpoint: Endpoint
  /** Дополнительные поля, которые отправляются PATCH вместе с основным значением. */
  extraBody?: Record<string, unknown>
  className?: string
  placeholder?: string
  disabled?: boolean
}

export function EditableDateCell({
  initialValue,
  endpoint,
  extraBody,
  className,
  placeholder = "—",
  disabled,
}: CommonProps & { initialValue: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue ?? "")
  const [saving, setSaving] = useState(false)
  const initialRef = useRef(initialValue ?? "")

  useEffect(() => {
    initialRef.current = initialValue ?? ""
    setValue(initialValue ?? "")
  }, [initialValue])

  async function commit(newValue: string) {
    if (newValue === initialRef.current) return
    setSaving(true)
    try {
      const res = await fetch(endpoint.url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extraBody, [endpoint.field]: newValue || null }),
      })
      if (res.ok) {
        initialRef.current = newValue
        router.refresh()
      } else {
        setValue(initialRef.current)
      }
    } catch {
      setValue(initialRef.current)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      disabled={disabled || saving}
      className={className ?? "h-8 text-xs w-[140px]"}
      placeholder={placeholder}
    />
  )
}

export function EditableTextCell({
  initialValue,
  endpoint,
  extraBody,
  className,
  placeholder = "Комментарий",
  disabled,
  rows = 2,
}: CommonProps & { initialValue: string | null; rows?: number }) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue ?? "")
  const [saving, setSaving] = useState(false)
  const initialRef = useRef(initialValue ?? "")

  useEffect(() => {
    initialRef.current = initialValue ?? ""
    setValue(initialValue ?? "")
  }, [initialValue])

  async function commit(newValue: string) {
    const trimmed = newValue.trim()
    if (trimmed === initialRef.current.trim()) return
    setSaving(true)
    try {
      const res = await fetch(endpoint.url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extraBody, [endpoint.field]: trimmed || null }),
      })
      if (res.ok) {
        initialRef.current = trimmed
        router.refresh()
      } else {
        setValue(initialRef.current)
      }
    } catch {
      setValue(initialRef.current)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      disabled={disabled || saving}
      rows={rows}
      placeholder={placeholder}
      className={className ?? "text-xs min-h-[36px] w-[200px] resize-none"}
    />
  )
}

export function EditableSelectCell({
  initialValue,
  options,
  endpoint,
  extraBody,
  className,
  placeholder = "—",
  disabled,
}: CommonProps & {
  initialValue: string | null
  options: SelectOption[]
}) {
  const router = useRouter()
  const [value, setValue] = useState<string>(initialValue ?? "")
  const [saving, setSaving] = useState(false)
  const initialRef = useRef<string>(initialValue ?? "")

  useEffect(() => {
    initialRef.current = initialValue ?? ""
    setValue(initialValue ?? "")
  }, [initialValue])

  async function commit(newValue: string) {
    if (newValue === initialRef.current) return
    setValue(newValue)
    setSaving(true)
    try {
      const res = await fetch(endpoint.url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extraBody, [endpoint.field]: newValue || null }),
      })
      if (res.ok) {
        initialRef.current = newValue
        router.refresh()
      } else {
        setValue(initialRef.current)
      }
    } catch {
      setValue(initialRef.current)
    } finally {
      setSaving(false)
    }
  }

  const selected = options.find((o) => o.value === value)

  return (
    <Select value={value} onValueChange={commit} disabled={disabled || saving}>
      <SelectTrigger className={className ?? "h-8 w-full max-w-[180px] text-xs"}>
        {selected ? selected.label : <span className="text-muted-foreground">{placeholder}</span>}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">— {placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
