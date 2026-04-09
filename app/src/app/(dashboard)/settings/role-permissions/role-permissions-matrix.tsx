"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  PERMISSIONS,
  EDITABLE_ROLES,
  ROLE_LABELS,
  DEFAULT_PERMISSIONS,
  type RolePermissions,
  type PermissionKey,
} from "@/lib/permissions"
import { Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react"

type Props = {
  isOwner: boolean
}

export function RolePermissionsMatrix({ isOwner }: Props) {
  const [permissions, setPermissions] = useState<RolePermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/role-permissions")
      if (!res.ok) throw new Error("Ошибка загрузки")
      const data = await res.json()
      setPermissions(data.permissions)
      setError(null)
    } catch {
      setError("Не удалось загрузить настройки прав")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = (role: string, key: PermissionKey) => {
    if (!permissions || role === "owner" || !isOwner) return
    setPermissions((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [role]: {
          ...prev[role],
          [key]: !prev[role][key],
        },
      }
    })
    setDirty(true)
    setSuccess(false)
  }

  const save = async () => {
    if (!permissions) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch("/api/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Ошибка сохранения")
      }
      const data = await res.json()
      setPermissions(data.permissions)
      setDirty(false)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const resetToDefaults = () => {
    setPermissions({ ...DEFAULT_PERMISSIONS })
    setDirty(true)
    setSuccess(false)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!permissions) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
          {error || "Нет данных"}
        </CardContent>
      </Card>
    )
  }

  // Группируем разрешения
  const groups: { name: string; perms: typeof PERMISSIONS[number][] }[] = []
  const groupMap = new Map<string, typeof PERMISSIONS[number][]>()

  for (const p of PERMISSIONS) {
    if (!groupMap.has(p.group)) {
      groupMap.set(p.group, [])
    }
    groupMap.get(p.group)!.push(p)
  }

  for (const [name, perms] of groupMap) {
    groups.push({ name, perms })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {dirty && (
            <Badge variant="secondary" className="text-xs">
              Есть несохранённые изменения
            </Badge>
          )}
          {success && (
            <Badge className="bg-green-100 text-green-800 text-xs">
              Сохранено
            </Badge>
          )}
          {error && (
            <Badge variant="destructive" className="text-xs">
              {error}
            </Badge>
          )}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetToDefaults}
              disabled={saving}
            >
              <RotateCcw className="mr-1.5 size-4" />
              По умолчанию
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              Сохранить
            </Button>
          </div>
        )}
      </div>

      {/* Matrix */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium min-w-[250px]">
                    Разрешение
                  </th>
                  <th className="p-3 text-center font-medium min-w-[100px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <ShieldCheck className="size-4 text-primary" />
                      <span>{ROLE_LABELS.owner}</span>
                    </div>
                  </th>
                  {EDITABLE_ROLES.map((role) => (
                    <th key={role} className="p-3 text-center font-medium min-w-[100px]">
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <>
                    <tr key={`group-${group.name}`} className="bg-muted/30">
                      <td
                        colSpan={2 + EDITABLE_ROLES.length}
                        className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {group.name}
                      </td>
                    </tr>
                    {group.perms.map((perm) => (
                      <tr
                        key={perm.key}
                        className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="p-3 text-muted-foreground">
                          {perm.label}
                        </td>
                        {/* Owner — всегда включено */}
                        <td className="p-3 text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={true}
                              disabled
                              className="data-[state=checked]:bg-primary/50"
                            />
                          </div>
                        </td>
                        {/* Editable roles */}
                        {EDITABLE_ROLES.map((role) => (
                          <td key={role} className="p-3 text-center">
                            <div className="flex justify-center">
                              <Checkbox
                                checked={permissions[role]?.[perm.key] ?? false}
                                onCheckedChange={() => toggle(role, perm.key)}
                                disabled={!isOwner}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!isOwner && (
        <p className="text-sm text-muted-foreground text-center">
          Только владелец организации может изменять права ролей
        </p>
      )}
    </div>
  )
}
