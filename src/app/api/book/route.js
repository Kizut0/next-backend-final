import { requireAuth, requireRole } from "@/lib/auth";
import corsHeaders from "@/lib/cors";
import { getDb } from "@/lib/mongodb";
import { NextResponse } from "next/server";

function serializeBook(book) {
  return {
    id: book._id.toString(),
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category ?? "",
    publishedYear: book.publishedYear ?? null,
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
    status: book.status,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

function parseBookPayload(data, { isCreate = false } = {}) {
  const payload = {};
  const title = data.title?.trim();
  const author = data.author?.trim();
  const isbn = data.isbn?.trim();
  const category = data.category?.trim();

  if (isCreate || Object.hasOwn(data, "title")) {
    if (!title) {
      return { error: "Title is required" };
    }

    payload.title = title;
  }

  if (isCreate || Object.hasOwn(data, "author")) {
    if (!author) {
      return { error: "Author is required" };
    }

    payload.author = author;
  }

  if (isCreate || Object.hasOwn(data, "isbn")) {
    if (!isbn) {
      return { error: "ISBN is required" };
    }

    payload.isbn = isbn;
  }

  if (Object.hasOwn(data, "category")) {
    payload.category = category ?? "";
  } else if (isCreate) {
    payload.category = "";
  }

  if (Object.hasOwn(data, "publishedYear")) {
    if (data.publishedYear === "" || data.publishedYear === null) {
      payload.publishedYear = null;
    } else {
      const publishedYear = Number.parseInt(data.publishedYear, 10);

      if (!Number.isInteger(publishedYear)) {
        return { error: "Published year must be an integer" };
      }

      payload.publishedYear = publishedYear;
    }
  } else if (isCreate) {
    payload.publishedYear = null;
  }

  if (isCreate || Object.hasOwn(data, "totalCopies")) {
    const totalCopies = Number.parseInt(data.totalCopies, 10);

    if (!Number.isInteger(totalCopies) || totalCopies < 0) {
      return { error: "Total copies must be a non-negative integer" };
    }

    payload.totalCopies = totalCopies;
  }

  return { payload };
}

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

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category")?.trim();
  const filter = {};
  const options = {};

  if (q) {
    filter.$text = { $search: q };
    options.projection = {
      score: { $meta: "textScore" },
    };
  }

  if (category) {
    filter.category = category;
  }

  const db = await getDb();
  const cursor = db.collection("books").find(filter, options);

  if (q) {
    cursor.sort({
      score: { $meta: "textScore" },
      createdAt: -1,
    });
  } else {
    cursor.sort({ title: 1, createdAt: -1 });
  }

  const books = await cursor.toArray();

  return NextResponse.json(
    {
      books: books.map(serializeBook),
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}

export async function POST(req) {
  const auth = await requireRole(req, ["ADMIN"]);

  if (!auth.ok) {
    return auth.response;
  }

  const data = await req.json();
  const { payload, error } = parseBookPayload(data, { isCreate: true });

  if (error) {
    return NextResponse.json(
      { message: error },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const now = new Date();
  const document = {
    ...payload,
    availableCopies: payload.totalCopies,
    status: payload.totalCopies > 0 ? "AVAILABLE" : "UNAVAILABLE",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const db = await getDb();
    const result = await db.collection("books").insertOne(document);

    return NextResponse.json(
      {
        book: serializeBook({
          ...document,
          _id: result.insertedId,
        }),
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        {
          message: "Duplicate isbn",
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
