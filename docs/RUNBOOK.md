# Development, data and acceptance runbook

## Rebuild on a new machine

Use a current Node release satisfying `package.json` (Vite requires Node 20.19+ or 22.12+), npm, Docker Compose, Git and Python 3.11+ compatible with the selected inference dependencies. Linux deployment must separately validate its Python/Torch wheels; the inference lock was produced on Windows CPU.

```powershell
npm ci
# New machine only: copy .env.example to .env, then fill private values.
docker compose -p smart-durian-farm up -d --pull never
npm run db:status
# Apply only if pending, after backup of an existing installation:
npm run db:migrate
npm run build
```

On a machine without cached images, omit `--pull never` for the first database startup. Never delete volumes to fix login. The API does not run migrations, seed or alter registered hardware automatically.

For image/PDF support:

```powershell
python -m venv ai/.venv
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements-inference.lock.txt
```

Place the trained classification weights at `ai/models/disease/best.pt`. Keep source PDFs at `ai/data/rag/pdfs/`; prepare durian sections with `ai/tools/prepare_corpus.py` and the source-controlled `ai/corpus.sources.json`, then review `npm run ai:corpus:check` before an explicit `npm run ai:corpus:import`. Uploading a PDF to a folder alone does not activate it. Existing database installations must not re-import an already prepared corpus unnecessarily.

## Four terminals

All commands start at repository root. Terminal 1 starts database containers as above; they run in the background. Terminal 2 runs `npm run dev:ai`, Terminal 3 runs `npm run start:api` after building, Terminal 4 runs `npm run dev:web`. For API development use `npm run dev:api` instead. Web is `http://127.0.0.1:5173`; local API is `http://127.0.0.1:3000/api`. Use a consistent browser origin. Vite proxies `/api` locally; an exported static build needs an actual reverse proxy or configured API origin.

