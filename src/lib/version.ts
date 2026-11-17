import { execSync } from 'child_process';

export const APP_VERSION = '0.1.0';
export const BUILD_TIMESTAMP = new Date().toISOString();

let cachedCommitSha: string | null = null;

export function getGitCommitSha(): string {
  if (cachedCommitSha) return cachedCommitSha;

  // 1. Check environment variables (e.g. CI / Docker / GitHub Actions)
  if (process.env.GIT_COMMIT_SHA) {
    cachedCommitSha = process.env.GIT_COMMIT_SHA.slice(0, 7);
    return cachedCommitSha;
  }
  if (process.env.GITHUB_SHA) {
    cachedCommitSha = process.env.GITHUB_SHA.slice(0, 7);
    return cachedCommitSha;
  }

  // 2. Try git command if repo is present
  try {
    const stdout = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    cachedCommitSha = stdout.trim();
    return cachedCommitSha;
  } catch (e) {
    cachedCommitSha = 'main';
    return cachedCommitSha;
  }
}
