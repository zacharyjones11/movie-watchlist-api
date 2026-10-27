# Movie Watchlist API

CSE 341 Project 2 (lessons 5–8). Save movies, track what you want to watch,
and write reviews. This is a backend API; Swagger UI is the interface used
to try its endpoints.

## Project features

- Node.js and Express, with separate routes and controllers.
- MongoDB database `movie_watchlist`, with `movies` and `reviews` collections.
- GET all, GET by ID, POST, PUT, and DELETE for both collections.
- Strict request validation, JSON errors, and interactive API documentation.
- GitHub OAuth sign-in, persistent server-side sessions, and sign-out.
- User-owned movies and reviews; users cannot access another user's records.
- CSRF protection for POST, PUT, and DELETE requests.
- Render configuration and local/Render REST Client requests.

OAuth credentials are configured outside the source code. The API can start
without GitHub credentials, but `/auth/github` returns 503 until they are set.
Movie and review endpoints require a GitHub session. Existing records created
before ownership was added have no owner and will not appear in signed-in
watchlists; recreate them after signing in or assign their `userId` in Atlas.

## Run locally

Use Node.js 22. From this project folder:

```sh
npm ci
cp .env.example .env
```

If `.env` already exists, keep it. Set `MONGODB_URI` to your existing Atlas
cluster connection string, including your database user's password. Keep
`MONGODB_DB_NAME=movie_watchlist` to select a new database rather than your
previous contacts database. `.env` is ignored by Git; `.env.example` has no
credentials. Your Atlas database user needs access to the new database, and
Atlas Network Access must permit the machine connecting to the cluster. Set
`SESSION_SECRET` to a private random string (for example, run
`openssl rand -base64 48` and paste the result into `.env`).

For local GitHub sign-in, set up the OAuth App below and fill in
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and
`GITHUB_CALLBACK_URL=http://127.0.0.1:8081/auth/github/callback`.

```sh
npm start
```

The server connects to MongoDB before listening and creates both collections
if needed. Default local port: **8081**, which avoids the practice API's 8080.

- API information: <http://localhost:8081/>
- Swagger UI: <http://localhost:8081/api-docs/>
- Database health: <http://localhost:8081/health>
- OpenAPI JSON: <http://localhost:8081/swagger.json>

## Data model

Each movie has eight required input fields (plus server-managed `_id`,
`createdAt`, and `updatedAt`):

| Field | Rules |
| --- | --- |
| `title` | Nonempty string, at most 200 characters |
| `releaseYear` | Integer, 1888–2100 |
| `genre` | Nonempty string, at most 80 characters |
| `director` | Nonempty string, at most 120 characters |
| `runtimeMinutes` | Integer, 1–1440 |
| `contentRating` | G, PG, PG-13, R, NC-17, or NR |
| `synopsis` | Nonempty string, at most 5000 characters |
| `watchStatus` | want-to-watch, watching, or watched |

