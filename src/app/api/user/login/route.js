import corsHeaders from "@/lib/cors";
import { sanitizeUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET || "mydefaultjwtsecret";

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  const data = await req.json();
  const email = data.email?.trim().toLowerCase();
  const password = data.password;

  if (!email || !password) {
    return NextResponse.json(
      {
        message: "Missing email or password",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email });

    if (!user) {
      return NextResponse.json(
        {
          message: "Invalid email or password",
        },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    if (user.status !== "ACTIVE") {
      return NextResponse.json(
        {
          message: "User account is inactive",
        },
        {
          status: 403,
          headers: corsHeaders,
        },
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return NextResponse.json(
        {
          message: "Invalid email or password",
        },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    const response = NextResponse.json(
      {
        message: "Login successful",
        user: sanitizeUser(user),
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );

    response.cookies.set("token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (exception) {
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
