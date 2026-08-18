# operator quickstart — app-sense

Walked end to end on 2026-08-19 from a fresh worktree of `cloud-itonami/main`
at `3b8a4ed`. Every command below was run; the output shown is what it printed.

**Read this first:** nothing in this repository builds, and that is not a
misconfiguration you can fix locally — the package `src/app.ts` imports was
deliberately deleted upstream (§3). The useful operations here are *reading the
record*, *verifying custody*, and *establishing what a port would cost*.

Environment used: macOS 15 (`Darwin 25.3.0`), `node v26.3.0`, `nbb v1.4.210`,
`tsc 5.9.2`, `esbuild 0.28.0`, `curl`, `dig`.

## 1. Clone

```bash
git clone git@github.com:cloud-itonami/app-sense
cd app-sense
```

Inside the west superproject the checkout already exists at
`orgs/cloud-itonami/app-sense`, and its git remote is named `cloud-itonami`,
not `origin` — `git fetch origin` fails there. Use `git fetch cloud-itonami`
and `cloud-itonami/main`. The checkout also sits on a detached HEAD at
`refs/heads/manifest-rev`; that is west's doing, not damage.

## 2. See everything there is

```bash
$ git ls-files
CLAUDE.md
NOTICE
README.edn
kotodama.jsonld
migration.edn
src/app.ts

$ git ls-files -z | xargs -0 wc -c | sort -rn
   24973 total
   14395 src/app.ts
    7027 CLAUDE.md
    2368 kotodama.jsonld
     499 NOTICE
     394 migration.edn
     290 README.edn
```

Six files, 24,973 bytes, three commits. That is the whole repository — there is
no hidden subtree, no submodule, and no `wasm/` directory despite what
`CLAUDE.md` describes.

## 3. Confirm that nothing builds (and why)

```bash
$ git ls-files | grep -Ei 'package\.json|tsconfig|wrangler|deps\.edn|shadow-cljs|Cargo\.toml|vite\.config'
(no output)
```

No build or dependency manifest of any kind. So the single import in
`src/app.ts` cannot resolve:

```bash
$ esbuild --bundle src/app.ts --outfile=/dev/null
✘ [ERROR] Could not resolve "@etzhayyim/kotodama-host-sdk"

    src/app.ts:10:7:
      10 │ } from "@etzhayyim/kotodama-host-sdk";
1 error
```

Now establish that this is not an uninstalled dependency but a removed one.
The package's home in this workspace is `kotoba-lang/kotodama-host`:

```bash
R=~/github/com-junkawasaki
$ git -C $R/orgs/kotoba-lang/kotodama-host log --oneline -1 -- sdk/
5b2b084 cleanup: land stalled CLJC migration WIP (host contract EDN/CLJC authority, delete TS SDK)

$ find $R/orgs/kotoba-lang/kotodama-host/sdk -name '*.ts' | wc -l
0

$ for n in asAgentTool createWorkerExport nowISO withCapabilityTags HostSDK \
           parseYataRows decodeJson nsid parseLexiconInput; do
    printf '%-20s %s\n' "$n" "$(grep -rF "$n" $R/orgs/kotoba-lang/kotodama-host | wc -l)"
  done
asAgentTool          0
createWorkerExport   0
nowISO               0
withCapabilityTags   0
HostSDK              0
parseYataRows        0
decodeJson           0
nsid                 0
parseLexiconInput    0
```

Zero of the nine imported names survive. The npm registry agrees, for both the
old name and the one the successor facade now declares:

```bash
$ for p in '@etzhayyim%2fkotodama-host-sdk' '@etzhayyim%2fkotoba-kotodama-host-sdk'; do
    curl -sS -o /dev/null -w "$p -> %{http_code}\n" "https://registry.npmjs.org/$p"
  done
@etzhayyim%2fkotodama-host-sdk       -> 404
@etzhayyim%2fkotoba-kotodama-host-sdk -> 404
```

The successor contract is EDN, and exposes four operations, not the nine
functions this file calls:

```bash
$ grep -o ':name :[a-z-]*' $R/orgs/kotoba-lang/kotodama-host/resources/kotodama_host/sdk_facade.edn
:name :create-host-sdk
:name :dispatch
:name :cancel
:name :health
```

**So `npm install` is not a step here, and no version pin will bring the package
back.** Restoring this app is a port against the EDN/CLJC contract.

### Do not report the typecheck error count as a defect count

```bash
$ tsc --noEmit --strict --target es2022 --module es2022 --moduleResolution bundler src/app.ts
# 48 errors: 1 × TS2307 (cannot find module), 47 × TS7006 (implicit any)

$ tsc --noEmit src/app.ts
# 24 errors: 1 × TS2307, 23 × TS2705 (async needs the ES5 Promise constructor)
```

Both numbers describe **the same single defect**. Under strict flags the 47
`TS7006` all cascade from `createWorkerExport`'s `sdk` parameter having no type
(line 263) because its module is missing; under default flags the 23 `TS2705`
are artifacts of there being no `tsconfig.json` to set a modern target.

