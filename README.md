# DAX and M interview prep

A single-user study app for Power BI interviews, with questions framed around a university data environment (Banner student records, HE analytics, multiple data sources).

## What it has

- 169 questions: DAX, M, SQL, Banner, HE data, modelling, security
- Six study modes: flashcards, quiz, predict the output, spot the bug, explain aloud, write from memory
- Smart sessions (spaced repetition: Again, Hard, Good, Easy), mock interviews, filters, weak-topic drill-down
- Progress is kept on the device and merged with the server, so any computer picks up where you left off
- Keys: Space reveals, 1 to 4 rates, A to D answers a quiz question

All questions are marked unverified. Run the code in Power BI, DAX Studio or your SQL client before trusting an answer.

## Run locally

    npm install        # only needed for the optional Postgres driver and the YAML build
    npm run build:bank # rebuilds content/bank.json from the YAML files
    npm run validate
    npm test
    APP_TOKEN=choose-something npm start

Open http://localhost:3000 and enter the token. Without APP_TOKEN the server runs open in development, and refuses to serve in production (503).

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render choose New, then Blueprint, and select the repository (it reads `render.yaml`). Or create a Web Service by hand: build `npm install --omit=dev`, start `node server.js`.
3. Set `APP_TOKEN` to a long random string.
4. Choose where progress lives:
   - Nothing extra: stored in a file. On Render's free web service the disk is ephemeral, so server-side progress is lost on redeploy or restart. Your browser still keeps a local copy and re-uploads it on the next sync.
   - Postgres: create a Render Postgres instance and set `DATABASE_URL` to its internal URL. The table is created on first start.
   - Paid persistent disk: mount it and set `DATA_DIR` to the mount path.
   Check Render's current free-tier terms before relying on any of these.
5. Open the service URL on any computer and enter the token once. It is remembered in that browser.

## Editing questions

Edit the YAML files in `content/`, then `npm run build:bank`. Set `verified: true` on an item once you have run it.

## Layout

- `server.js`, `storage.js`: dependency-free HTTP server, file or Postgres storage
- `public/`: the front end (`app.js`, `srs.js`, `style.css`)
- `content/`: YAML question banks and the compiled `bank.json`
- `test/`: SRS and API tests, plus `ui_smoke.py` (Playwright)
