import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "nixma_customer_auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected =
    pathname.startsWith("/customer") && pathname !== "/customer/login";

  if (!isProtected) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/customer/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/customer/:path*"],
};
