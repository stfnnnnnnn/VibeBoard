# Moving the database from Aiven (free) to TiDB Cloud Starter

**Why:** Aiven powers off free MySQL services after a period of inactivity. When that happens, every login on the hosted site fails with "Google sign-in didn't finish" (or a generic error for email login), because the first thing sign-in does is look you up in the database. TiDB Cloud Starter is free, speaks the MySQL protocol, and never needs to be switched back on: when idle it scales to zero and wakes up on the next connection.

**What changes in the app:** almost nothing. TiDB does not run triggers, and VibeBoard had six (`trg_update_{activity,quiz,exam}_status`, insert + update). They all did one thing: mark an entry `Done` once its score, items and grade are all filled in. That rule now lives in `src/lib/studypulse/entryStatus.ts` and is applied by every code path that writes those tables (`src/lib/studypulseEntries.ts`, `src/lib/canvas/sync.ts`). Locally the triggers still exist; they now just repeat what the app already did, which is harmless.

A seventh trigger, `set_academic_year_before_insert` on `subjects`, filled `subjects.academic_year` from `year_level` with a hard-coded (and by now stale) mapping. Nothing in the app reads that column (the academic year shown in StudyPulse comes from `trimesters`), so it is intentionally not replaced; new subjects on TiDB leave it `NULL`.

**Rollback:** the Aiven database is only read, never changed. To go back, put the old `DB_*` values back in Vercel and redeploy.

**How long:** about 45 minutes. Do Steps 4–7 in one sitting: anything saved on the live site after you copy the data will not be in TiDB.

**You will need:** a browser, VS Code with this project open, and its terminal (**Terminal → New Terminal**, PowerShell is fine). Every command below is run from the project folder `C:\xampp\htdocs\VibeBoard`.

---

## Step 0: Make a private folder for passwords and certificates

In the VS Code terminal:

```powershell
New-Item -ItemType Directory -Force .secrets
New-Item -ItemType File .secrets\notes.txt
code .secrets\notes.txt
```

`.secrets/` is git-ignored, so nothing in it can be committed by accident. Paste this into `notes.txt` and fill it in as you go:

```
AIVEN_HOST=
AIVEN_PORT=
AIVEN_USER=
AIVEN_PASS=
AIVEN_DB=

TIDB_HOST=
TIDB_PORT=4000
TIDB_USER=
TIDB_PASS=
TIDB_DB=vibeboard
```

---

## Step 1: Get the Aiven details (the source of your data)

