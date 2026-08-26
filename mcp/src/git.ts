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
    const repo = parseRepositoryUrl(repositoryUrl);
    if (repo.provider !== "github") {
      throw new Error(
        `Only GitHub repositories are supported (got: ${repositoryUrl}); ` +
        `set the project's repository_url to a github.com repository`
      );
    }

    const rawUrl = `${this.baseUrl}/${repo.owner}/${repo.repo}/${branch}/${path}`;
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

export interface RepositoryUrl {
  provider: "github" | "bitbucket";
  owner: string;
  repo: string;
}

export function parseRepositoryUrl(repositoryUrl: string): RepositoryUrl {
  const match = repositoryUrl.match(
    /^(?:https?:\/\/)?(github\.com|bitbucket\.org)[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/
  );
  if (!match) {
    throw new Error(
      `Unsupported repository URL: ${repositoryUrl}; ` +
        `only github.com and bitbucket.org repositories are supported`
    );
  }
  const [, host, owner, repo] = match;
  const provider = host === "github.com" ? "github" : "bitbucket";
  return { provider, owner, repo };
}
