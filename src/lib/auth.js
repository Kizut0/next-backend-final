import corsHeaders from "@/lib/cors";
import { getDb } from "@/lib/mongodb";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET || "mydefaultjwtsecret";

export function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    firstname: user.firstname ?? "",
    lastname: user.lastname ?? "",
    role: user.role,
    status: user.status,
  };
}

export function getTokenFromRequest(req) {
  return req.cookies.get("token")?.value ?? null;
}

export function verifyToken(token) {
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  const payload = verifyToken(token);

  if (!payload?.id || !ObjectId.isValid(payload.id)) {
    return null;
  }

  const db = await getDb();
  const user = await db.collection("users").findOne({
    _id: new ObjectId(payload.id),
    status: "ACTIVE",
  });

  return sanitizeUser(user);
}

function errorResponse(message, status) {
  return NextResponse.json(
    { message },
    {
      status,
      headers: corsHeaders,
    },
  );
}

export async function requireAuth(req) {
  const user = await getUserFromRequest(req);

  if (!user) {
    return {
      ok: false,
      response: errorResponse("Unauthorized", 401),
    };
  }

  return {
    ok: true,
    user,
  };
}

export async function requireRole(req, roles = []) {
  const auth = await requireAuth(req);

  if (!auth.ok) {
    return auth;
  }

  if (roles.length > 0 && !roles.includes(auth.user.role)) {
    return {
      ok: false,
      response: errorResponse("Forbidden", 403),
    };
  }

  return auth;
}