Each review requires `movieId` (an existing movie's ID), `reviewerName`
(1–100 characters), `rating` (integer 1–10), `reviewText` (1–5000 characters),
`watchedOn` (valid YYYY-MM-DD date), and `containsSpoilers` (boolean).
MongoDB stores the movie reference as an ObjectId and the server timestamps
as dates; responses serialize them as strings. The server adds `userId` to
each movie and review from the authenticated GitHub account. Clients cannot
set or change this field.

## GitHub OAuth setup

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the application homepage to `http://127.0.0.1:8081` for local testing.
   Set the authorization callback URL to exactly
   `http://127.0.0.1:8081/auth/github/callback`.
3. Copy the generated client ID and client secret into the matching entries in
   `.env`. Never commit the secret. The app requests `read:user` and
   `user:email`; the API stores the GitHub ID, username, display name, verified
   primary email when available, and avatar URL.
4. Start the API and visit <http://127.0.0.1:8081/auth/github>. Approve the
   GitHub prompt; the browser returns to Swagger with a signed-in session.
5. In Swagger, run **GET /auth/me** and copy `csrfToken`. Click **Authorize**
   and enter that token. The browser sends the HttpOnly session cookie
   automatically. You can now use GET, POST, PUT, and DELETE routes for your
   own movies and reviews. POST, PUT, and DELETE require the CSRF header.

The OAuth `state` value is checked on callback. The session ID is signed and
stored in MongoDB, the cookie is HttpOnly and SameSite=Lax, and it is Secure
in production. GitHub access tokens are used to load the profile and are not
stored. A signed-in user is upserted into the `users` collection by GitHub ID.

## Routes

| Method | Movies | Reviews | Success |
| --- | --- | --- | --- |
| GET | `/movies` | `/reviews` | 200, array |
| GET | `/movies/:id` | `/reviews/:id` | 200, document |
| POST | `/movies` | `/reviews` | 201, document and Location header |
| PUT | `/movies/:id` | `/reviews/:id` | 200, updated document |
| DELETE | `/movies/:id` | `/reviews/:id` | 204, empty body |

All movie and review endpoints require GitHub sign-in. Each query is scoped to
the current user. Requests from other users receive 404 for inaccessible IDs.
Use `GET /auth/me` to check the current user and fetch the CSRF token. The
authentication routes are `GET /auth/github`, `GET /auth/github/callback`,
`GET /auth/me`, and `POST /auth/logout`.

List routes accept `limit` (default 50, maximum 100) and `skip` (default 0,
maximum 100000). Movies also accept `watchStatus`; reviews accept `movieId`.
Unknown query parameters and extra body fields return 400. PUT requires every
input field, preserves `createdAt`, and updates `updatedAt`. Missing records
return 404. Delete associated reviews before deleting a movie; otherwise it
returns 409. Request bodies over 100 KB return 413. Database failures return
a generic 500; `/health` returns 503 when MongoDB cannot be reached.

Example validation response:

```json
{
  "error": "Validation failed",
  "details": [{ "field": "director", "message": "Required" }]
}
```

## Test in Swagger

1. Visit `/auth/github` in the same browser and complete GitHub sign-in.
2. Open `/api-docs/`, run **GET /auth/me**, then authorize with its `csrfToken`.
3. Use **POST /movies** with the example body, then copy `_id` from the 201
   response.
4. Test GET by ID and PUT (send the complete movie body); check the response
   and MongoDB Atlas to confirm `watchStatus` changed.
5. Create and update a review using the movie ID. Delete the review first,
   then delete the movie; confirm both are gone from Atlas.
6. Sign in as a second GitHub account, if available, and verify that the
   first account's movies do not appear.
7. Try a write without a CSRF token and a malformed body to demonstrate 403
   and 400 validation responses.

Alternatively, open `requests.rest` with the VS Code REST Client extension.
Its named POST requests automatically provide IDs for later requests.

## Documentation and automated tests

```sh
npm run docs
npm test
```

The docs generator uses the same Zod input schemas as the validation middleware.
Commit `swagger.json` after regenerating it. Relative OpenAPI server URLs make
**Try it out** work on both localhost and Render without editing a hostname.

Tests start an isolated local MongoDB instance with mongodb-memory-server.
The first run downloads a MongoDB binary and needs network access. Tests never
read `.env` or access your Atlas database. They exercise OAuth state/session,
user ownership, both CRUD flows, persistence, references, validation, missing
records, error handling, and the docs routes.

## GitHub and Render setup

Use a **new GitHub repository** named `movie-watchlist-api`, with the contents
of this folder at the repository root. Keep your contacts project separate.
Before committing, confirm `.env` and `node_modules` are ignored:

```sh
git check-ignore .env node_modules
```

In Render, create **New → Web Service**, connect that repository, and set:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root Directory | Empty (this folder is the repository root) |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Your existing Atlas cluster URI; enter privately |
| `MONGODB_DB_NAME` | `movie_watchlist` |
| `SESSION_SECRET` | A private random value of at least 32 characters |
| `GITHUB_CLIENT_ID` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App secret; enter privately |

Render supplies `PORT`; leave it unset. Alternatively, use the provided
`render.yaml` as a Blueprint; it asks for the MongoDB URI, session secret, and
GitHub client credentials. If you create the service before the GitHub OAuth
App, add its client ID and secret later in the Render Environment settings.
Choose the free instance for this class project. Allow the Render service's
outbound IP addresses in Atlas Network Access (see the service's Connect menu).

After deployment, open `https://YOUR-SERVICE-NAME.onrender.com/health` and
`https://YOUR-SERVICE-NAME.onrender.com/api-docs/`. Create a separate GitHub
OAuth App for Render with callback URL
`https://YOUR-SERVICE-NAME.onrender.com/auth/github/callback`, then set its ID
and secret in the Render environment. The API builds this callback from
Render's `RENDER_EXTERNAL_URL` automatically. Visit `/auth/github` to sign in
before using Swagger. Test the CRUD routes and verify changes in the
`movie_watchlist` database in Compass or Atlas. Replace the placeholder in
`requests.rest` with the actual Render URL.

## Submission demo

Record roughly one minute showing:

1. The Render URL, `/api-docs/`, and GitHub sign-in.
2. GET movies, create and update a movie, and show the changes in MongoDB.
3. Create and delete a review, then delete the movie.
4. The documented authentication and CRUD routes, plus validation/error
   responses.
5. Render environment variable **names**, and GitHub's `.gitignore` / files
   to show credentials were not committed. Do not show secret values.

Submit the GitHub repository, Render service, and YouTube demo links in I-Learn.

## Final verification

Code support for OAuth and protected user-owned data is in place. The remaining
setup is to create the local and Render GitHub OAuth Apps, enter their
environment values, sign in, and verify the deployed callback and CRUD flow.
Do not show or commit OAuth secrets or the MongoDB connection string.

References: [course project requirements](https://cse341.netlify.app/projects),
[GitHub OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[MongoDB Node driver](https://www.mongodb.com/docs/drivers/node/current/get-started/),
and [Render Express deployment](https://render.com/docs/deploy-node-express-app).
