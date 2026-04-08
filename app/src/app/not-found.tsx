import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">Страница не найдена</p>
      <Link href="/" className="mt-4 text-primary underline">
        На главную
      </Link>
    </div>
  )
}
