export interface InstantlyCampaign {
  id: string;
  name: string;
  status: number;
  is_evergreen?: boolean | null;
  pl_value?: number | null;
  timestamp_created?: string;
  timestamp_updated?: string;
  campaign_schedule?: {
    start_date?: string | null;
    end_date?: string | null;
    schedules?: Array<{
      name?: string;
      timing?: { from: string; to: string };
      timezone?: string;
    }>;
  };
  sequences?: Array<{
    steps?: Array<{
      type: string;
      delay: number;
      delay_unit?: string;
      variants?: Array<{
        subject: string;
        body: string;
        v_disabled?: boolean;
      }>;
    }>;
  }>;
}

export interface InstantlyCampaignAnalytics {
  campaign_id: string;
  campaign_name: string;
  campaign_status: number;
  leads_count: number;
  contacted_count: number;
  emails_sent_count: number;
  new_leads_contacted_count?: number;
  open_count: number;
  reply_count: number;
  bounced_count: number;
  unsubscribed_count?: number;
  completed_count?: number;
}

export interface InstantlyLead {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: number | string | null;
  campaign?: string | null;
  list_id?: string | null;
  custom_variables?: Record<string, any> | null;
  timestamp_created?: string;
}

export interface InstantlyAccount {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  status: number; // 1: Active, 2: Paused, 3: Temp Paused, -1: Connection Error, -2: Soft Bounce, -3: Sending Error
  provider_code?: number;
  warmup_status?: number;
  daily_limit?: number;
  timestamp_created?: string;
}

export interface InstantlyWorkspace {
  id: string;
  name: string;
  owner?: string;
  plan_id?: string | null;
  plan_id_bundle?: string | null;
  timestamp_created?: string;
}

export interface ListResponse<T> {
  items: T[];
  next_starting_after?: string;
}
