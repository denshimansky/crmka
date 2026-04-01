import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/login",
  },
})

export const config = {
  matcher: [
    "/((?!login|admin|portal|api/auth|api/admin|api/portal|_next/static|_next/image|favicon.ico).*)",
  ],
}
