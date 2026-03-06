
import { MongoClient } from "mongodb";

const options = {};
let globalClientPromise;

export const DB_NAME = "libary_management_system";

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
  return client.db(DB_NAME);
}
