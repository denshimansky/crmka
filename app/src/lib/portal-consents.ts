import type { PortalConsentType } from "@prisma/client"

// Единый словарь согласий гейта ЛК родителя: тип → колонка Organization с URL
// документа, подписи для настроек и гейта, обязательность. Порядок массива =
// порядок пунктов в гейте и в форме настроек.

export type PortalDocsOrg = {
  portalOfferUrl: string | null
  portalPrivacyPolicyUrl: string | null
  portalPdnParentConsentUrl: string | null
  portalPdnChildConsentUrl: string | null
  portalPdnDistributionConsentUrl: string | null
  portalMarketingConsentUrl: string | null
}

export type PortalConsentMeta = {
  type: PortalConsentType
  orgField: keyof PortalDocsOrg
  required: boolean
  /** Подпись поля в настройках организации */
  settingsLabel: string
  /** Текст пункта в гейте: prefix + [link] + suffix */
  gatePrefix: string
  gateLink: string
  gateSuffix?: string
}

export const PORTAL_CONSENTS: PortalConsentMeta[] = [
  {
    type: "offer",
    orgField: "portalOfferUrl",
    required: true,
    settingsLabel: "Оферта / договор на оказание услуг",
    gatePrefix: "Принимаю ",
    gateLink: "условия оферты",
  },
  {
    type: "privacy_policy",
    orgField: "portalPrivacyPolicyUrl",
    required: true,
    settingsLabel: "Политика конфиденциальности (обработки ПДн)",
    gatePrefix: "Ознакомлен(а) с ",
    gateLink: "политикой конфиденциальности",
  },
  {
    type: "pdn_parent",
    orgField: "portalPdnParentConsentUrl",
    required: true,
    settingsLabel: "Согласие на обработку ПДн родителя",
    gatePrefix: "Даю ",
    gateLink: "согласие на обработку моих персональных данных",
  },
  {
    type: "pdn_child",
    orgField: "portalPdnChildConsentUrl",
    required: true,
    settingsLabel: "Согласие на обработку ПДн ребёнка",
    gatePrefix: "Даю ",
    gateLink: "согласие на обработку персональных данных ребёнка",
    gateSuffix: " — как законный представитель",
  },
  {
    type: "pdn_distribution",
    orgField: "portalPdnDistributionConsentUrl",
    required: false,
    settingsLabel: "Согласие на распространение ПДн (фото/имя, ст. 10.1)",
    gatePrefix: "Согласен(на) на ",
    gateLink: "размещение фото и имени ребёнка",
  },
  {
    type: "marketing",
    orgField: "portalMarketingConsentUrl",
    required: false,
    settingsLabel: "Согласие на рекламные рассылки",
    gatePrefix: "Согласен(на) на ",
    gateLink: "рекламные рассылки",
  },
]

export function docUrlFor(org: PortalDocsOrg, type: PortalConsentType): string | null {
  const meta = PORTAL_CONSENTS.find((c) => c.type === type)
  return meta ? org[meta.orgField] : null
}

/** Обязательные типы, применимые к организации: URL документа заполнен. */
export function requiredConsentTypesFor(org: PortalDocsOrg): PortalConsentType[] {
  return PORTAL_CONSENTS.filter((c) => c.required && org[c.orgField]).map((c) => c.type)
}

/** Все 4 обязательных документа заполнены (условие выдачи учёток родителям). */
export function hasRequiredDocs(org: PortalDocsOrg): boolean {
  return PORTAL_CONSENTS.filter((c) => c.required).every((c) => org[c.orgField])
}

/**
 * Фактически обязательные типы для гейта: обязательные с заполненным URL.
 * Если партнёр не заполнил ни одного обязательного документа (учётка выдана
 * раньше, документы потом убрали) — fallback: простое согласие на обработку
 * ПДн без ссылки, чтобы не пускать родителя вовсе без согласия.
 */
export function effectiveRequiredTypes(org: PortalDocsOrg): PortalConsentType[] {
  const filled = requiredConsentTypesFor(org)
  return filled.length > 0 ? filled : ["pdn_parent"]
}

export const PORTAL_DOC_FIELDS = PORTAL_CONSENTS.map((c) => c.orgField)
