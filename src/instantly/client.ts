import { config } from "../config.js";
import {
  InstantlyApiError,
  InstantlyAuthError,
  InstantlyRateLimitError,
  InstantlyTimeoutError,
} from "./errors.js";
import { mockDb } from "./mock.js";
import type {
  InstantlyAccount,
  InstantlyCampaign,
  InstantlyCampaignAnalytics,
  InstantlyLead,
  InstantlyWorkspace,
  ListResponse,
} from "./types.js";

export interface InstantlyClientInterface {
  listCampaigns(params?: {
    limit?: number;
    starting_after?: string;
    search?: string;
    status?: number;
  }): Promise<ListResponse<InstantlyCampaign>>;

  getCampaign(id: string): Promise<InstantlyCampaign>;

  getCampaignAnalytics(params?: {
    id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<InstantlyCampaignAnalytics[]>;

  listLeads(params?: {
    limit?: number;
    starting_after?: string;
    campaign?: string;
    list_id?: string;
    search?: string;
    filter?: string;
  }): Promise<ListResponse<InstantlyLead>>;

  listEmailAccounts(params?: {
    limit?: number;
    starting_after?: string;
    search?: string;
    status?: number;
  }): Promise<ListResponse<InstantlyAccount>>;

  getCurrentWorkspace(): Promise<InstantlyWorkspace>;

  addLead(data: {
    email: string;
    campaign?: string;
    list_id?: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    job_title?: string;
    phone?: string;
    website?: string;
    custom_variables?: Record<string, any>;
  }): Promise<InstantlyLead>;

  pauseCampaign(id: string): Promise<InstantlyCampaign>;

  activateCampaign(id: string): Promise<InstantlyCampaign>;
}

export class InstantlyClient implements InstantlyClientInterface {
  private readonly baseUrl = "https://api.instantly.ai/api/v2";
  private readonly apiKey: string;
  private readonly mockMode: boolean;
  private readonly requestTimeoutMs = 10000; // 10s timeout
  private readonly maxGetRetries = 2; // max 2 retries for GET requests

  constructor(apiKey: string = config.INSTANTLY_API_KEY, mockMode: boolean = config.MOCK_MODE) {
    this.apiKey = apiKey;
    this.mockMode = mockMode;
  }

  /**
   * Central fetch wrapper.
   * - 10s timeout via AbortController
   * - Retries max 2x with exponential backoff ONLY for GET on 429/5xx (never retry writes)
   * - Typed errors
   * - API Key strictly in Authorization header
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
      queryParams?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const method = options.method ?? "GET";
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (options.queryParams) {
      for (const [key, val] of Object.entries(options.queryParams)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const isGet = method === "GET";
    const maxAttempts = isGet ? 1 + this.maxGetRetries : 1;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        // Success status (2xx)
        if (response.ok) {
          return (await response.json()) as T;
        }

        // Handle error responses
        const status = response.status;
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        let errorBodyMessage = `HTTP ${status}`;
        try {
          const jsonErr = (await response.json()) as { message?: string; error?: string };
          errorBodyMessage = jsonErr.message || jsonErr.error || errorBodyMessage;
        } catch {
          // Response body was not JSON
        }

        if (status === 401 || status === 403) {
          throw new InstantlyAuthError(errorBodyMessage);
        }

        if (status === 429) {
          // If GET and has remaining attempts, wait and retry
          if (isGet && attempt < maxAttempts - 1) {
            const delayMs = retryAfterSec ? retryAfterSec * 1000 : 500 * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 2000)));
            continue;
          }
          throw new InstantlyRateLimitError(retryAfterSec);
        }

        if (status >= 500 && isGet && attempt < maxAttempts - 1) {
          // Transient server error: backoff and retry
          const delayMs = 300 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw new InstantlyApiError(errorBodyMessage, status);
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof InstantlyApiError) {
          throw err;
        }

        if (err instanceof Error && err.name === "AbortError") {
          throw new InstantlyTimeoutError(this.requestTimeoutMs);
        }

        lastError = err;
        if (isGet && attempt < maxAttempts - 1) {
          const delayMs = 300 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        break;
      }
    }

    if (lastError instanceof Error) {
      throw new InstantlyApiError(lastError.message, 500);
    }
    throw new InstantlyApiError("Request to Instantly failed", 500);
  }

  // --- Tool Implementations ---

  async listCampaigns(params?: {
    limit?: number;
    starting_after?: string;
    search?: string;
    status?: number;
  }): Promise<ListResponse<InstantlyCampaign>> {
    if (this.mockMode) {
      let filtered = [...mockDb.campaigns];
      if (params?.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
      }
      if (params?.status !== undefined) {
        filtered = filtered.filter((c) => c.status === params.status);
      }
      const limit = Math.min(params?.limit ?? 20, 50);
      let startIndex = 0;
      if (params?.starting_after) {
        const found = filtered.findIndex((c) => c.id === params.starting_after);
        if (found !== -1) startIndex = found + 1;
      }
      const page = filtered.slice(startIndex, startIndex + limit);
      const nextCursor =
        startIndex + limit < filtered.length ? page[page.length - 1]?.id : undefined;

      return { items: page, next_starting_after: nextCursor };
    }

    return this.request<ListResponse<InstantlyCampaign>>("/campaigns", {
      method: "GET",
      queryParams: {
        limit: params?.limit ? Math.min(params.limit, 50) : 20,
        starting_after: params?.starting_after,
        search: params?.search,
        status: params?.status,
      },
    });
  }

  async getCampaign(id: string): Promise<InstantlyCampaign> {
    if (this.mockMode) {
      const camp = mockDb.campaigns.find((c) => c.id === id);
      if (!camp) {
        throw new InstantlyApiError("Resource not found", 404);
      }
      return camp;
    }

    return this.request<InstantlyCampaign>(`/campaigns/${encodeURIComponent(id)}`, {
      method: "GET",
    });
  }

  async getCampaignAnalytics(params?: {
    id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<InstantlyCampaignAnalytics[]> {
    if (this.mockMode) {
      if (params?.id) {
        const stat = mockDb.analytics.filter((a) => a.campaign_id === params.id);
        return stat;
      }
      return [...mockDb.analytics];
    }

    return this.request<InstantlyCampaignAnalytics[]>("/campaigns/analytics", {
      method: "GET",
      queryParams: {
        id: params?.id,
        start_date: params?.start_date,
        end_date: params?.end_date,
      },
    });
  }

  async listLeads(params?: {
    limit?: number;
    starting_after?: string;
    campaign?: string;
    list_id?: string;
    search?: string;
    filter?: string;
  }): Promise<ListResponse<InstantlyLead>> {
    if (this.mockMode) {
      let filtered = [...mockDb.leads];
      if (params?.campaign) {
        filtered = filtered.filter((l) => l.campaign === params.campaign);
      }
      if (params?.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter(
          (l) =>
            l.email.toLowerCase().includes(q) ||
            l.first_name?.toLowerCase().includes(q) ||
            l.company_name?.toLowerCase().includes(q)
        );
      }
      const limit = Math.min(params?.limit ?? 20, 50);
      let startIndex = 0;
      if (params?.starting_after) {
        const found = filtered.findIndex((l) => l.id === params.starting_after);
        if (found !== -1) startIndex = found + 1;
      }
      const page = filtered.slice(startIndex, startIndex + limit);
      const nextCursor =
        startIndex + limit < filtered.length ? page[page.length - 1]?.id : undefined;

      return { items: page, next_starting_after: nextCursor };
    }

    // Instantly API v2 requires POST /api/v2/leads/list
    return this.request<ListResponse<InstantlyLead>>("/leads/list", {
      method: "POST",
      body: {
        limit: params?.limit ? Math.min(params.limit, 50) : 20,
        starting_after: params?.starting_after,
        campaign: params?.campaign,
        list_id: params?.list_id,
        search: params?.search,
        filter: params?.filter,
      },
    });
  }

  async listEmailAccounts(params?: {
    limit?: number;
    starting_after?: string;
    search?: string;
    status?: number;
  }): Promise<ListResponse<InstantlyAccount>> {
    if (this.mockMode) {
      let filtered = [...mockDb.accounts];
      if (params?.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter((a) => a.email.toLowerCase().includes(q));
      }
      if (params?.status !== undefined) {
        filtered = filtered.filter((a) => a.status === params.status);
      }
      const limit = Math.min(params?.limit ?? 20, 50);
      let startIndex = 0;
      if (params?.starting_after) {
        const found = filtered.findIndex((a) => a.id === params.starting_after);
        if (found !== -1) startIndex = found + 1;
      }
      const page = filtered.slice(startIndex, startIndex + limit);
      const nextCursor =
        startIndex + limit < filtered.length ? page[page.length - 1]?.id : undefined;

      return { items: page, next_starting_after: nextCursor };
    }

    return this.request<ListResponse<InstantlyAccount>>("/accounts", {
      method: "GET",
      queryParams: {
        limit: params?.limit ? Math.min(params.limit, 50) : 20,
        starting_after: params?.starting_after,
        search: params?.search,
        status: params?.status,
      },
    });
  }

  async getCurrentWorkspace(): Promise<InstantlyWorkspace> {
    if (this.mockMode) {
      return mockDb.workspace;
    }

    return this.request<InstantlyWorkspace>("/workspaces/current", {
      method: "GET",
    });
  }

  async addLead(data: {
    email: string;
    campaign?: string;
    list_id?: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    job_title?: string;
    phone?: string;
    website?: string;
    custom_variables?: Record<string, any>;
  }): Promise<InstantlyLead> {
    if (this.mockMode) {
      const newLead: InstantlyLead = {
        id: `01956fbd-0eb1-72db-a565-${Math.random().toString(36).substring(2, 14)}`,
        email: data.email,
        campaign: data.campaign ?? null,
        list_id: data.list_id ?? null,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        company_name: data.company_name ?? null,
        job_title: data.job_title ?? null,
        phone: data.phone ?? null,
        website: data.website ?? null,
        custom_variables: data.custom_variables ?? null,
        status: "FILTER_VAL_NOT_CONTACTED",
        timestamp_created: new Date().toISOString(),
      };
      mockDb.leads.push(newLead);
      return newLead;
    }

    return this.request<InstantlyLead>("/leads", {
      method: "POST",
      body: data,
    });
  }

  async pauseCampaign(id: string): Promise<InstantlyCampaign> {
    if (this.mockMode) {
      const camp = mockDb.campaigns.find((c) => c.id === id);
      if (!camp) {
        throw new InstantlyApiError("Resource not found", 404);
      }
      camp.status = 2; // Paused
      camp.timestamp_updated = new Date().toISOString();
      return camp;
    }

    return this.request<InstantlyCampaign>(`/campaigns/${encodeURIComponent(id)}/pause`, {
      method: "POST",
    });
  }

  async activateCampaign(id: string): Promise<InstantlyCampaign> {
    if (this.mockMode) {
      const camp = mockDb.campaigns.find((c) => c.id === id);
      if (!camp) {
        throw new InstantlyApiError("Resource not found", 404);
      }
      camp.status = 1; // Active
      camp.timestamp_updated = new Date().toISOString();
      return camp;
    }

    return this.request<InstantlyCampaign>(`/campaigns/${encodeURIComponent(id)}/activate`, {
      method: "POST",
    });
  }
}

export const instantlyClient = new InstantlyClient();
