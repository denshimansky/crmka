import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/login",
  },
})

export const config = {
  matcher: [
    "/((?!login|admin|api/auth|api/admin|_next/static|_next/image|favicon.ico).*)",
  ],
}
