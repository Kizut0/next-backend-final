import { requireAuth, requireRole } from "@/lib/auth";
import corsHeaders from "@/lib/cors";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

const REQUEST_STATUSES = new Set([
  "INIT",
  "CLOSE-NO-AVAILABLE-BOOK",
  "ACCEPTED",
  "CANCEL-ADMIN",
  "CANCEL-USER",
  "BORROWED",
]);

function serializeBorrow(borrow) {
  return {
    id: borrow._id.toString(),
    userId: borrow.userId.toString(),
    bookId: borrow.bookId.toString(),
    createdAt: borrow.createdAt ?? borrow.borrowDate ?? null,
    targetDate: borrow.targetDate ?? borrow.dueDate ?? null,
    status: borrow.status,
    updatedAt: borrow.updatedAt,
    book: borrow.book
      ? {
          id: borrow.book._id?.toString?.() ?? borrow.book.id ?? null,
          title: borrow.book.title,
          author: borrow.book.author,
          quantity: borrow.book.totalCopies ?? 0,
          availableCopies: borrow.book.availableCopies ?? 0,
          location: borrow.book.location ?? "",
          status: borrow.book.status ?? "AVAILABLE",
          isDeleted: Boolean(borrow.book.isDeleted),
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

async function getBorrowWithRelations(db, borrowId) {
  const records = await db
    .collection("borrows")
    .aggregate([
      { $match: { _id: borrowId } },
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

  return records[0] ?? null;
}

function validateTargetDate(value) {
  const targetDate = new Date(value);
  return Number.isNaN(targetDate.getTime()) ? null : targetDate;
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
  const auth = await requireRole(req, ["USER"]);

  if (!auth.ok) {
    return auth.response;
  }

  const data = await req.json();
  const bookId = data.bookId;
  const targetDate = validateTargetDate(data.targetDate);

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

  if (!targetDate) {
    return NextResponse.json(
      {
        message: "Valid targetDate is required",
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
    status: { $in: ["INIT", "ACCEPTED", "BORROWED"] },
  });

  if (existingBorrow) {
    return NextResponse.json(
      {
        message: "You already have an active request for this book",
      },
      {
        status: 409,
        headers: corsHeaders,
      },
    );
  }

  const book = await books.findOne({
    _id: bookObjectId,
    isDeleted: { $ne: true },
  });

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
  const requestDocument = {
    userId: userObjectId,
    bookId: bookObjectId,
    createdAt: now,
    targetDate,
    status: book.availableCopies > 0 ? "INIT" : "CLOSE-NO-AVAILABLE-BOOK",
    updatedAt: now,
  };

  try {
    const result = await borrows.insertOne(requestDocument);
    const borrow = await getBorrowWithRelations(db, result.insertedId);

    return NextResponse.json(
      {
        borrow: serializeBorrow(borrow),
      },
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch {
    return NextResponse.json(
      {
        message: "Unable to create borrow request",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}

export async function PATCH(req) {
  const auth = await requireAuth(req);

  if (!auth.ok) {
    return auth.response;
  }

  const data = await req.json();
  const borrowId = data.borrowId;
  const nextStatus = data.status?.trim()?.toUpperCase();

  if (!borrowId || !ObjectId.isValid(borrowId)) {
    return NextResponse.json(
      {
        message: "Valid borrowId is required",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  if (!REQUEST_STATUSES.has(nextStatus)) {
    return NextResponse.json(
      {
        message: "Invalid borrow status",
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const borrowObjectId = new ObjectId(borrowId);
  const db = await getDb();
  const books = db.collection("books");
  const borrows = db.collection("borrows");
  const borrow = await borrows.findOne({ _id: borrowObjectId });

  if (!borrow) {
    return NextResponse.json(
      {
        message: "Borrow request not found",
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  const isAdmin = auth.user.role === "ADMIN";
  const isOwner = borrow.userId.toString() === auth.user.id;
  const now = new Date();

  if (!isAdmin) {
    if (!isOwner || nextStatus !== "CANCEL-USER") {
      return NextResponse.json(
        {
          message: "Forbidden",
        },
        {
          status: 403,
          headers: corsHeaders,
        },
      );
    }

    if (borrow.status !== "INIT") {
      return NextResponse.json(
        {
          message: "Only INIT requests can be cancelled by the user",
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    await borrows.updateOne(
      { _id: borrowObjectId },
      {
        $set: {
          status: "CANCEL-USER",
          updatedAt: now,
        },
      },
    );
  } else if (nextStatus === "ACCEPTED") {
    if (!["INIT", "CLOSE-NO-AVAILABLE-BOOK"].includes(borrow.status)) {
      return NextResponse.json(
        {
          message: "Only pending requests can be accepted",
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    const updateResult = await books.updateOne(
      {
        _id: borrow.bookId,
        isDeleted: { $ne: true },
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
      await borrows.updateOne(
        { _id: borrowObjectId },
        {
          $set: {
            status: "CLOSE-NO-AVAILABLE-BOOK",
            updatedAt: now,
          },
        },
      );
    } else {
      await borrows.updateOne(
        { _id: borrowObjectId },
        {
          $set: {
            status: "ACCEPTED",
            updatedAt: now,
          },
        },
      );
    }
  } else if (nextStatus === "CANCEL-ADMIN") {
    if (!["INIT", "CLOSE-NO-AVAILABLE-BOOK", "ACCEPTED", "BORROWED"].includes(borrow.status)) {
      return NextResponse.json(
        {
          message: "Request cannot be cancelled by admin",
        },
        {
          status: 409,
          headers: corsHeaders,
        },
      );
    }

    if (["ACCEPTED", "BORROWED"].includes(borrow.status)) {
      await books.updateOne(
        {
          _id: borrow.bookId,
          isDeleted: { $ne: true },
        },
        [
          {
            $set: {
              availableCopies: {
                $min: [{ $add: ["$availableCopies", 1] }, "$totalCopies"],
              },
              updatedAt: now,
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
    }

    await borrows.updateOne(
      { _id: borrowObjectId },
      {
        $set: {
          status: "CANCEL-ADMIN",
          updatedAt: now,
        },
      },
    );
  } else {
    return NextResponse.json(
      {
        message: "Only ADMIN can accept or cancel requests",
      },
      {
        status: 403,
        headers: corsHeaders,
      },
    );
  }

  const updatedBorrow = await getBorrowWithRelations(db, borrowObjectId);

  return NextResponse.json(
    {
      borrow: serializeBorrow(updatedBorrow),
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
}
