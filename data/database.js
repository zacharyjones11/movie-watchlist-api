const { MongoClient } = require('mongodb');

async function connectDatabase(uri, databaseName) {
  if (!uri || !databaseName) {
    throw new Error('MONGODB_URI and MONGODB_DB_NAME are required. Update your local .env or Render environment.');
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.command({ ping: 1 });
    // Create the project collections without requiring sample data.
    for (const name of ['movies', 'reviews', 'users', 'sessions']) {
      try {
        await db.createCollection(name);
      } catch (error) {
        if (error.code !== 48) throw error; // NamespaceExists is safe on restart.
      }
    }
    await db.collection('users').createIndex({ githubId: 1 }, { unique: true });
    await db.collection('reviews').createIndex({ movieId: 1 });
    await db.collection('reviews').createIndex({ userId: 1, movieId: 1 });
    await db.collection('movies').createIndex({ userId: 1 });
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}

module.exports = { connectDatabase };
