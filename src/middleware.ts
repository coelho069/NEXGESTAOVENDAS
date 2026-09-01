import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // session refresh handled by updateSession
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const isProtected = request.nextUrl.pathname.startsWith("/pdv");

  if (!user && isProtected) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    return NextResponse.redirect(redirect);
  }

  if (user && isAuthRoute) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/pdv";
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
