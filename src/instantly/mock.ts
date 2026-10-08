import type {
  InstantlyAccount,
  InstantlyCampaign,
  InstantlyCampaignAnalytics,
  InstantlyLead,
  InstantlyWorkspace,
  ListResponse,
} from "./types.js";
import { InstantlyApiError } from "./errors.js";

// In-memory mutable state for mock mode so demo interactions persist across requests
class MockDatabase {
  public campaigns: InstantlyCampaign[] = [
    {
      id: "01956fbd-0eb1-72db-a565-82977a586001",
      name: "Q4 Enterprise Outreach - Fintech",
      status: 1, // Active
      is_evergreen: true,
      pl_value: 500,
      timestamp_created: "2026-09-01T10:00:00.000Z",
      timestamp_updated: "2026-10-01T12:00:00.000Z",
      campaign_schedule: {
        start_date: "2026-09-01",
        end_date: null,
        schedules: [
          {
            name: "US Business Hours",
            timing: { from: "09:00", to: "17:00" },
            timezone: "America/New_York",
          },
        ],
      },
      sequences: [
        {
          steps: [
            {
              type: "email",
              delay: 0,
              delay_unit: "days",
              variants: [
                {
                  subject: "Modernizing compliance workflows at {{companyName}}",
                  body: "Hi {{firstName}}, noticed your recent expansion in payments infrastructure...",
                  v_disabled: false,
                },
              ],
            },
            {
              type: "email",
              delay: 3,
              delay_unit: "days",
              variants: [
                {
                  subject: "Quick follow up regarding compliance efficiency",
                  body: "Hi {{firstName}}, sharing a quick case study on how similar teams cut cycle times...",
                  v_disabled: false,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586002",
      name: "SMB Inbound Product Tour Follow-up",
      status: 2, // Paused
      is_evergreen: false,
      pl_value: 150,
      timestamp_created: "2026-08-15T08:30:00.000Z",
      timestamp_updated: "2026-09-20T16:45:00.000Z",
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586003",
      name: "AI SDR Cold Pilot (Draft)",
      status: 0, // Draft
      is_evergreen: false,
      pl_value: null,
      timestamp_created: "2026-10-05T14:15:00.000Z",
      timestamp_updated: "2026-10-05T14:15:00.000Z",
    },
  ];

  public analytics: InstantlyCampaignAnalytics[] = [
    {
      campaign_id: "01956fbd-0eb1-72db-a565-82977a586001",
      campaign_name: "Q4 Enterprise Outreach - Fintech",
      campaign_status: 1,
      leads_count: 1450,
      contacted_count: 1120,
      emails_sent_count: 3200,
      new_leads_contacted_count: 350,
      open_count: 1840,
      reply_count: 142,
      bounced_count: 18,
      unsubscribed_count: 12,
      completed_count: 850,
    },
    {
      campaign_id: "01956fbd-0eb1-72db-a565-82977a586002",
      campaign_name: "SMB Inbound Product Tour Follow-up",
      campaign_status: 2,
      leads_count: 620,
      contacted_count: 610,
      emails_sent_count: 1580,
      new_leads_contacted_count: 0,
      open_count: 920,
      reply_count: 88,
      bounced_count: 6,
      unsubscribed_count: 8,
      completed_count: 610,
    },
    {
      campaign_id: "01956fbd-0eb1-72db-a565-82977a586003",
      campaign_name: "AI SDR Cold Pilot (Draft)",
      campaign_status: 0,
      leads_count: 50,
      contacted_count: 0,
      emails_sent_count: 0,
      new_leads_contacted_count: 0,
      open_count: 0,
      reply_count: 0,
      bounced_count: 0,
      unsubscribed_count: 0,
      completed_count: 0,
    },
  ];

  public accounts: InstantlyAccount[] = [
    {
      id: "01956fbd-0eb1-72db-a565-82977a586101",
      email: "sarah.chen@acme-growth.com",
      first_name: "Sarah",
      last_name: "Chen",
      status: 1, // Active
      provider_code: 2, // Google
      warmup_status: 1,
      daily_limit: 40,
      timestamp_created: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586102",
      email: "alex.rivera@acme-growth.com",
      first_name: "Alex",
      last_name: "Rivera",
      status: 1, // Active
      provider_code: 3, // Microsoft
      warmup_status: 1,
      daily_limit: 40,
      timestamp_created: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586103",
      email: "outreach-backup@acme-connect.net",
      first_name: "Outreach",
      last_name: "Backup",
      status: 2, // Paused
      provider_code: 1, // Custom SMTP
      warmup_status: 0,
      daily_limit: 25,
      timestamp_created: "2026-07-20T00:00:00.000Z",
    },
  ];

  public leads: InstantlyLead[] = [
    {
      id: "01956fbd-0eb1-72db-a565-82977a586201",
      email: "jordan.taylor@globalpayments.corp",
      first_name: "Jordan",
      last_name: "Taylor",
      company_name: "Global Payments Corp",
      job_title: "VP Engineering",
      phone: "+1-555-019-2831",
      website: "https://globalpayments.example",
      status: "FILTER_LEAD_INTERESTED",
      campaign: "01956fbd-0eb1-72db-a565-82977a586001",
      timestamp_created: "2026-09-05T11:22:00.000Z",
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586202",
      email: "elena.rostova@neobank-tech.io",
      first_name: "Elena",
      last_name: "Rostova",
      company_name: "NeoBank Technologies",
      job_title: "Head of Operations",
      phone: "+1-555-019-4492",
      website: "https://neobank-tech.example",
      status: "FILTER_VAL_CONTACTED",
      campaign: "01956fbd-0eb1-72db-a565-82977a586001",
      timestamp_created: "2026-09-10T14:05:00.000Z",
    },
    {
      id: "01956fbd-0eb1-72db-a565-82977a586203",
      email: "marcus.vance@vanceanalytics.co",
      first_name: "Marcus",
      last_name: "Vance",
      company_name: "Vance Analytics",
      job_title: "Founder & CEO",
      phone: null,
      website: "https://vanceanalytics.example",
      status: "FILTER_VAL_NOT_CONTACTED",
      campaign: "01956fbd-0eb1-72db-a565-82977a586002",
      timestamp_created: "2026-09-22T09:18:00.000Z",
    },
  ];

  public workspace: InstantlyWorkspace = {
    id: "01956fbd-0eb1-72db-a565-82977a586999",
    name: "Acme Enterprise Production Workspace",
    owner: "01956fbd-0eb1-72db-a565-82977a586000",
    plan_id: "hypergrowth_v2",
    plan_id_bundle: "scale_bundle",
    timestamp_created: "2026-01-15T00:00:00.000Z",
  };
}

export const mockDb = new MockDatabase();