`npm run dev:ai` already uses `ai/.venv`; activation is optional. PowerShell activation: `.\ai\.venv\Scripts\Activate.ps1`. If blocked, allow scripts for that terminal only with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`. Do not change machine policy just to start the worker.

After changing server environment or code used by `start:api`, rebuild/restart. A stale `dist` can make newly added routes appear absent. Never start an additional API against the same live controller just to troubleshoot; check which process owns the port first.

## Private configuration

`.env.example` documents configuration without real credentials. `.env` and `docs/LOCAL_MODULE_ACCEPTANCE.private.md` stay local and ignored. The latter contains the existing acceptance accounts; it is not published. Reference account fields are notes, not account-creation commands. Login uses the database account and current password; seeds do not reset an existing password.

Production uses a separate server environment with `AUTH_MODE=database`; local demo remains `AUTH_MODE=mock` in development. Both can use the existing persisted accounts, but production ignores test-account creation inputs and has no mock SMS inbox or public Swagger. Do not overwrite local phone/email/provider settings when preparing a server configuration. A disabled production SMS/email provider means those verification functions are unavailable, not simulated successful.

Twilio uses account SID, auth token and Verify Service SID. A blank HTX Verify Service SID reuses the main service; a distinct VA SID is optional. Password-reset and Manager allowlists remain separate. HTX SMS goes to the authenticated Manager's stored phone, not an arbitrary request field or cooperative contact number. Shared-service demo flows should run sequentially. Trial restrictions still apply. SMTP handles real email verification. Never expose mock OTP inboxes on a public host.

Groq uses `AI_CHAT_PROVIDER=groq`, `GROQ_API_KEY` and `GROQ_MODEL`; Gemini remains selectable explicitly. Provider keys are backend-only. `AI_INTERNAL_TOKEN` is shared only between API and loopback worker. Do not use `VITE_` for secrets. A precheck showing `key_present` does not validate provider quota, billing or a real answer.

MQTT is opt-in through `MQTT_ENABLED`; host/port/TLS/auth configure the broker, not HTTP. Registered `station_id` lives in the database. `DEMO_DEVICE_STATION_ID` is seed/audit input only. An absent hardware signal must display stale/offline data honestly. Hardware ACK is never proof of watering or spraying.

## Data preparation and quality

Existing local data should be retained. On a fresh, explicitly designated development database, `npm run db:seed` creates the base dataset without overwriting existing rows. Additional explicit tools are `db:data:preview`/`db:data:refresh`, `db:data:expand`, `db:materials:expand` and API workspace `db:cultivation:preview`/`db:cultivation:expand`. These are initialization/maintenance tools, not startup commands or production traffic generators. Stop API/worker writers and back up before applying them. Do not run them merely to make dates look recent.

`node tools/audit-data.cjs` runs read-only checks after the API build. It outputs aggregate counts, ownership/area/batch/date/proximity checks and full cultivation hash validation, never credentials or personal identifiers. The proximity check is a broad plausibility heuristic, not a legal boundary test. Both databases must already be available.

The 16 November 2026 audit found 15 accounts, 4 cooperatives, 8 Farms, 16 Zones, 414 Trees, 3 Devices, 18 Sensors, 9 Actuators, 160 harvest rows and 290 cultivation events. The cultivation mix includes Watering, Fertilizing, Tree-specific Spraying and other Zone/Tree work. All audited inconsistencies were zero, one configured hardware identifier matched, and the cultivation ledger verified. Historical sample data is realistic synthetic initialization; real hardware/user records remain distinct through existing internal provenance. No new sample history was added during release review.

## Automated checks

Release review on 16 November 2026: backend 288/288; database integration 317/317 (including production login/restart and 10,000-event chain capacity); web unit 34/34; browser regression 60/60; AI browser 13/13; catalog 4/4; backdate picker 1/1; control-to-journal 1/1; assignment search 3/3; database browser 5/5; Python 10/10. Lint, typecheck and builds passed. The supplied ten-class weights loaded and completed one synthetic CPU inference; this tests plumbing, not accuracy. A coordinated backup including 17 referenced AI files was verified and restored into a disposable database. All PostgreSQL rows/account hashes and non-RAG Mongo collections matched the pre-rename snapshot exactly; RAG changes were restricted to filenames and update timestamps.

Production npm audit reports zero known advisories at review time. Full development audit still reports seven moderate entries through TypeScript ESLint's `minimatch` chain ([upstream advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)); these tools are not runtime dependencies. Do not lint untrusted glob inputs with elevated credentials. A forced major override was deliberately avoided; review an upstream-compatible fix before expanding CI access. Vite reports a main bundle above 500 kB, and Python tests emit a Starlette/httpx deprecation warning. Neither was hidden by raising thresholds or suppressing warnings. Linux-host service validation, off-host recovery and live hardware/provider acceptance remain separate release gates.

Two optional `apps/web/test/taste-audit*.mjs` scripts are retained from the owner's UI work. They require an independently reviewed local `TASTE_SKILL_PATH` and are not part of the reproducible release acceptance counts. No external skill code was downloaded or executed during this review.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web
npm run test:ai
npm run test:web:e2e
npm run test:web:ai
```

Browser checks use an installed compatible Chromium/Edge; see browser fixture executable discovery if running on Linux CI. They start isolated memory APIs, loopback brokers and mock providers, without reading the real `.env` for business effects.

