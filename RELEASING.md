# Workflow and releases

PearDrop follows GitFlow. `main` only ever holds released, tagged versions; all work happens
on short-lived branches that land on `develop`; a release moves `develop` into `main`.

```
 issue #42 ─▶ feat/42-link-preview ─┐
 issue #57 ─▶ fix/57-duplicate-file ─┼─ squash ─▶ develop ─▶ release PR ─▶ main ─▶ tag v0.32.0
 issue #63 ─▶ chore/63-bump-electron ─┘                     (merge commit)        + GitHub Release
```

| Branch | Holds | Merged in by | Protected |
| --- | --- | --- | --- |
| `main` | Released versions only. Every commit is tagged `vX.Y.Z`. | Merge commit from `develop` (or `hotfix/*`) | Yes |
| `develop` | Everything finished and reviewed, waiting for the next release. | Squash merge | Yes |
| `<type>/<issue>-<name>` | One issue's work. Deleted after merge. | — | No |

Reading history:

- `git log --oneline develop` — one commit per issue, in Conventional Commit form.
- `git log --oneline --first-parent main` — one merge per release.

## 1. Start with an issue

Every change starts as an issue, using one of the templates:

- **Feature request** — the problem, the proposed behaviour, and whether it is additive or breaking.
- **Bug report** — version, OS, install method, network, reproduction and logs.
- **Task / chore** — tooling, CI, dependencies, refactoring.

Triage it (`status: triage` → `status: ready`) and assign it to a milestone named after the release
it should ship in, e.g. `v0.32.0`.

## 2. Branch from develop

```bash
git switch develop && git pull --ff-only
git switch -c feat/42-link-preview
```

Branch types: `feat/` (new behaviour), `fix/`, `docs/`, `refactor/`, `perf/`, `test/`, `build/`,
`ci/`, `chore/`. Commit as often as you like — they are squashed away.

## 3. Add a changeset

Before opening the PR, describe the change for the changelog:

```bash
npx changeset
```

Pick the bump (see [`.changeset/README.md`](.changeset/README.md)) and write a sentence or two for
people using the app. Commit the generated `.changeset/*.md` file. CI/tooling-only PRs can skip this
with the `no-changeset` label.

## 4. Verify and open a pull request into develop

Run every check in one go before pushing:

```bash
npm run verify
```

That runs the Pearkit copy check, the TypeScript typecheck for main and renderer, the vitest suite
(including the local-DHT share/download/resume roundtrip) and a full `electron-vite build`.

- **Title** in Conventional Commit form — it becomes the commit on `develop`:
  `feat: preview a link before downloading`, `fix: keep retries from duplicating files`,
  `chore: bump electron`.
  Breaking: `feat!: move profiles to ~/.peardrop/profiles`.
- **Body**: `Closes #42` so the issue closes on merge. Add a screenshot or clip for UI changes.
- CI runs `verify`, `pr-title`, and `changeset` (on PRs into `develop`).
- Merge with **Squash and merge**. Delete the branch.

## 5. Release

When `develop` has what the milestone needs:

```bash
git switch develop && git pull --ff-only
npm run release:prepare
```

This creates `release/vX.Y.Z`, runs `changeset version` (bumps `package.json`, writes
`CHANGELOG.md`, removes the consumed changesets), syncs `package-lock.json` and commits
`chore(release): vX.Y.Z`. Then:

1. `git push -u origin release/vX.Y.Z` and open a PR **into develop** titled `chore(release): vX.Y.Z`.
   Review the changelog, squash-merge.
2. Open a PR **develop → main** titled `release: vX.Y.Z`. CI's `release-source` check confirms it
   comes from `develop`, the version is new and no changesets are left. Merge with **Create a merge
   commit**.
3. The **Release** workflow builds the Windows and Linux installers, verifies them, tags the merge
   commit `vX.Y.Z`, and publishes a GitHub Release with that version's changelog section and the
   installers attached.
4. Close the milestone.

GitHub will show `develop` as "1 commit behind main" after each release. That is the release merge
commit and is expected; don't merge `main` back into `develop`.

### The first release through this workflow

`0.31.0` is already committed on `main` but was never tagged or published. It has no pending
changesets, so don't run `release:prepare` for it: push `main` (or open a `develop → main` PR) and
the Release workflow publishes `v0.31.0`. From the next version onward, the normal
`npm run release:prepare` flow above applies.

### What a release contains

| Platform | Assets |
| --- | --- |
| Windows (x64) | `PearDrop-<version>-win-x64.exe` installer, `PearDrop-<version>-portable.exe`, `*.blockmap`, `latest.yml` |
| Linux | `PearDrop-<version>-linux-<arch>.AppImage`, `.deb`, `latest-linux.yml` |

macOS is not built by CI yet. It needs a `macos-latest` runner plus the Apple signing and
notarization secrets, because `electron-builder.config.cjs` sets `notarize: true`. Add the matrix
entry (`build:mac`) and the secrets when that account is available; until then, macOS installers are
built locally on a Mac.

### If a release fails

Nothing is tagged until the installers build. Re-run the failed job; the tag step and the release
step both tolerate an existing tag/release on the same commit and re-upload the assets. If the
version was not bumped, the job fails instead of moving a published tag.

## Hotfixes

Normally a fix just goes through `develop` and you cut a patch release right away. If `develop`
holds unreleased work that can't ship yet:

1. `git switch -c hotfix/71-stall-on-resume origin/main`, fix it, `npx changeset` (patch).
2. Run `npx changeset version`, then `npm install --package-lock-only`, and commit
   `chore(release): vX.Y.Z`.
3. PR `hotfix/71-stall-on-resume` → `main` titled `release: vX.Y.Z`, merge commit. The tag and the
   Release are created automatically.
4. Bring the fix to develop: `git switch -c fix/71-port-hotfix origin/develop`,
   `git cherry-pick <hotfix commits>`, PR into `develop` with label `no-changeset`, squash-merge.

## Versioning

PearDrop follows [SemVer](https://semver.org). While it is `0.x`, a minor bump (`0.31 → 0.32`) is
the breaking one, because people pin to a release and expect only compatible changes within a
minor. Patch releases are bug fixes and internal work.

## One-time GitHub setup (maintainer)

1. Create `develop` from `main` and push it: `git switch -c develop && git push -u origin develop`.
   Set `develop` as the default branch if you want PRs to target it by default.
2. **Settings → General → Pull Requests**: allow *merge commits* and *squash merging*, disable
   *rebase merging*; set squash commit message to *Pull request title and description*; enable
   *Automatically delete head branches*.
3. **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, once for each file in
   [`.github/rulesets/`](.github/rulesets/): `main.json`, `develop.json`, `release-tags.json`.
4. **Settings → Actions → General → Workflow permissions**: *Read and write permissions* (the
   Release workflow pushes tags and creates releases).
5. **Actions → Repo setup (labels) → Run workflow** to create the labels.
6. Create a milestone for the next release (`v0.32.0`).

To add required reviews once more people are on the team, raise `required_approving_review_count`
in the `main` and `develop` rulesets.
