function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function layout(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title)
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <tr><td>
      <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:24px;">Умная CRM</div>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 16px;">
      <p style="font-size:12px;color:#777;margin:0;">Если вы не запрашивали это письмо — просто проигнорируйте его.</p>
    </td></tr>
  </table>
</body>
</html>`
}

export function passwordResetEmail(resetUrl: string, employeeName?: string): { subject: string; html: string; text: string } {
  const greeting = employeeName ? `Здравствуйте, ${escapeHtml(employeeName)}!` : "Здравствуйте!"
  const safeUrl = escapeHtml(resetUrl)

  const html = layout("Восстановление пароля", `
    <h2 style="font-size:18px;margin:0 0 12px;color:#111;">${greeting}</h2>
    <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 20px;">Вы запросили восстановление пароля для входа в Умную CRM. Нажмите на кнопку ниже, чтобы задать новый пароль:</p>
    <p style="margin:0 0 20px;">
      <a href="${safeUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Восстановить пароль</a>
    </p>
    <p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 8px;">Если кнопка не работает, скопируйте ссылку в браузер:</p>
    <p style="font-size:12px;color:#666;word-break:break-all;margin:0 0 16px;"><a href="${safeUrl}" style="color:#7c3aed;">${safeUrl}</a></p>
    <p style="font-size:13px;color:#888;margin:0;">Ссылка действует <strong>1 час</strong>. После использования она перестанет работать.</p>
  `)

  const text = `${greeting}

Вы запросили восстановление пароля для входа в Умную CRM.
Перейдите по ссылке, чтобы задать новый пароль:

${resetUrl}

Ссылка действует 1 час.
Если вы не запрашивали это письмо — просто проигнорируйте его.`

  return { subject: "Восстановление пароля — Умная CRM", html, text }
}
