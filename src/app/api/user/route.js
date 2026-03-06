import corsHeaders from "@/lib/cors";
import { sanitizeUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

const ADMIN_EMAILS = new Set(["admin@test.com", "admin@gmail.com"]);

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  const data = await req.json();
  const username = data.username?.trim();
  const email = data.email?.trim().toLowerCase();
  const password = data.password;
  const firstname = data.firstname?.trim() ?? "";
  const lastname = data.lastname?.trim() ?? "";
  const requestedRole = data.role?.trim()?.toUpperCase?.() ?? "";

  if (!username || !email || !password) {
    return NextResponse.json(
      {
        message: "Username, email, and password are required",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  if (requestedRole === "ADMIN" && !ADMIN_EMAILS.has(email)) {
    return NextResponse.json(
      {
        message: "Only admin@test.com and admin@gmail.com can register as ADMIN",
      },
      {
        status: 403,
        headers: corsHeaders,
      },
    );
  }

  try {
    const db = await getDb();
    const users = db.collection("users");
    const existingUser = await users.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      const duplicateField = existingUser.username === username ? "username" : "email";

      return NextResponse.json(
        {
          message: `Duplicate ${duplicateField}`,
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    const role = ADMIN_EMAILS.has(email) ? "ADMIN" : "USER";
    const now = new Date();
    const document = {
      username,
      email,
      password: await bcrypt.hash(password, 10),
      firstname,
      lastname,
      role,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    const result = await users.insertOne(document);

    return NextResponse.json(
      {
        user: sanitizeUser({
          ...document,
          _id: result.insertedId,
        }),
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch (exception) {
    if (exception?.code === 11000) {
      const duplicateField = Object.keys(exception.keyPattern ?? {})[0] ?? "field";

      return NextResponse.json(
        {
          message: `Duplicate ${duplicateField}`,
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    return NextResponse.json(
      {
        message: "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
