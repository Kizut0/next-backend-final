// REFERENCE: This file is provided as a user registration example.
// Students must implement authentication and role-based logic as required in the exam.
import corsHeaders from "@/lib/cors";
import { getClientPromise } from "@/lib/mongodb";
import { NextResponse } from "next/server";

export async function OPTIONS(req) {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function GET (req) {

  try {
    const client = await getClientPromise();
    const db = client.db("<your-database>");
    const email = user.email;
    const profile = await db.collection("<user-collection>").findOne({ email });
    return NextResponse.json(profile, {
      headers: corsHeaders
    })
  }
  catch(error) {
    return NextResponse.json(error.toString(), {
      headers: corsHeaders
    })
  }
}