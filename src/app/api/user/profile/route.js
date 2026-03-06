import { requireAuth } from "@/lib/auth";
import corsHeaders from "@/lib/cors";
import { NextResponse } from "next/server";

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function GET(req) {
  const auth = await requireAuth(req);

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    {
      user: auth.user,
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}
