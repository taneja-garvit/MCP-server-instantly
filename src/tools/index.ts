import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { instantlyClient } from "../instantly/client.js";
import { formatActionableErrorMessage } from "../instantly/errors.js";
import { auditToolCall } from "../logger.js";
import { isRoleAuthorized, type UserRole } from "../types/roles.js";
import {
  formatAccountStatus,
  formatCampaignStatus,
  sanitizeString,
} from "../utils/sanitize.js";

/**
 * Creates and configures an McpServer instance tailored for the given user role.
 *
 * Enforces role security in TWO places:
 * 1. Filter tools/list: Only tools permitted for the session's role are registered.
 * 2. In-handler guard: Every tool handler re-verifies role authorization before executing.
 */
export function createMcpServer(role: UserRole = "admin"): McpServer {
  const server = new McpServer({
    name: "instantly-mcp-server",
    version: "1.0.0",
  });

  // ==========================================
  // 1. VIEWER TOOLS (Read-Only)
  // ==========================================

  if (isRoleAuthorized(role, "viewer")) {
    // Tool: list_campaigns
    server.registerTool(
      "list_campaigns",
      {
        description:
          "List cold email outreach campaigns with status, creation time, and pagination. " +
          "Use this to discover campaigns in the workspace or check if a campaign is active, paused, or draft. " +
          "Returns an array of compact campaign items and a pagination cursor (next_starting_after). " +
          "Does NOT return lead lists or full email bodies.",
        inputSchema: {
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe("Number of campaigns to return (default 20, max 50)"),
          starting_after: z
            .string()
            .max(100)
            .optional()
            .describe("Pagination cursor from previous next_starting_after"),
          search: z
            .string()
            .max(100)
            .optional()
            .describe("Case-insensitive search by campaign name"),
          status: z
            .number()
            .int()
            .optional()
            .describe(
              "Filter by campaign status (0: Draft, 1: Active, 2: Paused, 3: Completed, -1: Unhealthy)"
            ),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        // In-handler secondary role re-check
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({ role, tool: "list_campaigns", success: false, error: "Unauthorized" });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          const res = await instantlyClient.listCampaigns({
            limit: args.limit,
            starting_after: args.starting_after,
            search: args.search,
            status: args.status,
          });

          const items = res.items.map((c) => ({
            id: c.id,
            name: sanitizeString(c.name, 150),
            status: formatCampaignStatus(c.status),
            statusCode: c.status,
            is_evergreen: c.is_evergreen ?? false,
            created_at: c.timestamp_created,
          }));

          auditToolCall({
            role,
            tool: "list_campaigns",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    campaigns: items,
                    count: items.length,
                    next_starting_after: res.next_starting_after || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "list_campaigns",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: get_campaign
    server.registerTool(
      "get_campaign",
      {
        description:
          "Retrieve detailed configuration for a specific campaign by ID. " +
          "Use this to inspect campaign settings, schedule windows, and sequence steps. " +
          "Returns campaign metadata, schedule, and step structure. " +
          "Does NOT start, pause, or modify the campaign.",
        inputSchema: {
          id: z.string().min(1).max(100).describe("Unique identifier of the campaign"),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({ role, tool: "get_campaign", success: false, error: "Unauthorized" });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          const camp = await instantlyClient.getCampaign(args.id);

          const sequenceSteps =
            camp.sequences?.[0]?.steps?.map((st, i) => ({
              stepNumber: i + 1,
              type: st.type,
              delayDays: st.delay,
              delayUnit: st.delay_unit || "days",
              variantsCount: st.variants?.length || 0,
              firstSubject: sanitizeString(st.variants?.[0]?.subject, 100),
            })) || [];

          const summary = {
            id: camp.id,
            name: sanitizeString(camp.name, 150),
            status: formatCampaignStatus(camp.status),
            statusCode: camp.status,
            is_evergreen: camp.is_evergreen ?? false,
            targetValue: camp.pl_value ?? null,
            created_at: camp.timestamp_created,
            updated_at: camp.timestamp_updated,
            schedule: camp.campaign_schedule?.schedules?.[0]
              ? {
                  name: camp.campaign_schedule.schedules[0].name,
                  timing: camp.campaign_schedule.schedules[0].timing,
                  timezone: camp.campaign_schedule.schedules[0].timezone,
                }
              : null,
            sequenceStepsCount: sequenceSteps.length,
            steps: sequenceSteps,
          };

          auditToolCall({
            role,
            tool: "get_campaign",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "get_campaign",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: get_campaign_analytics
    server.registerTool(
      "get_campaign_analytics",
      {
        description:
          "Get performance metrics (leads count, emails sent, opens, replies, bounces, open rate %, reply rate %) for campaigns. " +
          "Use this when analyzing campaign effectiveness or generating performance reports. " +
          "Returns compact aggregated metrics. Does NOT return individual lead activity timestamps.",
        inputSchema: {
          id: z
            .string()
            .max(100)
            .optional()
            .describe("Optional campaign ID. If omitted, returns analytics for all campaigns"),
          start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
            .optional()
            .describe("Analytics start date (YYYY-MM-DD)"),
          end_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
            .optional()
            .describe("Analytics end date (YYYY-MM-DD)"),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({
            role,
            tool: "get_campaign_analytics",
            success: false,
            error: "Unauthorized",
          });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          const stats = await instantlyClient.getCampaignAnalytics({
            id: args.id,
            start_date: args.start_date,
            end_date: args.end_date,
          });

          const formatted = stats.map((s) => {
            const openRate =
              s.emails_sent_count > 0
                ? ((s.open_count / s.emails_sent_count) * 100).toFixed(1) + "%"
                : "0%";
            const replyRate =
              s.contacted_count > 0
                ? ((s.reply_count / s.contacted_count) * 100).toFixed(1) + "%"
                : "0%";

            return {
              campaign_id: s.campaign_id,
              campaign_name: sanitizeString(s.campaign_name, 120),
              status: formatCampaignStatus(s.campaign_status),
              leads_count: s.leads_count,
              contacted_count: s.contacted_count,
              emails_sent_count: s.emails_sent_count,
              open_count: s.open_count,
              open_rate: openRate,
              reply_count: s.reply_count,
              reply_rate: replyRate,
              bounced_count: s.bounced_count,
            };
          });

          auditToolCall({
            role,
            tool: "get_campaign_analytics",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "get_campaign_analytics",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: list_leads
    server.registerTool(
      "list_leads",
      {
        description:
          "Search and list leads in Instantly with optional filtering by campaign or search term. " +
          "Use this to inspect recipient contacts, job titles, and status. " +
          "Returns sanitized lead records (email, name, company, title, status) and pagination cursor. " +
          "Strings are truncated to prevent prompt injection. Does NOT send emails or delete leads.",
        inputSchema: {
          campaign_id: z
            .string()
            .max(100)
            .optional()
            .describe("Filter leads belonging to a specific campaign ID"),
          list_id: z
            .string()
            .max(100)
            .optional()
            .describe("Filter leads belonging to a specific list ID"),
          search: z
            .string()
            .max(100)
            .optional()
            .describe("Search lead email, name, or company"),
          filter: z
            .string()
            .max(50)
            .optional()
            .describe(
              "Filter criteria (e.g. FILTER_VAL_CONTACTED, FILTER_LEAD_INTERESTED, FILTER_VAL_ACTIVE)"
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe("Number of leads to return (default 20, max 50)"),
          starting_after: z
            .string()
            .max(100)
            .optional()
            .describe("Pagination cursor from previous next_starting_after"),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({ role, tool: "list_leads", success: false, error: "Unauthorized" });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          const res = await instantlyClient.listLeads({
            campaign: args.campaign_id,
            list_id: args.list_id,
            search: args.search,
            filter: args.filter,
            limit: args.limit,
            starting_after: args.starting_after,
          });

          const items = res.items.map((lead) => ({
            id: lead.id,
            email: sanitizeString(lead.email, 100),
            first_name: sanitizeString(lead.first_name, 50),
            last_name: sanitizeString(lead.last_name, 50),
            company_name: sanitizeString(lead.company_name, 100),
            job_title: sanitizeString(lead.job_title, 80),
            status: lead.status ? String(lead.status) : "uncontacted",
            campaign: lead.campaign || null,
          }));

          auditToolCall({
            role,
            tool: "list_leads",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    leads: items,
                    count: items.length,
                    next_starting_after: res.next_starting_after || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "list_leads",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: list_email_accounts
    server.registerTool(
      "list_email_accounts",
      {
        description:
          "List connected sending email accounts with their status, warmup state, and daily limits. " +
          "Use this to monitor mailbox health and detect connection errors or paused mailboxes. " +
          "Returns account email, health status, provider type, and warmup indicator. " +
          "Does NOT disconnect or modify mailboxes.",
        inputSchema: {
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(20)
            .describe("Number of accounts to return (default 20, max 50)"),
          starting_after: z
            .string()
            .max(100)
            .optional()
            .describe("Pagination cursor from previous next_starting_after"),
          search: z
            .string()
            .max(100)
            .optional()
            .describe("Filter by email address substring"),
          status: z
            .number()
            .int()
            .optional()
            .describe(
              "Filter by status (1: Active, 2: Paused, -1: Connection Error, -2: Soft Bounce, -3: Sending Error)"
            ),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({
            role,
            tool: "list_email_accounts",
            success: false,
            error: "Unauthorized",
          });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          const res = await instantlyClient.listEmailAccounts({
            limit: args.limit,
            starting_after: args.starting_after,
            search: args.search,
            status: args.status,
          });

          const items = res.items.map((acc) => ({
            id: acc.id,
            email: sanitizeString(acc.email, 100),
            status: formatAccountStatus(acc.status),
            statusCode: acc.status,
            provider_code: acc.provider_code,
            warmup_status: acc.warmup_status === 1 ? "Warmup Enabled" : "Warmup Off",
            daily_limit: acc.daily_limit ?? null,
          }));

          auditToolCall({
            role,
            tool: "list_email_accounts",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    accounts: items,
                    count: items.length,
                    next_starting_after: res.next_starting_after || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "list_email_accounts",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: get_workspace_summary
    server.registerTool(
      "get_workspace_summary",
      {
        description:
          "Consolidates workspace health into ONE compact executive summary: " +
          "campaign counts by status (active, paused, draft, unhealthy), account health breakdown (active, paused, errors), " +
          "and headline outreach performance stats (leads, emails sent, opens, replies, reply rate %). " +
          "Use this as the first tool call to get a comprehensive overview of workspace performance without multiple round trips.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async () => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "viewer")) {
          auditToolCall({
            role,
            tool: "get_workspace_summary",
            success: false,
            error: "Unauthorized",
          });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: viewer role required" }],
          };
        }

        try {
          // Parallel fetch of campaigns, accounts, analytics, and workspace details
          const [ws, campaignsRes, accountsRes, analytics] = await Promise.all([
            instantlyClient.getCurrentWorkspace().catch(() => null),
            instantlyClient.listCampaigns({ limit: 50 }),
            instantlyClient.listEmailAccounts({ limit: 50 }),
            instantlyClient.getCampaignAnalytics(),
          ]);

          // Campaign counts by status
          const campaignCounts = {
            total: campaignsRes.items.length,
            active: campaignsRes.items.filter((c) => c.status === 1).length,
            paused: campaignsRes.items.filter((c) => c.status === 2).length,
            draft: campaignsRes.items.filter((c) => c.status === 0).length,
            unhealthyOrError: campaignsRes.items.filter((c) => c.status < 0).length,
          };

          // Email accounts health
          const accountCounts = {
            total: accountsRes.items.length,
            active: accountsRes.items.filter((a) => a.status === 1).length,
            paused: accountsRes.items.filter((a) => a.status === 2).length,
            errorOrDisconnected: accountsRes.items.filter((a) => a.status < 0).length,
          };

          // Headline performance aggregates
          let totalLeads = 0;
          let totalContacted = 0;
          let totalSent = 0;
          let totalOpens = 0;
          let totalReplies = 0;
          let totalBounces = 0;

          for (const a of analytics) {
            totalLeads += a.leads_count || 0;
            totalContacted += a.contacted_count || 0;
            totalSent += a.emails_sent_count || 0;
            totalOpens += a.open_count || 0;
            totalReplies += a.reply_count || 0;
            totalBounces += a.bounced_count || 0;
          }

          const openRate =
            totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) + "%" : "0%";
          const replyRate =
            totalContacted > 0 ? ((totalReplies / totalContacted) * 100).toFixed(1) + "%" : "0%";

          const summary = {
            workspace: {
              id: ws?.id || "unknown",
              name: ws?.name ? sanitizeString(ws.name, 100) : "Instantly Workspace",
            },
            campaigns: campaignCounts,
            email_accounts: accountCounts,
            headline_metrics: {
              total_leads: totalLeads,
              total_contacted: totalContacted,
              emails_sent: totalSent,
              opens: totalOpens,
              open_rate: openRate,
              replies: totalReplies,
              reply_rate: replyRate,
              bounces: totalBounces,
            },
          };

          auditToolCall({
            role,
            tool: "get_workspace_summary",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "get_workspace_summary",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );
  }

  // ==========================================
  // 2. OPERATOR TOOLS (Write / Action)
  // ==========================================

  if (isRoleAuthorized(role, "operator")) {
    // Tool: add_lead
    server.registerTool(
      "add_lead",
      {
        description:
          "Add a single new prospect lead to an Instantly campaign or list. " +
          "Use this to enroll a qualified contact into outreach sequences. " +
          "Returns created lead identifier and confirmation. Does NOT send immediate ad-hoc emails directly.",
        inputSchema: {
          email: z.string().email("Valid email required").max(150).describe("Lead email address"),
          campaign: z
            .string()
            .max(100)
            .optional()
            .describe("Campaign ID to attach the lead to"),
          list_id: z
            .string()
            .max(100)
            .optional()
            .describe("List ID to attach the lead to"),
          first_name: z.string().max(100).optional().describe("Lead's first name"),
          last_name: z.string().max(100).optional().describe("Lead's last name"),
          company_name: z.string().max(120).optional().describe("Company or organization name"),
          job_title: z.string().max(120).optional().describe("Job title or role"),
          phone: z.string().max(40).optional().describe("Phone number"),
          website: z.string().url().max(150).optional().describe("Lead or company website"),
          custom_variables: z
            .record(z.union([z.string().max(200), z.number(), z.boolean()]))
            .optional()
            .describe("Custom personalization variables"),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "operator")) {
          auditToolCall({ role, tool: "add_lead", success: false, error: "Unauthorized" });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: operator role required" }],
          };
        }

        try {
          const lead = await instantlyClient.addLead({
            email: args.email,
            campaign: args.campaign,
            list_id: args.list_id,
            first_name: args.first_name,
            last_name: args.last_name,
            company_name: args.company_name,
            job_title: args.job_title,
            phone: args.phone,
            website: args.website,
            custom_variables: args.custom_variables,
          });

          auditToolCall({
            role,
            tool: "add_lead",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: "Lead added successfully",
                    lead_id: lead.id,
                    email: sanitizeString(lead.email, 100),
                    campaign: lead.campaign || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "add_lead",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );

    // Tool: pause_campaign
    server.registerTool(
      "pause_campaign",
      {
        description:
          "Safely pause an active cold email campaign. " +
          "Use this to immediately halt outgoing sequence emails during maintenance, negative sentiment surges, or deliverability reviews. " +
          "Returns updated campaign status. Does NOT delete the campaign or its leads.",
        inputSchema: {
          id: z.string().min(1).max(100).describe("Campaign ID to pause"),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        if (!isRoleAuthorized(role, "operator")) {
          auditToolCall({ role, tool: "pause_campaign", success: false, error: "Unauthorized" });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: operator role required" }],
          };
        }

        try {
          const res = await instantlyClient.pauseCampaign(args.id);

          auditToolCall({
            role,
            tool: "pause_campaign",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: "Campaign paused successfully",
                    campaign_id: res.id,
                    campaign_name: sanitizeString(res.name, 120),
                    status: formatCampaignStatus(res.status),
                    statusCode: res.status,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "pause_campaign",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );
  }

  // ==========================================
  // 3. ADMIN TOOLS (Protected / Destructive)
  // ==========================================

  // Only expose activate_campaign if the role is admin AND ENABLE_ADMIN_TOOLS is enabled
  if (isRoleAuthorized(role, "admin") && config.ENABLE_ADMIN_TOOLS) {
    server.registerTool(
      "activate_campaign",
      {
        description:
          "Activate or resume an outreach campaign, starting scheduled email delivery to all enrolled leads. " +
          "CRITICAL: Requires admin role, ENABLE_ADMIN_TOOLS=true, and explicit confirmation (confirm: true). " +
          "Returns updated campaign status.",
        inputSchema: {
          id: z.string().min(1).max(100).describe("ID of the campaign to activate or resume"),
          confirm: z
            .boolean()
            .describe("Explicit confirmation boolean. Must be true to trigger live email sending."),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async (args) => {
        const startTime = Date.now();
        // Secondary in-handler guards:
        if (!isRoleAuthorized(role, "admin")) {
          auditToolCall({
            role,
            tool: "activate_campaign",
            success: false,
            error: "Unauthorized",
          });
          return {
            isError: true,
            content: [{ type: "text", text: "Unauthorized: admin role required" }],
          };
        }

        if (!config.ENABLE_ADMIN_TOOLS) {
          auditToolCall({
            role,
            tool: "activate_campaign",
            success: false,
            error: "ENABLE_ADMIN_TOOLS disabled",
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Admin tools are disabled on this server (ENABLE_ADMIN_TOOLS=false).",
              },
            ],
          };
        }

        if (args.confirm !== true) {
          auditToolCall({
            role,
            tool: "activate_campaign",
            success: false,
            error: "Missing confirmation",
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Refusing to activate campaign: confirm must be explicitly true.",
              },
            ],
          };
        }

        try {
          const res = await instantlyClient.activateCampaign(args.id);

          auditToolCall({
            role,
            tool: "activate_campaign",
            success: true,
            durationMs: Date.now() - startTime,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: "Campaign activated successfully",
                    campaign_id: res.id,
                    campaign_name: sanitizeString(res.name, 120),
                    status: formatCampaignStatus(res.status),
                    statusCode: res.status,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          const message = formatActionableErrorMessage(err);
          auditToolCall({
            role,
            tool: "activate_campaign",
            success: false,
            durationMs: Date.now() - startTime,
            error: message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      }
    );
  }

  return server;
}
