"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { PageHelp } from "@/components/page-help"
import { MessageSquare, Phone, Mail, Settings, Copy, Check } from "lucide-react"

interface Integration {
  id: string
  provider: string
  isActive: boolean
  config: Record<string, any>
  webhookSecret: string | null
  createdAt: string
}

const PROVIDERS = [
  {
    id: "wazzup",
    name: "Wazzup",
    description: "WhatsApp-интеграция. Входящие и исходящие сообщения автоматически сохраняются в истории клиента.",
    icon: MessageSquare,
    color: "text-green-600 bg-green-50",
    configFields: [
      { key: "apiKey", label: "API ключ", type: "password" as const },
    ],
  },
  {
    id: "mango",
    name: "Mango Office",
    description: "IP-телефония. Входящие и исходящие звонки, длительность, записи разговоров.",
    icon: Phone,
    color: "text-orange-600 bg-orange-50",
    configFields: [
      { key: "apiKey", label: "API ключ", type: "password" as const },
      { key: "apiSecret", label: "API секрет", type: "password" as const },
    ],
  },
  {
    id: "sms_ru",
    name: "SMS.ru",
    description: "Отправка SMS-уведомлений клиентам: напоминания о занятиях, долги, продления.",
    icon: Mail,
    color: "text-purple-600 bg-purple-50",
    configFields: [
      { key: "apiId", label: "API ID", type: "text" as const },
    ],
  },
]

function getWebhookUrl(provider: string, tenantId: string): string {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
  return `${baseUrl}/api/webhooks/${provider}?tenant=${tenantId}`
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [editProvider, setEditProvider] = useState<string | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  async function loadIntegrations() {
    try {
      const res = await fetch("/api/integrations")
      if (res.ok) setIntegrations(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadIntegrations() }, [])

  function getIntegration(provider: string): Integration | undefined {
    return integrations.find((i) => i.provider === provider)
  }

  function openDialog(providerId: string) {
    const existing = getIntegration(providerId)
    if (existing) {
      setConfigValues(existing.config as Record<string, string>)
    } else {
      setConfigValues({})
    }
    setError(null)
    setEditProvider(providerId)
  }

  async function handleSave() {
    if (!editProvider) return
    setSaving(true)
    setError(null)

    try {
      const existing = getIntegration(editProvider)
      let res: Response

      if (existing) {
        res = await fetch(`/api/integrations/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: configValues }),
        })
      } else {
        res = await fetch("/api/integrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: editProvider, config: configValues }),
        })
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка сохранения")
        return
      }

      setEditProvider(null)
      loadIntegrations()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(integration: Integration) {
    try {
      await fetch(`/api/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !integration.isActive }),
      })
      loadIntegrations()
    } catch { /* ignore */ }
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedUrl(id)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const editProviderConfig = PROVIDERS.find((p) => p.id === editProvider)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Интеграции</h1>
        <PageHelp pageKey="settings/integrations" />
      </div>
      <p className="text-sm text-muted-foreground">
        Подключите внешние сервисы для автоматической записи звонков и сообщений в историю клиентов.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const integration = getIntegration(provider.id)
            const Icon = provider.icon
            const isConnected = !!integration

            return (
              <Card key={provider.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex size-10 items-center justify-center rounded-lg ${provider.color}`}>
                        <Icon className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{provider.name}</CardTitle>
                        <Badge variant={isConnected && integration.isActive ? "default" : "secondary"} className="mt-1">
                          {isConnected ? (integration.isActive ? "Подключен" : "Отключен") : "Не настроен"}
                        </Badge>
                      </div>
                    </div>
                    {isConnected && (
                      <Switch
                        checked={integration.isActive}
                        onCheckedChange={() => toggleActive(integration)}
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{provider.description}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => openDialog(provider.id)}
                  >
                    <Settings className="mr-1 size-3.5" />
                    {isConnected ? "Настроить" : "Подключить"}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Config Dialog */}
      <Dialog open={!!editProvider} onOpenChange={(v) => { if (!v) setEditProvider(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editProviderConfig?.name} — настройки
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {editProviderConfig?.configFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label>{field.label}</Label>
                <Input
                  type={field.type}
                  value={configValues[field.key] || ""}
                  onChange={(e) =>
                    setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.label}
                />
              </div>
            ))}

            {/* Webhook URL */}
            {editProvider && editProvider !== "sms_ru" && (
              <div className="space-y-1.5">
                <Label>Webhook URL</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Укажите этот URL в настройках {editProviderConfig?.name}
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={getWebhookUrl(editProvider, "YOUR_TENANT_ID")}
                    className="text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(
                      getWebhookUrl(editProvider, "YOUR_TENANT_ID"),
                      editProvider
                    )}
                  >
                    {copiedUrl === editProvider ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProvider(null)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
