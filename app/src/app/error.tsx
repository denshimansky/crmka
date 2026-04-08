"use client"

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">500</h1>
      <p className="mt-2 text-muted-foreground">Что-то пошло не так</p>
      <button
        onClick={() => reset()}
        className="mt-4 text-primary underline"
      >
        Попробовать снова
      </button>
    </div>
  )
}
