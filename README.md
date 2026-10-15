# Movie Watchlist API

CSE 341 Project 2 (lessons 5–8). Save movies, track what you want to watch,
and write reviews. This is a backend API; Swagger UI is the interface used
to try its endpoints.

## Lesson 5 scope

- Node.js and Express, with separate routes and controllers.
- MongoDB database `movie_watchlist`, with `movies` and `reviews` collections.
- GET all, GET by ID, POST, PUT, and DELETE for both collections.
- Strict request validation, JSON errors, and interactive API documentation.
- Render configuration and local/Render REST Client requests.

OAuth login, logout, user ownership, and protected writes are **not implemented
yet**. They belong to the later lessons. All current endpoints are public;
use demonstration data only. `reviewerName` is a display label, not a verified
identity. The complete lessons 5–8 requirements are not finished until OAuth
and the hosted deployment are working.

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
Atlas Network Access must permit the machine connecting to the cluster.

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
as dates; responses serialize them as strings.

## Routes

| Method | Movies | Reviews | Success |
| --- | --- | --- | --- |
| GET | `/movies` | `/reviews` | 200, array |
| GET | `/movies/:id` | `/reviews/:id` | 200, document |
| POST | `/movies` | `/reviews` | 201, document and Location header |
| PUT | `/movies/:id` | `/reviews/:id` | 200, updated document |
| DELETE | `/movies/:id` | `/reviews/:id` | 204, empty body |

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

1. Open `/api-docs/` and expand **POST /movies**.
2. Click **Try it out**, use the example body, and click **Execute**.
3. Copy `_id` from the 201 response.
4. Execute **GET /movies** and **GET /movies/{id}** with that ID.
5. Use the movie ID as `movieId` when testing **POST /reviews**.
6. Test PUT with all input fields, then delete the review before the movie.
7. Send an incomplete movie body to demonstrate the 400 validation response.

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
read `.env` or access your Atlas database. They exercise both CRUD flows,
database persistence, references, validation, missing records, error handling,
and the docs routes.

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

Render supplies `PORT`; leave it unset. Alternatively, use the provided
`render.yaml` as a Blueprint; it prompts for `MONGODB_URI`. Choose the free
instance for this class project. Allow the Render service's outbound IP
addresses in Atlas Network Access (see the service's Connect menu).

After deployment, open `https://YOUR-SERVICE-NAME.onrender.com/health` and
`https://YOUR-SERVICE-NAME.onrender.com/api-docs/`. Test GET and POST there,
then verify the new document appears in the `movie_watchlist` database in
Compass or Atlas. Replace the placeholder in `requests.rest` with the actual
Render URL.

## Lesson 5 submission

Record roughly one minute showing:

1. The Render URL and `/api-docs/`.
2. GET movies, POST a movie, and GET the created movie.
3. The new document in MongoDB.
4. The documented GET, GET by ID, POST, PUT, and DELETE routes.
5. Render environment variable **names**, and GitHub's `.gitignore` / files
   to show credentials were not committed. Do not show secret values.

Submit the GitHub repository, Render service, and YouTube demo links in I-Learn.

## Later lessons

Add OAuth login/logout, derive user identity from the authenticated session,
protect mutations, and enforce ownership instead of trusting reviewer names.
Update Swagger to describe authentication and 401/403 responses, and verify
the login callback on both localhost and Render before the final submission.

References: [course project requirements](https://cse341.netlify.app/projects),
[MongoDB Node driver](https://www.mongodb.com/docs/drivers/node/current/get-started/),
and [Render Express deployment](https://render.com/docs/deploy-node-express-app).
