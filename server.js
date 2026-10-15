require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { connectDatabase } = require('./data/database');

async function start() {
  const port = Number(process.env.PORT || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const { client, db } = await connectDatabase(process.env.MONGODB_URI, process.env.MONGODB_DB_NAME);
  const server = createApp(db).listen(port, '0.0.0.0', () => {
    console.log(`Movie Watchlist API listening on port ${port}. Docs: /api-docs`);
  });
  server.on('error', async () => {
    console.error('Server could not listen on the configured port.');
    await client.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(async () => {
        await client.close();
        process.exitCode = 0;
      });
    });
  }
}

start().catch((error) => {
  // Configuration messages are safe; database errors can contain credentials.
  const message = error.message.startsWith('MONGODB_URI and MONGODB_DB_NAME') || error.message.startsWith('PORT must')
    ? error.message
    : 'Could not connect to MongoDB. Check the URI, database permissions, and Atlas network access.';
  console.error(message);
  process.exitCode = 1;
});
