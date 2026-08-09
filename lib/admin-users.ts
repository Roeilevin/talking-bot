import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import { DASHBOARD_ACCESS_FLAG } from "./auth";

// Dashboard account management, backed by the Supabase Auth admin API. Requires
// the service-role key, so this module is server-only — never import it from a
// client component.

export const MIN_PASSWORD_LENGTH = 10;

let client: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error(
      "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export interface DashboardUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  hasAccess: boolean;
}

interface RawUser {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

function toDashboardUser(u: RawUser): DashboardUser {
  return {
    id: u.id,
    email: u.email ?? "",
    createdAt: u.created_at ?? "",
    lastSignInAt: u.last_sign_in_at ?? null,
    hasAccess: u.app_metadata?.[DASHBOARD_ACCESS_FLAG] === true,
  };
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function listDashboardUsers(): Promise<DashboardUser[]> {
  const { data, error } = await admin().auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw error;
  return (data.users as RawUser[])
    .map(toDashboardUser)
    .sort((a, b) => a.email.localeCompare(b.email));
}

// Creates a confirmed account (no email round-trip — this is an internal tool)
// and grants it dashboard access.
export async function createDashboardUser(
  email: string,
  password: string
): Promise<DashboardUser> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { [DASHBOARD_ACCESS_FLAG]: true },
  });
  if (error) throw error;
  return toDashboardUser(data.user as RawUser);
}

export async function setDashboardUserPassword(
  id: string,
  password: string
): Promise<void> {
  const { error } = await admin().auth.admin.updateUserById(id, { password });
  if (error) throw error;
}

// Revoking access leaves the account in place but locks it out of the dashboard.
export async function setDashboardUserAccess(
  id: string,
  hasAccess: boolean
): Promise<void> {
  const { error } = await admin().auth.admin.updateUserById(id, {
    app_metadata: { [DASHBOARD_ACCESS_FLAG]: hasAccess },
  });
  if (error) throw error;
}

export async function deleteDashboardUser(id: string): Promise<void> {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error) throw error;
}
