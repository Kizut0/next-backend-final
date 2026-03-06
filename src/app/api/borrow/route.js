import { requireAuth } from "@/lib/auth";
import corsHeaders from "@/lib/cors";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

function serializeBorrow(borrow) {
  return {
    id: borrow._id.toString(),
    userId: borrow.userId.toString(),
    bookId: borrow.bookId.toString(),
    borrowDate: borrow.borrowDate,
    dueDate: borrow.dueDate,
    returnDate: borrow.returnDate,
    status: borrow.status,
    createdAt: borrow.createdAt,
    updatedAt: borrow.updatedAt,
    book: borrow.book
      ? {
          id: borrow.book._id?.toString?.() ?? borrow.book.id ?? null,
          title: borrow.book.title,
          author: borrow.book.author,
          isbn: borrow.book.isbn,
          category: borrow.book.category ?? "",
        }
      : null,
    user: borrow.user
      ? {
          id: borrow.user._id?.toString?.() ?? borrow.user.id ?? null,
          username: borrow.user.username,
          firstname: borrow.user.firstname ?? "",
          lastname: borrow.user.lastname ?? "",
          email: borrow.user.email,
          role: borrow.user.role,
        }
      : null,
  };
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

  const db = await getDb();
  const match = auth.user.role === "ADMIN" ? {} : { userId: new ObjectId(auth.user.id) };
  const borrows = await db
    .collection("borrows")
    .aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "books",
          localField: "bookId",
          foreignField: "_id",
          as: "book",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$book",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
    ])
    .toArray();

  return NextResponse.json(
    {
      borrows: borrows.map(serializeBorrow),
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}

export async function POST(req) {
  const auth = await requireAuth(req);

  if (!auth.ok) {
    return auth.response;
  }

  const data = await req.json();
  const bookId = data.bookId;

  if (!bookId || !ObjectId.isValid(bookId)) {
    return NextResponse.json(
      {
        message: "Valid bookId is required",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const db = await getDb();
  const books = db.collection("books");
  const borrows = db.collection("borrows");
  const bookObjectId = new ObjectId(bookId);
  const userObjectId = new ObjectId(auth.user.id);
  const existingBorrow = await borrows.findOne({
    userId: userObjectId,
    bookId: bookObjectId,
    status: "BORROWED",
  });

  if (existingBorrow) {
    return NextResponse.json(
      {
        message: "You already borrowed this book",
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  const book = await books.findOne({ _id: bookObjectId });

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

  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 14);
  const borrowDocument = {
    userId: userObjectId,
    bookId: bookObjectId,
    borrowDate: now,
    dueDate,
    returnDate: null,
    status: "BORROWED",
    createdAt: now,
    updatedAt: now,
  };

  const updateResult = await books.updateOne(
    {
      _id: bookObjectId,
      availableCopies: { $gt: 0 },
    },
    [
      {
        $set: {
          availableCopies: { $subtract: ["$availableCopies", 1] },
          updatedAt: now,
        },
      },
      {
        $set: {
          status: {
            $cond: [{ $lte: ["$availableCopies", 0] }, "UNAVAILABLE", "AVAILABLE"],
          },
        },
      },
    ],
  );

  if (!updateResult.modifiedCount) {
    return NextResponse.json(
      {
        message: "Book is unavailable",
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  try {
    const result = await borrows.insertOne(borrowDocument);
    const updatedBook = await books.findOne({ _id: bookObjectId });

    return NextResponse.json(
      {
        borrow: serializeBorrow({
          ...borrowDocument,
          _id: result.insertedId,
          book: updatedBook,
          user: {
            _id: userObjectId,
            username: auth.user.username,
            firstname: auth.user.firstname,
            lastname: auth.user.lastname,
            email: auth.user.email,
            role: auth.user.role,
          },
        }),
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    await books.updateOne(
      { _id: bookObjectId },
      [
        {
          $set: {
            availableCopies: { $add: ["$availableCopies", 1] },
            updatedAt: new Date(),
          },
        },
        {
          $set: {
            status: {
              $cond: [{ $gt: ["$availableCopies", 0] }, "AVAILABLE", "UNAVAILABLE"],
            },
          },
        },
      ],
    );

    return NextResponse.json(
      {
        message: "Unable to create borrow record",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
