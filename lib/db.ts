import mongoose from "mongoose";

import { env, isProduction } from "./env";

// Registering every model once, here, is load-bearing rather than tidy: a `ref`
// resolves by NAME at populate time, and the name exists only once the file
// declaring it has been imported. See models/index.ts for the full reasoning.
import "@/models";

/**
 * The MongoDB connection, cached across warm serverless invocations.
 *
 * WHY THIS FILE EXISTS AT ALL. Route handlers run in short-lived serverless
 * invocations. `mongoose.connect()` per invocation opens a new pool per
 * invocation, and an Atlas M0 cluster has a hard connection ceiling — the
 * failure mode is not slowness, it is refused connections under exactly the
 * load a live demo produces.
 *
 * WHY THE PROMISE IS CACHED, NOT JUST THE CONNECTION. Two concurrent cold
 * starts both find `conn === null`. If only the connection were cached, both
 * would call connect() and open two pools. Caching the in-flight promise means
 * the second caller awaits the first caller's connect.
 *
 * WHY `globalThis`. In development Next.js clears the module registry on every
 * hot reload, so a module-scoped variable is reset while the open sockets are
 * not — the classic "too many connections after ten saves" leak. `globalThis`
 * survives the reload.
 */

/**
 * A query filtering on a field that is not in the schema THROWS, rather than
 * mongoose's default of running it as given.
 *
 * The failure this prevents is quiet and expensive: a typo like
 * `{ ownr: staffId }` matches nothing, so the staff queue renders an empty list
 * that looks like "no enquiries" rather than "your filter is misspelt". Set
 * globally rather than per-connection because it governs query casting, not the
 * connection.
 */
mongoose.set("strictQuery", "throw");

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // `var` is required here and cannot be let/const: only `var` declares a property
  // on the global object, which is exactly what this needs to do.
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = (global._mongooseCache ??= {
  conn: null,
  promise: null,
});

export async function db(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,

      // M0 is connection-limited, and a serverless invocation is single-request:
      // it has no use for a large pool. Five leaves headroom for concurrent warm
      // functions on the same cluster.
      maxPoolSize: 5,

      // Fail in 8s rather than the 30s default. A reviewer who pulls the
      // database out from under this app should see an explicit error inside the
      // request, not a request that appears to hang.
      serverSelectionTimeoutMS: 8_000,

      // Commands are NOT buffered while disconnected. The default silently
      // queues a query and resolves it if a connection appears, which turns an
      // unavailable database into an unexplained delay. With buffering off, an
      // unreachable database throws immediately and the handler can return an
      // explicit error code — the behaviour "no silent data loss" requires.
      bufferCommands: false,

      // OFF EVERYWHERE, not just in production. Index creation is a deliberate,
      // observable step: `npm run db:indexes`. Leaving it on in development
      // would let dev and production disagree about which indexes exist, and
      // the first place that surfaces is a slow query on the deployed app.
      autoIndex: false,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // CRITICAL: clear the rejected promise. A cached rejection would be
    // re-awaited by every subsequent request, so one failed connect at cold
    // start would keep the app broken until the instance recycled — even after
    // the database came back. Clearing it means the next request retries.
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

/**
 * Close the connection. Used by scripts and tests, which are processes that
 * must actually exit; never called from a route handler, where closing the
 * shared pool would break concurrent requests on the same warm instance.
 */
export async function disconnectDb(): Promise<void> {
  if (!cached.conn) return;

  await mongoose.disconnect();
  cached.conn = null;
  cached.promise = null;
}

/**
 * Connection state, for a health endpoint or a diagnostic. Mirrors mongoose's
 * readyState numbers so the caller never has to know them.
 */
export function dbState(): "disconnected" | "connected" | "connecting" | "disconnecting" {
  return (
    (
      {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      } as const
    )[mongoose.connection.readyState as 0 | 1 | 2 | 3] ?? "disconnected"
  );
}

// Connection-level logging. Deliberately minimal and value-free: the URI holds
// credentials, so it is never logged, in any environment.
if (!isProduction) {
  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });
}
