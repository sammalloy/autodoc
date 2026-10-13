import { execFileSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function repoRoot(cwd: string): string {
  return git(cwd, 'rev-parse', '--show-toplevel');
}

const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);

/**
 * Files changed since `base` (committed on this branch, plus uncommitted and untracked files
 * so the check also works locally before a commit), relative to the repo root.
 */
export function changedFiles(root: string, base: string): string[] {
  let committed: string[];
  try {
    committed = lines(git(root, 'diff', '--name-only', `${base}...HEAD`));
  } catch (e) {
    throw new Error(
      `cannot diff against "${base}". In CI, fetch it first (git fetch origin main) and pass --base origin/main.\n${(e as Error).message}`,
    );
  }
  const working = lines(git(root, 'diff', '--name-only', 'HEAD'));
  const untracked = lines(git(root, 'ls-files', '--others', '--exclude-standard'));
  return [...new Set([...committed, ...working, ...untracked])].sort();
}

export function commitMessages(root: string, base: string): string[] {
  const out = git(root, 'log', '--format=%B%x00', `${base}..HEAD`);
  return out.split('\0').map(m => m.trim()).filter(Boolean);
}

export interface GitInfo {
  branch: string;
  commit: string;
  prId: string | null;
  baseBranch?: string;
}

/** Branch, commit and PR from Jenkins multibranch variables, falling back to git. */
export function gitInfo(cwd: string, env = process.env): GitInfo {
  const branch = env.CHANGE_BRANCH || env.BRANCH_NAME || git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  const commit = env.GIT_COMMIT || git(cwd, 'rev-parse', 'HEAD');
  return { branch, commit, prId: env.CHANGE_ID || null, baseBranch: env.CHANGE_TARGET || undefined };
}