1. Go to <https://console.aiven.io> and sign in.
2. You land on **Services**. Click **vibeboard-mysql**.
3. Look at the status badge next to the name:
   - **Running**: continue.
   - **Powered off**: click the **⋯** (Actions) menu at the top right of the service page (or in the service's row on the Services list) → **Power on**. It goes to **Rebuilding**, then **Running** after a few minutes. Wait for **Running**; nothing below works until then.
4. On the service's **Overview** page, find the **Connection information** section. Copy into `notes.txt`:
   - **Host** → `AIVEN_HOST`
   - **Port** → `AIVEN_PORT`
   - **User** → `AIVEN_USER` (usually `avnadmin`)
   - **Password** → click the eye icon to reveal it, then copy → `AIVEN_PASS`
5. In the same section, next to **CA certificate**, click **Download**. Move the downloaded `ca.pem` into the project and rename it:
   ```powershell
   Move-Item $HOME\Downloads\ca.pem .secrets\aiven-ca.pem
   ```
6. The database name: go to <https://vercel.com> → your VibeBoard project → **Settings** → **Environment Variables**. Find `DB_NAME` and click it (or its eye icon) to see the value. Copy it into `AIVEN_DB`. For VibeBoard it is `vibeboard`. Aiven's console shows **Database name: defaultdb**, but that is only the empty default database Aiven creates; the app's tables live in `vibeboard`.

---

## Step 2: Create the TiDB Cloud Starter instance

1. Go to <https://tidbcloud.com> and click **Sign Up**. Signing up with Google is the quickest. No credit card is needed.
2. After sign-in you land on the **My TiDB** page (it lists your instances; it is empty for now).
3. Click **Create Resource**.
4. Fill in the form:
   | Field | Choose |
   |---|---|
   | Plan | **Starter** (the free one) |
   | Compatibility Mode | **MySQL Compatible** (the default; do **not** pick PostgreSQL) |
   | Name | `vibeboard` |
   | Cloud provider | **AWS** |
   | Region | **Singapore (ap-southeast-1)**. Your Vercel functions run in Singapore (`sin1` in `vercel.json`), so this keeps every query fast. If Singapore is not in the list, pick **Tokyo**. |
   | Group Your Instance in a Project | Skip it (optional) |
   | Spending limit | Leave it at **0**. 0 means it stays free and never charges you; at worst it slows down if you exceed the free quota. |
5. Click **Create**. You are taken to the instance; it is ready in about 30 seconds.

---

## Step 3: Get the TiDB connection details

1. If you are not already there: **My TiDB** → click **vibeboard** to open its overview page.
2. Click **Connect** in the upper-right corner. A dialog opens.
3. Set the dropdowns:
   - **Connection Type**: **Public**
   - **Branch**: **main**
   - **Connect With**: **General** (if there is no "General", pick **MySQL CLI**; any option shows the same host and user)
   - **Operating System**: **Windows**
4. Click **Generate Password**. **Copy it into `TIDB_PASS` right now**: it is shown only once. (If you lose it, come back to this dialog and use **Reset Password**.)
5. From the parameters shown in the dialog, copy:
   - **Host** (looks like `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`) → `TIDB_HOST`
   - **Port** (`4000`) → `TIDB_PORT`
   - **User** (looks like `2aBcDeFgH1jK.root`; the part before `.root` is your instance's prefix and **is part of the username**) → `TIDB_USER`
6. Close the dialog.
7. Download the certificate TiDB uses for encrypted connections (Let's Encrypt's ISRG Root X1; the Connect dialog does not offer it, so get it directly):
   ```powershell
   Invoke-WebRequest https://letsencrypt.org/certs/isrgrootx1.pem -OutFile .secrets\tidb-ca.pem
   ```
   TiDB rejects connections without encryption, so this file is required.

### Check the firewall (it should already be open)

1. In the left navigation of the instance page, click **Settings** → **Networking**.
2. Make sure **Public Endpoint** is enabled.
3. Under **Authorized Networks** you should see a rule named **Allow_all_public_connections** (0.0.0.0 – 255.255.255.255). New instances have it by default. **Keep it**: Vercel's servers do not have fixed IP addresses, and your own PC needs access for Step 5.

   *(Optional, after everything works: you can tighten this by clicking **Add rule** → **Add AWS Access** (Vercel runs on AWS) and **Add rule** → **Add Current IP** (your PC), then deleting **Allow_all_public_connections** via its **⋯** → **Delete**, and clicking **Save**. Test the live site right after; if logins break, add the allow-all rule back. Your password and encryption protect the database either way.)*

---

## Step 4: Create the empty database on TiDB

1. In the instance's left navigation, click **SQL Editor**.
2. Clear anything already in the editor and type:
   ```sql
   CREATE DATABASE vibeboard;
   ```
3. Press **Ctrl + Enter** (or click **Run**). The result panel at the bottom should say the query succeeded.

---

## Step 5: Copy the data from Aiven to TiDB

`scripts/db-copy.mjs` reads every table from Aiven (structure and rows), creates the same tables on TiDB, skips the triggers, and checks that every table ends up with the same number of rows. It never changes Aiven.

### 5a. Make passwords URL-safe

The script takes each database as a URL: `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. Characters like `@ : / ? # %` in a password would break the URL, so encode both passwords first (paste each password between the quotes):

```powershell
node -e "console.log(encodeURIComponent('PASTE-AIVEN-PASSWORD-HERE'))"
node -e "console.log(encodeURIComponent('PASTE-TIDB-PASSWORD-HERE'))"
```

Use the printed values in the next command. (If nothing changed, the password was already safe.)

### 5b. Run the copy

Build the command from `notes.txt`. Replace every `ALL_CAPS` part, keep the quotes, and keep it all on one line:

```powershell
node scripts/db-copy.mjs "mysql://AIVEN_USER:AIVEN_PASS@AIVEN_HOST:AIVEN_PORT/AIVEN_DB" "mysql://TIDB_USER:TIDB_PASS@TIDB_HOST:4000/vibeboard" --src-ca .secrets/aiven-ca.pem --dst-ca .secrets/tidb-ca.pem
```

A filled-in example (fake values) looks like:

```powershell
node scripts/db-copy.mjs "mysql://avnadmin:AVNS_x1y2z3@vibeboard-mysql-karl.aivencloud.com:12345/defaultdb" "mysql://2aBcDeFgH1jK.root:Qw3rTy9@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/vibeboard" --src-ca .secrets/aiven-ca.pem --dst-ca .secrets/tidb-ca.pem
```

You should see one line per table, then:

```
Done: 50 tables copied, row counts verified.
```

(The table count may differ slightly from 50. What matters is the last line saying "row counts verified".)

### 5c. If it fails

Fix the cause and run the same command again with ` --drop` added at the end. That drops and re-copies each table on TiDB only.

| Error contains | Meaning | Fix |
|---|---|---|
| `ECONNREFUSED` or `ETIMEDOUT` with the Aiven host | Aiven is off or still rebuilding | Step 1.3: wait for **Running** |
| `ECONNREFUSED` or `ETIMEDOUT` with the TiDB host | Firewall rule missing | Step 3, "Check the firewall" |
| `Access denied for user` | Wrong user or password, or the password was not encoded | Re-copy it; redo 5a. For TiDB, make sure the user includes the prefix (`xxxx.root`) |
| `Unknown database 'vibeboard'` | Step 4 skipped | Run `CREATE DATABASE vibeboard;` in the SQL Editor |
| `Table '...' already exists` | A previous attempt got partway | Re-run with `--drop` |
| `self-signed certificate` / `unable to verify` | The two `.pem` files are swapped or missing | `--src-ca` is Aiven's, `--dst-ca` is TiDB's |
| `Invalid URL` | A quote or `@` is out of place | Check the URL shape; encode the password (5a) |

### 5d. Check the copy in TiDB

In the TiDB **SQL Editor**, run:

```sql
USE vibeboard;
SHOW TABLES;
SELECT COUNT(*) FROM user_login;
```

Run them all at once with **Shift + Ctrl + Enter**. The table list should match what the script printed, and the user count should match how many accounts your live site has.

---

## Step 6: Try the app on your PC against TiDB

This catches problems before your real users see them.

1. Back up your local settings:
   ```powershell
   Copy-Item .env.local .env.xampp.local
   ```
   (`.env.xampp.local` is git-ignored too.)
2. Turn the TiDB certificate into the one-line form `.env.local` needs:
   ```powershell
   node -e "console.log(JSON.stringify(require('fs').readFileSync('.secrets/tidb-ca.pem','utf8')))"
   ```
   It prints one long line starting with `"-----BEGIN CERTIFICATE-----\n`. Copy the whole line, quotes included.
3. Open `.env.local` and change the database lines (add any that are missing):
   ```
   DB_HOST=<TIDB_HOST>
   DB_PORT=4000
   DB_USER=<TIDB_USER>
   DB_PASS=<TIDB_PASS, the original, NOT the URL-encoded one>
   DB_NAME=vibeboard
   DB_SSL_CA=<the line from step 2, with its quotes>
   ```
4. Start the app: `npm run dev`, then open <http://localhost:3000>.
5. Check, in order:
   - [ ] Log in with email and password.
   - [ ] Log out, then log in with Google.
   - [ ] StudyPulse: add an activity **with** score, items and grade → it shows as **Done**.
   - [ ] Add one **without** a score → it stays **Pending**. Edit it, add a score → it becomes **Done**.
   - [ ] Finance, Habits and Workboard show your data.
6. Stop the dev server (**Ctrl + C** in the terminal) and restore your XAMPP settings:
   ```powershell
   Copy-Item .env.xampp.local .env.local -Force
   ```

If something in the checklist fails, stop here. The live site is still on Aiven and unaffected.

---

## Step 7: Point Vercel at TiDB

1. <https://vercel.com> → your VibeBoard project → **Settings** → **Environment Variables**.
2. For each variable below, click the **⋯** at the end of its row → **Edit**, replace the value, and click **Save**. If a variable shows separate rows per environment, update the **Production** one (and **Preview** too, if you use preview deployments).
   | Variable | New value |
   |---|---|
   | `DB_HOST` | `TIDB_HOST` |
   | `DB_PORT` | `4000` |
   | `DB_USER` | `TIDB_USER` (with its prefix) |
   | `DB_PASS` | `TIDB_PASS` (the original, not URL-encoded) |
   | `DB_NAME` | `vibeboard` |
   | `DB_SSL_CA` | Open `.secrets\tidb-ca.pem` in VS Code, select all, copy, and paste it in as-is. In Vercel, real line breaks are fine; you do **not** need the `\n` form from Step 6. |
   | `DB_POOL_LIMIT` | leave unchanged |
3. Environment variable changes only apply to new deployments. Go to the **Deployments** tab → on the top (most recent) deployment click **⋯** → **Redeploy** → confirm **Redeploy**.
4. Wait until it shows **Ready** (1–3 minutes).

---

## Step 8: Check the live site

1. Open a private/incognito window and go to <https://vibeboard-cyan.vercel.app/login>.
2. Sign in with Google → you should land on the dashboard.
3. Sign out and sign in with email and password.
4. Open StudyPulse and Finance and check your data is there.

If something fails: Vercel project → **Logs** tab, search for `auth` or `mysql`, and read the error. `ECONNREFUSED` / `ETIMEDOUT` points at the firewall (Step 3), `Access denied` at `DB_USER` / `DB_PASS`, and certificate errors at `DB_SSL_CA`. To undo everything instantly, put the old Aiven values back in the variables and redeploy.

---

## Step 9: Tidy up (after a few days of everything working)

- Aiven console → **vibeboard-mysql** → **⋯** → **Delete service**, so an unused copy of personal data is not left around.
- Delete the `.secrets` folder, or move it somewhere outside the project.

---

## Things that behave a little differently on TiDB (nothing to do)

- **No triggers.** Handled in app code as described at the top. Any new rule of that kind goes in app code, never in a trigger.
- **CHECK constraints are accepted but not enforced** by default (e.g. "exactly one owner", `amount >= 0`). The app validates these before writing, so behavior does not change.
- **Auto-increment IDs can jump** (e.g. 41, 42, then 30001). IDs stay unique, just not always consecutive. Nothing in VibeBoard relies on them being consecutive.
- **Free quota:** 5 GiB of data and 50 million "request units" per month. With the spending limit at 0, going over only slows the instance down until the next month; it never bills you. VibeBoard's data is far below this.
- **First request after a quiet period** can take an extra second while the instance wakes up. That is normal and it never needs switching back on.
