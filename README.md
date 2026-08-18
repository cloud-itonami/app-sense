# app-sense

`etzhayyim sense` — sensor-fusion 3D building reconstruction — extracted from the
etzhayyim monorepo. **This repository is a design document plus one orphaned
TypeScript source file. It is not a runnable application: it cannot be built,
typechecked, or deployed, and it contains no tests.**

Every number on this page was measured on 2026-08-19 at `3b8a4ed` (macOS 15
`Darwin 25.3.0`, node v26.3.0, tsc 5.9.2, esbuild 0.28.0) and is re-measured by
[`docs/verify-docs-claims.cljs`](docs/verify-docs-claims.cljs). Run that before
trusting any of them.

| path | bytes | state |
|---|---|---|
| `src/app.ts` | 14,395 | 363 lines. Registers **23 commands**. Imports 9 names from `@etzhayyim/kotodama-host-sdk`, **a package that no longer exists** (§ *Why nothing builds*). **12 of the 23 handlers have had their read path removed** and return an empty result by construction (§ *Half the commands cannot answer*) |
| `CLAUDE.md` | 7,027 | the design document. Describes **five Rust WASM compute modules and a `wasm/` build tree that are not in this repository** — and are not registered anywhere in the superproject (§ *What the design document describes but does not contain*) |
| `kotodama.jsonld` | 2,368 | the agent record: DID, capabilities, space, and two HTTP routes. **Neither route resolves in DNS** |
| `NOTICE` | 499 | Apache-2.0 + etzhayyim Charter Rider v3.1. Directs the reader to `CHARTER-RIDER.md`, which is not in this repository |
| `README.edn` + `migration.edn` | 684 | canonical EDN records, added by the extraction |

Six tracked files, **24,973 bytes**, three commits, last commit 2026-08-11 —
measured at `3b8a4ed`, before this documentation was added. Zero test files;
this commit adds none.

Start at [`docs/operator-quickstart.md`](docs/operator-quickstart.md).

## Custody is exact — nothing here was broken by the extraction

`migration.edn` says it copied 4 files / 24,289 bytes from `etzhayyim/root` at
revision `691c245d`, subtree `60-apps/etzhayyim-project-sense`, git-tree
`bf8574b1`. All four claims verify:

- that subtree at that revision holds exactly **4 files totalling 24,289 bytes**,
- its tree object is **`bf8574b1567418f818fe739832f9a9c11eca1473`**,
- and all **4 blobs are byte-identical here**, SHA-for-SHA.

So every defect below is inherited from the monorepo, not introduced by the
migration, and the fix for each belongs upstream as well as here. The two files
`migration.edn` does not count (`README.edn`, `migration.edn`) are the canonical
records the extraction itself added — the count is correct, not short by two.

## Why nothing builds

There is **no `package.json`, `tsconfig.json`, `wrangler.toml`, `deps.edn`,
`shadow-cljs.edn`, or `Cargo.toml`** anywhere in the repository — zero build or
dependency manifests of any kind. `src/app.ts` has exactly one import
statement, and it cannot resolve:

```
$ esbuild --bundle src/app.ts --outfile=/dev/null
✘ [ERROR] Could not resolve "@etzhayyim/kotodama-host-sdk"
1 error
```

**The package was deliberately deleted, not merely left uninstalled.** Its home
in this workspace is `kotoba-lang/kotodama-host`, whose commit `5b2b084`
(2026-07-02) is titled *"cleanup: land stalled CLJC migration WIP (host contract
EDN/CLJC authority, delete TS SDK)"*. After it:

- `sdk/kotodama-host-sdk/` contains **zero `.ts` files**, and its README states
  *"TypeScript package metadata and runtime facade code were removed; EDN/CLJC is
  the authority for host SDK operations."*
- **None of the 9 names `src/app.ts` imports** — `asAgentTool`,
  `createWorkerExport`, `nowISO`, `withCapabilityTags`, `HostSDK`,
  `parseYataRows`, `decodeJson`, `nsid`, `parseLexiconInput` — appears anywhere in
  `kotodama-host`.
- The successor facade (`resources/kotodama_host/sdk_facade.edn`) exposes **four**
  operations: `create-host-sdk`, `dispatch`, `cancel`, `health`. It is not a
  drop-in: it is a different shape under a different package name
  (`@etzhayyim/kotoba-kotodama-host-sdk`).
- Both package names return **404** from the npm registry.

