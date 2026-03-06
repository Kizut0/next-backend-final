import { requireAuth, requireRole } from "@/lib/auth";
import corsHeaders from "@/lib/cors";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

function serializeBook(book) {
  return {
    id: book._id.toString(),
    title: book.title,
    author: book.author,
    isbn: book.isbn ?? "",
    category: book.category ?? "",
    publishedYear: book.publishedYear ?? null,
    location: book.location ?? "",
    quantity: book.totalCopies,
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
    status: book.status,
    isDeleted: Boolean(book.isDeleted),
    deletedAt: book.deletedAt ?? null,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

function getObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function invalidIdResponse() {
  return NextResponse.json(
    {
      message: "Invalid book id",
    },
    {
      status: 400,
      headers: corsHeaders,
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function GET(req, { params }) {
  const auth = await requireAuth(req);

  if (!auth.ok) {
    return auth.response;
  }

  const bookId = getObjectId((await params).id);

  if (!bookId) {
    return invalidIdResponse();
  }

  const db = await getDb();
  const book = await db.collection("books").findOne({ _id: bookId });

  if (!book || (book.isDeleted && auth.user.role !== "ADMIN")) {
    return NextResponse.json(
      {
        message: "Book not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  return NextResponse.json(
    {
      book: serializeBook(book),
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}

export async function PATCH(req, { params }) {
  const auth = await requireRole(req, ["ADMIN"]);

  if (!auth.ok) {
    return auth.response;
  }

  const bookId = getObjectId((await params).id);

  if (!bookId) {
    return invalidIdResponse();
  }

  const data = await req.json();
  const db = await getDb();
  const books = db.collection("books");
  const book = await books.findOne({ _id: bookId });

  if (!book) {
    return NextResponse.json(
      {
        message: "Book not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  const update = {};

  if (Object.hasOwn(data, "title")) {
    const title = data.title?.trim();

    if (!title) {
      return NextResponse.json(
        { message: "Title is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    update.title = title;
  }

  if (Object.hasOwn(data, "author")) {
    const author = data.author?.trim();

    if (!author) {
      return NextResponse.json(
        { message: "Author is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    update.author = author;
  }

  if (Object.hasOwn(data, "isbn")) {
    const isbn = data.isbn?.trim();

    if (!isbn) {
      return NextResponse.json(
        { message: "ISBN is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    update.isbn = isbn;
  }

  if (Object.hasOwn(data, "category")) {
    update.category = data.category?.trim() ?? "";
  }

  if (Object.hasOwn(data, "location")) {
    update.location = data.location?.trim() ?? "";
  }

  if (Object.hasOwn(data, "publishedYear")) {
    if (data.publishedYear === "" || data.publishedYear === null) {
      update.publishedYear = null;
    } else {
      const publishedYear = Number.parseInt(data.publishedYear, 10);

      if (!Number.isInteger(publishedYear)) {
        return NextResponse.json(
          { message: "Published year must be an integer" },
          { status: 400, headers: corsHeaders },
        );
      }

      update.publishedYear = publishedYear;
    }
  }

  const borrowedCount = Math.max(book.totalCopies - book.availableCopies, 0);
  let nextTotalCopies = book.totalCopies;
  let nextAvailableCopies = book.availableCopies;

  if (Object.hasOwn(data, "quantity") || Object.hasOwn(data, "totalCopies")) {
    const quantityInput = Object.hasOwn(data, "quantity") ? data.quantity : data.totalCopies;
    const totalCopies = Number.parseInt(quantityInput, 10);

    if (!Number.isInteger(totalCopies) || totalCopies < 0) {
      return NextResponse.json(
        { message: "Quantity must be a non-negative integer" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (totalCopies < borrowedCount) {
      return NextResponse.json(
        { message: "Quantity cannot be lower than current borrowed count" },
        { status: 400, headers: corsHeaders },
      );
    }

    nextTotalCopies = totalCopies;
    nextAvailableCopies = totalCopies - borrowedCount;
    update.totalCopies = nextTotalCopies;
    update.availableCopies = nextAvailableCopies;
  }

  let nextStatus = book.status;

  if (Object.hasOwn(data, "status")) {
    if (!["AVAILABLE", "UNAVAILABLE"].includes(data.status)) {
      return NextResponse.json(
        { message: "Status must be AVAILABLE or UNAVAILABLE" },
        { status: 400, headers: corsHeaders },
      );
    }

    nextStatus = data.status;
  }

  if (nextAvailableCopies === 0) {
    nextStatus = "UNAVAILABLE";
  } else if (!Object.hasOwn(data, "status")) {
    nextStatus = "AVAILABLE";
  } else if (nextStatus === "AVAILABLE" && nextAvailableCopies === 0) {
    return NextResponse.json(
      { message: "Books with zero available copies cannot be AVAILABLE" },
      { status: 400, headers: corsHeaders },
    );
  }

  update.status = nextStatus;
  update.updatedAt = new Date();

  try {
    await books.updateOne(
      { _id: bookId },
      {
        $set: update,
      },
    );

    const updatedBook = await books.findOne({ _id: bookId });

    return NextResponse.json(
      {
        book: serializeBook(updatedBook),
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { message: "Duplicate isbn" },
        { status: 409, headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function DELETE(req, { params }) {
  const auth = await requireRole(req, ["ADMIN"]);

  if (!auth.ok) {
    return auth.response;
  }

  const bookId = getObjectId((await params).id);

  if (!bookId) {
    return invalidIdResponse();
  }

  const db = await getDb();
  const activeBorrow = await db.collection("borrows").findOne({
    bookId,
    status: { $in: ["INIT", "ACCEPTED", "BORROWED"] },
  });

  if (activeBorrow) {
    return NextResponse.json(
      {
        message: "Cannot delete a book with active requests",
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  const result = await db.collection("books").updateOne(
    { _id: bookId, isDeleted: { $ne: true } },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );

  if (!result.matchedCount) {
    return NextResponse.json(
      {
        message: "Book not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  return NextResponse.json(
    {
      message: "Book deleted",
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}