## 4. Verify custody against the monorepo it came from

This is the one check that proves the repository is intact. `migration.edn`
pins the source:

```bash
$ cat migration.edn
{:schema "etzhayyim.migration/extracted-v1"
 :source {:repo "etzhayyim/root"
          :path "60-apps/etzhayyim-project-sense"
          :revision "691c245da48f3acb11dd757218f189ff2482b1c8"
          :git-tree "bf8574b1567418f818fe739832f9a9c11eca1473"
          :tracked-files 4 :bytes 24289} ...}
```

With a checkout of `etzhayyim/root` available (in the superproject it is at
`orgs/etzhayyim/root`), compare blob SHAs path-for-path:

```bash
R=~/github/com-junkawasaki
REV=691c245da48f3acb11dd757218f189ff2482b1c8
SP=60-apps/etzhayyim-project-sense
for f in CLAUDE.md NOTICE kotodama.jsonld src/app.ts; do
  dst=$(git rev-parse "HEAD:$f")
  src=$(git -C $R/orgs/etzhayyim/root rev-parse "$REV:$SP/$f")
  [ "$dst" = "$src" ] && echo "ok   $f" || echo "DIFF $f"
done
```

Result on 2026-08-19: **4 identical, 0 differing.** The upstream subtree is also
exactly 4 files / 24,289 bytes with tree `bf8574b1`, so all four numbers in
`migration.edn` are correct.

```bash
$ git -C $R/orgs/etzhayyim/root rev-parse "$REV:$SP"
bf8574b1567418f818fe739832f9a9c11eca1473
```

The repository has 6 files rather than 4 because the extraction added
`README.edn` and `migration.edn` itself. That is not a discrepancy.

⚠ Check that `etzhayyim/root` is not a shallow clone first
(`git -C $R/orgs/etzhayyim/root rev-parse --is-shallow-repository` → it printed
`false`). A shallow clone can fail to reach `691c245d` and would make this check
report a problem that does not exist.

## 5. See which commands can still answer

```bash
$ grep -c '\.command(nsid(' src/app.ts
23
$ grep -c '^async function cmd' src/app.ts
23
$ grep -c 'SQL deprecated 2026-04-12' src/app.ts
12
$ awk '/^async function cmd/{f=$3; sub(/\(.*/,"",f)} /SQL deprecated/{if(!seen[f]++) print f}' src/app.ts
cmdScanGet
cmdScanList
cmdBuildingGet
cmdBuildingList
cmdBuildingExport
cmdFloorGet
cmdRoomGet
cmdStructureGet
cmdStructureList
cmdSensorStatus
cmdVizRender
cmdVizTimeline
```

Twelve of the twenty-three handlers — **every read path** — had their query
removed on 2026-04-12 and now return an empty result for any input. Restoring
the SDK alone would produce a service that starts and answers nothing.

## 6. Confirm it is not deployed

```bash
$ dig +short sense.etzhayyim.com        # (empty — NXDOMAIN)
$ dig +short etzhayyim.com
104.21.51.111
172.67.179.128
$ curl -sS -o /dev/null -w '%{http_code}\n' https://etzhayyim.com/
200
```

The apex is live; the two hosts `kotodama.jsonld` declares
(`sense.etzhayyim.com`, `sv8q2k5r.etzhayyim.com`) do not resolve. There is also
no deploy configuration in the repository, so nothing here targets them.

## 7. Re-measure everything this documentation claims

```bash
nbb docs/verify-docs-claims.cljs
```

- `0` — every claim re-measured and matched.
- `1` — a claim is now false. The message names which.
- `3` — **the check could not be made**: not run from the repository root, `git`
  unavailable, or no commits. Distinct from 0 on purpose, so that a run which
  never measured anything cannot be mistaken for a clean one.

Three checks above are deliberately **not** folded into the verifier, because
each needs something outside this repository and "could not look" would return
the same value as "looked and found nothing wrong":

- **§4 custody** needs a checkout of `etzhayyim/root`.
- **§3 upstream deletion** needs a checkout of `kotoba-lang/kotodama-host`.
- **§6 DNS and §3 npm** need the network.

The verifier instead checks the *causes that live inside this repository*: that
there are zero build manifests, that the import specifier is exactly the one
that is gone, that 12 of 23 handlers are stubbed, and that `CLAUDE.md` still
describes a `wasm/` tree the repository does not have. Run §3, §4 and §6 by hand.

## 8. What you cannot answer from here

- **Whether the port is wanted**, and against which store — the one the read
  paths used was deprecated 2026-04-12 and no replacement is named anywhere.
- **Where the five WASM compute modules went.** `CLAUDE.md` names them with
  nanoids; no repository by those names is registered in the superproject's west
  manifest (4,214 projects).
- **Whether `app-maps` expects this repo.** `README.edn` points at
  `cloud-itonami/app-maps` as its spatial application; `app-maps` does not
  mention `app-sense` anywhere. The reference is one-way.
