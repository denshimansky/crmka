"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Save, Copy, Check, AlertTriangle } from "lucide-react"
import { PORTAL_CONSENTS, type PortalDocsOrg } from "@/lib/portal-consents"

// Блок «Личный кабинет родителя» в настройках организации: адрес кабинета
// (слаг), 6 ссылок на юридические документы и контакты филиалов для связи.

type BranchContacts = {
  id: string
  name: string
  contactPhone: string | null
  contactWhatsapp: string | null
  contactTelegram: string | null
  contactMax: string | null
}

interface Props {
  portalSlug: string | null
  docs: PortalDocsOrg
  branches: BranchContacts[]
  isOwner: boolean
  baseUrl: string
}

const BRANCH_CONTACT_FIELDS = [
  { key: "contactPhone", label: "Телефон администратора", type: "tel", placeholder: "+7 900 000-00-00" },
  { key: "contactWhatsapp", label: "WhatsApp", type: "url", placeholder: "https://wa.me/79000000000" },
  { key: "contactTelegram", label: "Telegram", type: "url", placeholder: "https://t.me/center" },
  { key: "contactMax", label: "MAX", type: "url", placeholder: "https://max.ru/…" },
] as const

export function ParentPortalSettingsForm({ portalSlug, docs, branches, isOwner, baseUrl }: Props) {
  const router = useRouter()
  const [slug, setSlug] = useState(portalSlug || "")
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(PORTAL_CONSENTS.map((c) => [c.orgField, docs[c.orgField] || ""]))
  )
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const portalUrl = slug ? `${baseUrl}/p/${slug}` : null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const body: Record<string, string> = { ...urls }
      if (isOwner && slug && slug !== (portalSlug || "")) body.portalSlug = slug
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Ошибка сохранения")
      }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  function copyPortalUrl() {
    if (!portalUrl) return
    navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const requiredMissing = PORTAL_CONSENTS.filter((c) => c.required && !urls[c.orgField])

  return (
    <Card className="max-w-2xl">
      <CardContent className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Личный кабинет родителя</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Родители входят в кабинет по ссылке вашего центра с логином (телефон) и паролем,
          которые выдаёт сотрудник из карточки клиента.
        </p>

        {/* Адрес кабинета */}
        <div className="space-y-2">
          <Label>Адрес кабинета</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{baseUrl}/p/</span>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase())
                setSuccess(false)
              }}
              disabled={!isOwner}
              className="max-w-48 font-mono"
              placeholder="moy-centr"
            />
            {portalUrl && (
              <Button variant="outline" size="icon" onClick={copyPortalUrl} title="Копировать ссылку">
                {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
              </Button>
            )}
          </div>
          {isOwner ? (
            <p className="text-xs text-muted-foreground">
              Смена адреса сломает уже разосланные родителям ссылки — меняйте только при необходимости.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Адрес кабинета может менять только владелец.</p>
          )}
        </div>

        {/* Документы */}
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold">Юридические документы (ссылки)</h3>
          <p className="text-sm text-muted-foreground">
            Разместите PDF-документы на своём сайте или диске и вставьте ссылки. Родитель принимает
            их при первом входе в кабинет.
          </p>
          {PORTAL_CONSENTS.map((c) => (
            <div key={c.type} className="space-y-1">
              <Label className="text-sm">
                {c.settingsLabel}
                {c.required ? <span className="text-destructive"> *</span> : (
                  <span className="text-muted-foreground"> (необязательно)</span>
                )}
              </Label>
              <Input
                type="url"
                value={urls[c.orgField] || ""}
                onChange={(e) => {
                  setUrls((prev) => ({ ...prev, [c.orgField]: e.target.value.trim() }))
                  setSuccess(false)
                }}
                placeholder="https://…"
              />
            </div>
          ))}
          {requiredMissing.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-600">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Документы со звёздочкой обязательны — пока они не заполнены, выдать родителям доступ
              в кабинет нельзя.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving} size="sm">
            <Save className="mr-1.5 size-4" />
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
          {success && <span className="text-sm text-green-600">Сохранено</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>

        {/* Контакты филиалов */}
        <div className="mt-8 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Контакты для связи — по филиалам</h3>
            <p className="text-sm text-muted-foreground">
              Показываются родителю в кабинете по филиалу, где занимается его ребёнок.
            </p>
          </div>
          {branches.length === 0 && (
            <p className="text-sm text-muted-foreground">Филиалы ещё не созданы.</p>
          )}
          {branches.map((branch) => (
            <BranchContactsForm key={branch.id} branch={branch} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BranchContactsForm({ branch }: { branch: BranchContacts }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({
    contactPhone: branch.contactPhone || "",
    contactWhatsapp: branch.contactWhatsapp || "",
    contactTelegram: branch.contactTelegram || "",
    contactMax: branch.contactMax || "",
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/branches/${branch.id}/portal-contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Ошибка сохранения")
      }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 text-sm font-medium">{branch.name}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {BRANCH_CONTACT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{field.label}</Label>
            <Input
              type={field.type}
              value={values[field.key]}
              onChange={(e) => {
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                setSuccess(false)
              }}
              placeholder={field.placeholder}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm" variant="outline">
          <Save className="mr-1.5 size-4" />
          {saving ? "Сохранение..." : "Сохранить контакты"}
        </Button>
        {success && <span className="text-sm text-green-600">Сохранено</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  )
}
