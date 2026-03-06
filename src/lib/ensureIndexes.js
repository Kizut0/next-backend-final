import { DB_NAME, getDb } from "@/lib/mongodb";

export async function ensureIndexes() {
  const db = await getDb();
  const users = db.collection("users");
  const books = db.collection("books");
  const borrows = db.collection("borrows");

  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    users.createIndex({ email: 1 }, { unique: true }),
    books.createIndex({ isbn: 1 }, { unique: true, sparse: true }),
    books.createIndex({ title: 1 }),
    books.createIndex({ author: 1 }),
    books.createIndex({ isDeleted: 1, title: 1 }),
    borrows.createIndex({ userId: 1, createdAt: -1 }),
    borrows.createIndex({ bookId: 1, status: 1 }),
  ]);

  return {
    database: DB_NAME,
    collections: ["users", "books", "borrows"],
  };
}
