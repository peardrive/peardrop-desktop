<!--
Title must follow Conventional Commits — it becomes the squash commit on develop:
  feat: preview a link before downloading   fix: keep retries from duplicating files
  docs: explain the local bootstrapper      chore: bump electron
Breaking change? Add "!" after the type: feat!: move profiles to ~/.peardrop/profiles
-->

Closes #

## What changed

<!-- What the app does now that it didn't before, and why. -->

## How to test

<!-- Commands you ran, or the steps a reviewer can follow. Include a screenshot or short clip for UI changes. -->

## Checklist

- [ ] Branch is named `<type>/<issue>-<short-name>` and targets **develop**
- [ ] Changeset added (`npx changeset`) — or label `no-changeset` for repo-only changes (CI, tooling)
- [ ] `npm run verify` passes (Pearkit check, typecheck, tests, build)
- [ ] Tested a share → receive roundtrip with the local bootstrapper if the engine or transfer path changed
- [ ] README / `docs/` updated if user-facing behaviour changed
- [ ] Breaking changes called out in the changeset with a migration note
