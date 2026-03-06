import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";

const options = {};
let globalClientPromise;
let databaseReadyPromise;

export const DB_NAME = "libary_management_system";

const REQUIRED_USERS = [
  {
    email: "admin@test.com",
    password: "admin123",
    role: "ADMIN",
    username: "admin_test",
    firstname: "Admin",
    lastname: "Tester",
  },
  {
    email: "user@test.com",
    password: "user123",
    role: "USER",
    username: "user_test",
    firstname: "User",
    lastname: "Tester",
  },
];

async function resolveSeedUsername(users, preferredUsername) {
  let nextUsername = preferredUsername;
  let counter = 1;

  while (await users.findOne({ username: nextUsername })) {
    nextUsername = `${preferredUsername}_${counter}`;
    counter += 1;
  }

  return nextUsername;
}

async function ensureSeedUser(users, seedUser) {
  const now = new Date();
  const password = await bcrypt.hash(seedUser.password, 10);
  const existingUser = await users.findOne({ email: seedUser.email });

  if (existingUser) {
    await users.updateOne(
      { _id: existingUser._id },
      {
        $set: {
          password,
          role: seedUser.role,
          status: "ACTIVE",
          firstname: existingUser.firstname || seedUser.firstname,
          lastname: existingUser.lastname || seedUser.lastname,
          updatedAt: now,
        },
      },
    );
    return;
  }

  const username = await resolveSeedUsername(users, seedUser.username);

  await users.insertOne({
    username,
    email: seedUser.email,
    password,
    firstname: seedUser.firstname,
    lastname: seedUser.lastname,
    role: seedUser.role,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function ensureDatabaseReady(client) {
  const db = client.db(DB_NAME);
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

  for (const seedUser of REQUIRED_USERS) {
    await ensureSeedUser(users, seedUser);
  }
}

export function getClientPromise() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("Please add your Mongo URI to .env.local or set MONGODB_URI env variable");
  }

  if (process.env.NODE_ENV === "development") {
    if (!globalClientPromise) {
      const client = new MongoClient(uri, options);
      globalClientPromise = client.connect();
    }

    return globalClientPromise;
  }

  const client = new MongoClient(uri, options);
  return client.connect();
}

export async function getDb() {
  const client = await getClientPromise();

  if (!databaseReadyPromise) {
    databaseReadyPromise = ensureDatabaseReady(client).catch((error) => {
      databaseReadyPromise = undefined;
      throw error;
    });
  }

  await databaseReadyPromise;
  return client.db(DB_NAME);
}