Database regression uses a **different Compose project and ports**:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
npm run test:persistence
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml stop
```

Never omit the fixture project name or point these tests at application databases. Run the heavy compiler/browser/database suites sequentially on a small machine. A timeout during parallel compilation is not evidence that a workflow passed. Provider, SMTP/SMS and hardware acceptance are separate manual checks.

`npm run check:acceptance --workspace @smart-durian/api` checks local configuration, database/migration/corpus/worker readiness without making a real provider/SMS call or sending MQTT commands. It may require the private Python worker running. Inspect each result rather than equating configured credentials with successful remote service use.

## Manual acceptance before launch

Use separate browser sessions for owner, assigned Farmer, Manager and Admin. Check:

1. Login, idle expiry, logout/revocation, normalized phone numbers, real password-reset SMS, Manager email verification and Admin approval/attachment; no public Admin registration.
2. Owner/Admin opposing Farm/Zone/Tree/metadata approvals; Manager cooperative restrictions; other-account UUIDs cannot bypass scope. Farm shrinking cannot violate Zone area totals.
3. Name/phone Farmer search, assignment acceptance/start/end, no overlap; expiry blocks new journal/harvest/control and IoT access while retaining only permitted author history.
4. Standard/material creation and editing, numeric dosage basis, Active constraints, warning for journal material outside a standard.
5. Harvest same-Tree/date conflict, shared batch boundaries, Draft submission/owner confirmation, never-confirmed Draft deletion, independent correction approval, seven-day backdate grant and Dead/Removed date checks.
6. Cultivation Zone/Tree targets, four action categories, 15-minute editing, locking, corrections and original-assignment limits. Public QR must hide Pending/private data and show complete Locked lineage applicability.
7. Six hardware streams, units, latest/history, stale/offline presentation, disconnect/reconnect, restart and 10,000-reading retention. Compare real sensor values against hardware; sample history is not proof.
8. Hardware Start/Stop order, both watering/spraying exclusion, one missing ACK, late/duplicate/wrong ACK, reset-before-Start after restart, failed recovery staying Unknown and Active-only OFF. Observe physical relays safely; do not infer movement from ACK. Confirm suggested journal creation is user-initiated, with materials supplied for Spraying.
9. Diagnosis top-three display, invalid/large image rejection, own-only history/image/delete, no claim of healthy/out-of-domain detection. Chat live provider success/quota/auth/timeout behavior, Markdown safety, optional citations and actual source pages/draft labels. Admin RAG upload/activate/inactivate does not expose private Farmers' AI histories.
10. Mobile and short desktop layouts, failed requests without false success, stale selections reset, name/phone/date readability, one-page pagination hidden, Admin catalog actions and QR download/scan from another device.

## Backup and restore

Stop application writers for a consistent cross-database backup; PostgreSQL and MongoDB are not one distributed transaction. `npm run db:backup` creates an ignored JSON archive and, when referenced AI files exist, a neighboring `.json.assets` directory. Copy both together to encrypted off-host storage. Run `npm run db:backup:verify -- <archive>` and `npm run db:restore:check -- <archive>` against the isolated fixture before relying on the copy.

`db:restore:new` restores into a **new random database**, never overwrites the configured one. Inspect the restored target before switching connection strings. Preserve trained weights and original/unimported PDFs separately: they are not included merely because an AI database backup exists. Keep older model versions if inference reproducibility matters. Backups can contain deleted history and credentials/hashes; retention and access need operational care.

Old documentation, thesis diagrams, reference screenshots and unused brand/model evaluation assets were copied to ignored `backups/release-v1/source-materials-before-cleanup.zip` before removal. This local safety archive is not a clean-machine dependency and must not be pushed. Runtime images/logos, model, original PDFs, private acceptance accounts, dependencies and data volumes are retained.

## Vietnamese AI source filenames

`ai/corpus.sources.json` now uses readable Vietnamese PDF basenames, retaining `legacy_filename` as the old-to-new lookup. `node tools/rename-ai-pdfs.cjs preview` validates original and prepared checksums before listing aggregate pending changes. An explicit `apply <verified-backup.json>` requires the API/migrations stopped and maintenance locks available. It renames bounded files without overwriting, updates the prepared manifest and the imported RAG document/source filenames, and can be re-run after interruption. It does not change PDF bytes, hashes, page mappings, chunks, document IDs, ID-based private storage filenames or existing conversation citations.

The 16 November maintenance renamed 10 originals and 15 prepared PDFs, updating 15 imported document labels. Rerun made zero changes. Future citations show the readable original filename; historical conversations retain their original citation snapshot, traceable through the legacy mapping. The font-corrupt TCVN PDF remains excluded; renaming does not make it an approved or extractable source. No PDF/model bytes are committed to Git.
