import type { McpConfig } from "./config";

export interface GitProvider {
  getDocument(repositoryUrl: string, branch: string, path: string): Promise<string>;
}

export function createGitProvider(config: McpConfig): GitProvider {
  return new GitHubGitProvider(config);
}

class GitHubGitProvider implements GitProvider {
  private token: string;
  private baseUrl: string;

  constructor(config: McpConfig) {
    this.token = config.githubToken;
    this.baseUrl = config.githubBaseUrl;
  }

  async getDocument(repositoryUrl: string, branch: string, path: string): Promise<string> {
    const repo = parseGitHubRepo(repositoryUrl);
    if (!repo) {
      throw new Error(
        `Only GitHub repositories are supported (got: ${repositoryUrl}); ` +
        `set the project's repository_url to a github.com repository`
      );
    }

    const rawUrl = `${this.baseUrl}/${repo}/${branch}/${path}`;
    const response = await fetch(rawUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.raw+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} for ${rawUrl}`);
    }

    return await response.text();
  }
}

function parseGitHubRepo(repositoryUrl: string): string | null {
  const match = repositoryUrl.match(
    /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/
  );
  return match ? match[1] : null;
}
