import { randomInt } from "crypto"
import bcrypt from "bcryptjs"

// Алфавит без неоднозначных символов (нет 0/o, 1/l/i) — пароль удобно
// диктовать по телефону и набирать с мобильного.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"

// Формат xxxx-xxxx, ~40 бит энтропии — достаточно при rate-limit входа.
export function generatePortalPassword(): string {
  const block = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  return `${block()}-${block()}`
}

export function hashPortalPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export function verifyPortalPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
