import nodemailer, { type Transporter } from "nodemailer"

let transporter: Transporter | null = null
let initialized = false

function getTransporter(): Transporter | null {
  if (initialized) return transporter
  initialized = true

  const host = process.env.SMTP_HOST
  const portRaw = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn("[mailer] SMTP не настроен (SMTP_HOST/SMTP_USER/SMTP_PASS). Письма отправляться не будут — линки логируются в консоль.")
    return null
  }

  const port = portRaw ? parseInt(portRaw, 10) : 465
  const secure = port === 465

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: host !== "localhost" && host !== "127.0.0.1",
    },
  })

  console.log(`[mailer] SMTP сконфигурирован: ${host}:${port} (secure=${secure})`)
  return transporter
}

export interface MailPayload {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function sendMail(payload: MailPayload): Promise<boolean> {
  const t = getTransporter()
  if (!t) {
    console.log(`[mailer skipped] to=${payload.to} subject=${payload.subject}`)
    return false
  }

  const from = process.env.MAIL_FROM || "Умная CRM <noreply@umnayacrm.ru>"

  try {
    const info = await t.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: payload.replyTo,
    })
    console.log(`[mailer] sent to=${payload.to} messageId=${info.messageId}`)
    return true
  } catch (err) {
    console.error(`[mailer] send failed to=${payload.to}:`, (err as Error).message)
    return false
  }
}