So this is not a `npm install` away. Making `src/app.ts` run again means
rewriting it against the EDN/CLJC contract — which is a port, not a fix.

### Read the error count carefully

A typecheck reports **48 errors** under modern strict flags, but there is
**exactly one defect**: the missing module. The other 47 are `TS7006`
implicit-`any`, all cascading from `createWorkerExport`'s `sdk` parameter being
untyped because its module is absent.

```
$ tsc --noEmit --strict --target es2022 --module es2022 --moduleResolution bundler src/app.ts
src/app.ts(10,8):  error TS2307: Cannot find module '@etzhayyim/kotodama-host-sdk' …
src/app.ts(263,36): error TS7006: Parameter 'sdk' implicitly has an 'any' type.
…                                                    # 48 total: 1 × TS2307, 47 × TS7006
```

Run it with no flags and you get **24** instead — 1 × `TS2307` plus 23 × `TS2705`
(`async` requires the ES5 `Promise` constructor), which are artifacts of the
missing `tsconfig.json`, not of the code. **Do not report 48, or 24, as a defect
count.** Both numbers are one defect wearing different clothes.

## Half the commands cannot answer

`src/app.ts` registers 23 commands and defines 23 handlers, but **12 handlers
have had their query removed** and now hold the literal:

```ts
const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
```

Those 12 are `cmdScanGet`, `cmdScanList`, `cmdBuildingGet`, `cmdBuildingList`,
`cmdBuildingExport`, `cmdFloorGet`, `cmdRoomGet`, `cmdStructureGet`,
`cmdStructureList`, `cmdSensorStatus`, `cmdVizRender`, `cmdVizTimeline` — i.e.
**every read path in the app**. Each returns `null`, `{…: []}`, or
`{error: "…NotFound"}` regardless of input. `cmdStructureList` still builds a
`kindClause` SQL fragment that is then never used.

This matters beyond "it doesn't build": were the SDK restored unchanged, the app
would start and answer every query with nothing. `CLAUDE.md` still documents the
graph schema (`(:Building)-[:HAS_FLOOR]->(:Floor)…`) that these handlers used to
query. **No replacement store is referenced anywhere in this repository.**

## What the design document describes but does not contain

`CLAUDE.md` is a full architecture for a system substantially larger than this
tree. Specifically it documents:

| documented | present here |
|---|---|
| five Rust WASM modules — `sense-pointcloud`, `sense-mesh`, `sense-acoustic`, `sense-signal`, `sense-fusion` — with their algorithms | **no `wasm/` directory**; no repository by any of those names is registered in the superproject's west manifest (4,214 projects) |
| a build step, `cd wasm/etzhayyim-wasm-sense-{name}-{nanoid} && cargo component build` | that path does not exist |
| a KAMI wgpu 3D renderer as the visualization layer | named 3× in `CLAUDE.md` and nowhere else — no code or config here references it |
| a SQL/graph query layer | removed from all 12 read paths, dated 2026-04-12 |

Read `CLAUDE.md` as the monorepo-era design intent, not as a description of this
repository. Note also that its "全て Rust WASM" instruction conflicts with the
superproject's standing rule against writing new Rust; that conflict is inherited
and is an owner question, not something this documentation resolves.

## Not deployed

`kotodama.jsonld` declares `runtimeType: "worker"` and two routes,
`sense.etzhayyim.com` and `sv8q2k5r.etzhayyim.com`. **Neither resolves** — both
are NXDOMAIN — while the apex `etzhayyim.com` resolves and serves 200. There is
no `wrangler.toml` or other deploy configuration in the repository, so nothing
here could be deployed to those hosts anyway.

## What you cannot answer from here

- **Whether the port is wanted.** Restoring this app means rewriting `src/app.ts`
  against the EDN/CLJC host contract *and* choosing a store to replace the one
  deprecated on 2026-04-12. Neither decision is recorded anywhere.
- **Where the five WASM compute modules went.** They are named with nanoids in
  `CLAUDE.md`, and no repository by those names is registered in the
  superproject's west manifest. That bounds the search to what west knows; it is
  not proof they exist nowhere.
- **Whether `app-maps` expects this repo.** `README.edn` declares
  `:boundary {:spatial-application "cloud-itonami/app-maps"}`. `app-maps` is a
  substantial, buildable repository — and it **does not mention `app-sense` or
  `sense.etzhayyim.com` anywhere**. The reference is one-way.
