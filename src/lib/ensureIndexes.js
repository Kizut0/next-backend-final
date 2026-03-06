
// REFERENCE: This file is provided as an example for creating indexes.
// Students must add a similar index for the Book collection as required in the exam.
import { getClientPromise } from "@/lib/mongodb";

export async function ensureIndexes() {
  const client = await getClientPromise();
  const db = client.db("<your-database>");
  const userCollection = db.collection("<user-collection>");
  await userCollection.createIndex({ username: 1 }, { unique: true });
  await userCollection.createIndex({ email: 1 }, { unique: true });
}