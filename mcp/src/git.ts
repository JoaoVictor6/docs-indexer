export interface GitProvider {
  getDocument(repositoryUrl: string, branch: string, path: string): Promise<string>;
}

export function createGitProvider(scmToken: string): GitProvider {
  return new GitHubGitProvider(scmToken);
}

class GitHubGitProvider implements GitProvider {
  private token: string;
  private readonly baseUrl = "https://raw.githubusercontent.com";

  constructor(scmToken: string) {
    this.token = scmToken;
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
        Authorization: `Basic ${btoa(this.token)}`,
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
  const httpsMatch = repositoryUrl.match(
    /^(?:https?:\/\/)(github\.com|bitbucket\.org)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/
  );
  if (httpsMatch) {
    const [, host, owner, repo] = httpsMatch;
    const provider = host === "github.com" ? "github" : "bitbucket";
    return { provider, owner, repo };
  }

  const sshMatch = repositoryUrl.match(
    /^git@(github\.com):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
  );
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    const provider = host === "github.com" ? "github" : "bitbucket";
    return { provider, owner, repo };
  }

  throw new Error(
    `Unsupported repository URL: ${repositoryUrl}; ` +
      `Only github.com and bitbucket.org repositories are supported`
  );
}