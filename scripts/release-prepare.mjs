#!/usr/bin/env node
// Prepares a release from develop:
//   1. checks you're on an up-to-date, clean develop with pending changesets
//   2. creates release/v<next> and runs `changeset version`
//      (bumps package.json, writes CHANGELOG.md, deletes the consumed changesets)
//   3. syncs package-lock.json and commits "chore(release): v<next>"
// Then you push the branch and open the PRs printed at the end.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};
const version = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

const branch = out('git rev-parse --abbrev-ref HEAD');
if (branch !== 'develop') fail(`Run this on develop (you're on ${branch}).`);
if (out('git status --porcelain')) fail('Working tree is not clean. Commit or stash first.');

try {
  out('git remote get-url origin');
} catch {
  fail('No "origin" remote. Add one with: git remote add origin <url>');
}

run('git fetch origin --tags --quiet');
const behind = out('git rev-list --count HEAD..origin/develop');
if (behind !== '0') fail(`develop is ${behind} commit(s) behind origin/develop. Run: git pull --ff-only`);

const pending = readdirSync('.changeset').filter((f) => f.endsWith('.md') && f !== 'README.md');
if (pending.length === 0) fail('No changesets in .changeset/ — nothing to release.');

const current = version();
let work = `release/next-${Date.now()}`;
run(`git switch -c ${work} --quiet`);

try {
  run('npx changeset version');
  const next = version();
  if (next === current) throw new Error('changeset version did not change the version.');
  if (out(`git tag -l v${next}`)) throw new Error(`Tag v${next} already exists.`);

  // Keep the lockfile's own version field in step with package.json.
  run('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { stdio: 'ignore' });

  const releaseBranch = `release/v${next}`;
  run(`git branch -m ${releaseBranch}`);
  work = releaseBranch;
  run('git add -A package.json package-lock.json CHANGELOG.md .changeset');
  run(`git commit --quiet -m "chore(release): v${next}"`);

  console.log(`
✔ Prepared v${current} → v${next} on ${releaseBranch}

Next:
  1. npm run verify
  2. git push -u origin ${releaseBranch}
  3. Open a PR  ${releaseBranch} → develop   title: "chore(release): v${next}"   (squash merge)
  4. Open a PR  develop → main               title: "release: v${next}"          (merge commit)
  5. Merging into main builds the installers, tags v${next} and publishes the GitHub Release automatically.
`);
} catch (err) {
  console.error(`\n✖ ${err.message}\nRolling back.`);
  run('git reset --hard --quiet');
  run('git switch develop --quiet');
  run(`git branch -D ${work} --quiet`, { stdio: 'ignore' });
  process.exit(1);
}
