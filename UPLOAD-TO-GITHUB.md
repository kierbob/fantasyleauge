# Upload Courtside to GitHub

The `courtside` folder contains the application source, original basketball dataset, tests, dependency lockfile, and GitHub Actions workflows. Local accounts, league saves, notification keys, installed packages, screenshots, and build output are excluded.

## Upload the source

1. Create an empty GitHub repository. Choose its visibility yourself. The supplied NBA dataset will be included in the repository, so use a private repository if you do not want the source and data public.
2. Upload **the contents of the `courtside` folder into the repository root**. Do not upload the enclosing `courtside` folder as another directory. If using the ZIP, extract it first; GitHub does not unpack ZIP uploads into source files.
3. Include the dotfiles and the `.github` directory. The repository root should contain `package.json`, `README.md`, `src/`, `server/`, and `.github/` beside each other.
4. Commit to the `main` branch. The **Check Courtside** workflow installs dependencies, runs the tests, and verifies a production build.

GitHub Desktop is another option: create a repository from this folder, then publish it. The `.gitignore` already excludes local saves, dependencies, build output, and environment files.

## Publish the interface with GitHub Pages

Uploading the source does not make multiplayer available. GitHub Pages serves the interface; the shared simulation, draft timers, accounts, saved leagues, and push delivery run on the Node server.

1. First run the backend on an HTTPS host with **Node 24.12+**, a persistent disk, and an always-running process. Use `npm ci`, `npm run build`, then `npm start`. Set `HOST=0.0.0.0`, the host's required `PORT`, and `DATABASE_PATH` to a file on its persistent disk. No hosting service has been selected or purchased.
2. On the backend, set `CLIENT_ORIGIN` to your exact Pages origin, e.g. `https://YOUR-ACCOUNT.github.io` without the repository path. Configure `TRUST_PROXY=1` only if the host uses a trusted HTTPS reverse proxy.
3. In GitHub **Settings → Secrets and variables → Actions → Variables**, add a repository variable named **`VITE_API_URL`**, containing the backend HTTPS origin. This is a public URL, not a secret or API key.
4. In **Settings → Pages**, choose **GitHub Actions** as the source.
5. Run **Publish Courtside interface** from the Actions tab, or push a change to `main`. Deployment stays skipped until `VITE_API_URL` is set. Test/build checks still run on uploads without it.

The app uses relative asset paths, so it supports a Pages project URL such as `https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/`.

## Phone notifications

Set backend `PUBLIC_APP_URL` to the full frontend URL, including its repository path and trailing slash. Set `WEB_PUSH_SUBJECT` to your real `mailto:` contact or an operator HTTPS URL. The server creates private notification keys in its SQLite database. Never upload that database or private keys.

Players enable alerts themselves. On iPhone, install the site on the Home Screen and open it there before enabling notifications. Android / Samsung users can install it through their browser. Physical-device push delivery still needs verification after hosting is configured.

## Run locally after downloading the repository

Install Node 24.12 or later, then run:

```text
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Run `npm test` for the checks. `npm run package:github` recreates a clean upload folder without copying local accounts or saves.
