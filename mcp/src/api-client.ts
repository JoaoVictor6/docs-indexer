export interface DocumentMetadata {
  project: string;
  path: string;
  repositoryUrl: string | null;
  branch: string;
  commitSha: string | null;
}

export interface ApiSearchResult {
  chunk: string;
  path: string;
  project: string;
  similarity: number;
  repositoryUrl: string | null;
  title: string | null;
  heading: string | null;
}

export interface ApiClient {
  search(params: { query: string; project: string; limit: number }): Promise<ApiSearchResult[]>;
  getDocumentMetadata(project: string, path: string): Promise<DocumentMetadata | null>;
}

export function createApiClient(baseUrl: string): ApiClient {
  return {
    async search({ query, project, limit }) {
      const url = `${baseUrl}/search?${new URLSearchParams({ q: query, project, limit: String(limit) })}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API search returned ${res.status}`);
      return (await res.json()) as ApiSearchResult[];
    },
    async getDocumentMetadata(project, path) {
      const url = `${baseUrl}/projects/${encodeURIComponent(project)}/document?${new URLSearchParams({ path })}`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API document returned ${res.status}`);
      return (await res.json()) as DocumentMetadata;
    },
  };
}