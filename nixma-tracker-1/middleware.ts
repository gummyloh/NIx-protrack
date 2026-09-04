import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "nixma_customer_auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /customer/access/<token> is how a customer arrives WITHOUT a cookie yet
  // -- it's the page that exchanges the token for one, same role as
  // /customer/login exchanging a PIN for one. Both have to be reachable
  // before a cookie exists, or nobody could ever log in this way.
  const isProtected =
    pathname.startsWith("/customer") &&
    pathname !== "/customer/login" &&
    !pathname.startsWith("/customer/access/");

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
