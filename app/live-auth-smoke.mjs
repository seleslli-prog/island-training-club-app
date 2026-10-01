// Focused regression for the Supabase OAuth -> synchronous view handoff.
// Run directly with: node app/live-auth-smoke.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirnameSmoke = dirname(fileURLToPath(import.meta.url));

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};

const authUser = {
  id: "live-user-1",
  email: "runner@example.com",
  user_metadata: {
    full_name: "Riley Runner",
    avatar_url: "https://example.com/avatar.jpg",
  },
};
const profile = {
  id: authUser.id,
  email: authUser.email,
  full_name: "Riley Runner",
  avatar_url: authUser.user_metadata.avatar_url,
  role: "super_admin",
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
};
const applicationRows = new Map([
  [
    authUser.id,
    {
      profile_id: authUser.id,
      mobile: "+852 6123 4567",
      date_of_birth: null,
      is_minor: false,
      guardian_name: null,
      guardian_phone: null,
      emergency_name: "Taylor Coach",
      emergency_relationship: "Coach",
      emergency_phone: "+852 6777 8888",
      heard_source: "instagram",
      heard_detail: "Coach post",
      preferred_name: "Riley",
      photo_consent: true,
      waiver_accepted_at: "2026-08-05T01:00:00.000Z",
      waiver_signature_text: "Riley Runner",
      waiver_signed_at: "2026-08-05",
      waiver_form_version: "v1",
      privacy_accepted_at: "2026-08-05T01:05:00.000Z",
      guidelines_accepted_at: "2026-08-05T01:10:00.000Z",
      submitted_at: "2026-08-05T01:15:00.000Z",
      whatsapp_reminders: false,
      email_receipts: true,
      community_news: true,
      web_push_ops: false,
    },
  ],
]);
const notificationRows = [
  {
    id: 'notification-admin-application',
    kind: 'admin_application_submitted',
    title: 'Application <submitted>',
    body: 'Review Riley & approve.',
    created_at: '2026-08-05T06:35:00.000Z',
    read_at: null,
  },
  {
    id: 'notification-admin-role',
    kind: 'admin_role_changed',
    title: 'Role changed',
    body: 'A member role changed.',
    created_at: '2026-08-05T04:40:00.000Z',
    read_at: '2026-08-05T05:00:00.000Z',
  },
  {
    id: 'notification-welcome',
    kind: 'welcome',
    title: 'Welcome to ITC',
    body: 'Your membership is ready.',
    created_at: '2026-08-05T06:32:00.000Z',
    read_at: null,
  },
  {
    id: 'notification-malformed',
    kind: null,
    title: 'Imported notification',
    body: 'This row has incomplete metadata.',
    created_at: 'not-a-date',
    read_at: '2026-08-05T06:39:00.000Z',
  },
];
const approvedProfiles = [
  {
    id: "approved-admin",
    email: "tina.admin@example.com",
    full_name: "Tina Admin",
    role: "admin",
    created_at: "2026-08-05T01:00:00.000Z",
  },
  {
    id: "approved-member",
    email: "micah.member@example.com",
    full_name: "Micah Member",
    role: "member",
    created_at: "2026-08-05T02:00:00.000Z",
  },
];
const pendingProfiles = [
  {
    id: "pending-submitted",
    email: "submitted@example.com",
    full_name: "Submitted Runner",
    role: "pending",
    created_at: "2026-08-05T03:00:00.000Z",
  },
  {
    id: "pending-incomplete",
    email: "incomplete@example.com",
    full_name: "Incomplete Runner",
    role: "pending",
    created_at: "2026-08-05T04:00:00.000Z",
  },
];
const declinedProfiles = [
  {
    id: "declined-member",
    email: "declined@example.com",
    full_name: "Declined Runner",
    role: "declined",
    created_at: "2026-08-05T05:00:00.000Z",
  },
];
function operationalRoleFor(profileId) {
  if (profileId === profile.id) return profile.role;
  return [...approvedProfiles, ...pendingProfiles, ...declinedProfiles]
    .find((item) => item.id === profileId)?.role || null;
}
applicationRows.set("pending-submitted", {
  ...structuredClone(applicationRows.get(authUser.id)),
  profile_id: "pending-submitted",
  profiles: pendingProfiles[0],
});
const applicationUpdates = [];
const profileUpdates = [];
let applicationReadError = null;
let applicationReadGate = null;
const applicationReadGates = [];
let notificationReadError = null;
let notificationReadGate = null;
let notificationQueryCount = 0;
const notificationUpdates = [];
let notificationUpdateError = null;
let notificationUpdateResult = "row";
let notificationUpdateGate = null;
let profileListError = null;
let profileListErrorAfterUpdate = null;
let applicationListError = null;
let profileUpdateError = null;
let profileUpdateResult = "row";
let profileUpdateGate = null;
let activeGivingCampaignRow = null;
let activeGivingCampaignError = null;
let givingCampaignListError = null;
let givingCampaignRows = [];
let operationalRpcHandler = null;
let operationalAuthSubOverride = null;
let operationalVenueOverrideReadError = null;
const operationalSessionRelationshipReadErrors = new Map();
let operationalRsvpCountError = null;
let operationalRsvpCountRowsOverride = null;
let operationalAttendanceError = null;
const operationalRpcCalls = [];
const prayerRpcCalls = [];
const prayerRpcErrors = new Map();
let prayerRpcGate = null;
const PRAYER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PRAYER_ID = "22222222-2222-4222-8222-222222222222";
const prayerMemberRow = {
  id: PRAYER_ID,
  request_text: "Prayer",
  anonymous_to_leaders: true,
  status: "new",
  created_at: "2026-08-05T02:00:00.000Z",
  updated_at: "2026-08-05T02:00:00.000Z",
  closed_at: null,
  withdrawn_at: null,
};
const prayerAdminRow = {
  id: SECOND_PRAYER_ID,
  display_name: "Anonymous member",
  request_text: "A private live concern",
  anonymous_to_leaders: true,
  status: "prayed_for",
  created_at: "2026-08-05T01:00:00.000Z",
  updated_at: "2026-08-05T02:00:00.000Z",
  closed_at: null,
};
const prayerRpcNames = new Set([
  "submit_prayer_request",
  "list_my_prayer_requests",
  "set_my_prayer_request_state",
  "list_admin_prayer_requests",
  "set_admin_prayer_request_status",
]);
const prayerRpcResult = (name) => {
  if (name === "submit_prayer_request") return [structuredClone(prayerMemberRow)];
  if (name === "list_my_prayer_requests") return [structuredClone(prayerMemberRow)];
  if (name === "set_my_prayer_request_state") {
    return [{
      ...structuredClone(prayerMemberRow),
      request_text: null,
      status: "withdrawn",
      updated_at: "2026-08-05T02:05:00.000Z",
      withdrawn_at: "2026-08-05T02:05:00.000Z",
    }];
  }
  if (name === "list_admin_prayer_requests") return [structuredClone(prayerAdminRow)];
  if (name === "set_admin_prayer_request_status") {
    return [{
      ...structuredClone(prayerAdminRow),
      status: "closed",
      updated_at: "2026-08-05T02:10:00.000Z",
      closed_at: "2026-08-05T02:10:00.000Z",
    }];
  }
  return null;
};
const operationalPayoutDirectReads = [];
const operationalSessionQueries = [];
const operationalTableQueries = [];
const operationalSubscriptions = [];
const fixtureMember = { id: "approved-member" };
const operationalTableRows = {
  operational_sessions: [],
  operational_hyrox_cycles: [{
    id: "hyrox-pool-2099-01-03",
    session_date: "2099-01-03",
    bft_session_id: "hyrox-bft-2099-01-03",
    midtown_session_id: "hyrox-midtown-2099-01-03",
    registration_state: "open",
    venue_plan: "pending",
    registration_capacity: 32,
    registration_opens_at: "2098-12-29T10:00:00.000Z",
    payment_deadline_at: "2099-01-01T10:00:00.000Z",
    holder_grace_deadline_at: "2099-01-01T11:00:00.000Z",
    promoted_payment_deadline_at: "2099-01-01T12:00:00.000Z",
    venue_choice_deadline_at: "2099-01-02T13:00:00.000Z",
    capacity_warning_sent_at: null,
    payment_reminder_sent_at: null,
    holder_grace_started_at: null,
    waitlist_promoted_at: null,
    reconciliation_started_at: null,
    opened_at: "2098-12-29T10:00:00.000Z",
    plan_confirmed_at: null,
    plan_confirmed_by: null,
    plan_confirmed_source: null,
    allocation_closed_at: null,
    cancelled_at: null,
    cancel_reason: null,
  }],
  operational_hyrox_queue_entries: [{
    id: "hyrox-queue-1",
    cycle_id: "hyrox-pool-2099-01-03",
    profile_id: fixtureMember.id,
    kind: "weekly_waitlist",
    target_session_id: null,
    venue_preference: "midtown",
    fallback_acknowledged_at: "2098-12-29T10:01:00.000Z",
    status: "active",
    joined_at: "2098-12-29T10:02:00.000Z",
    resolved_at: null,
  }],
  operational_activity_templates: [
    { activity_id: "hyrox-bft", name: "ITC HYROX", venue: "BFT Causeway Bay", weekday: 6, start_time: "11:15:00", duration_minutes: 60, capacity: 20, price_hkd: 180, default_open: true, active: true, category: "HYROX", maps_query: null, requires_rsvp: false },
    { activity_id: "hyrox-midtown", name: "ITC HYROX", venue: "Midtown 28", weekday: 6, start_time: "11:00:00", duration_minutes: 60, capacity: 12, price_hkd: 180, default_open: false, active: true, category: "HYROX", maps_query: null, requires_rsvp: false },
    { activity_id: "hyrox-quarry-bay-early", name: "ITC HYROX", venue: "10/F, Island ECC, Quarry Bay", weekday: 6, start_time: "09:15:00", duration_minutes: 60, capacity: 30, price_hkd: 180, default_open: true, active: true, category: "HYROX", maps_query: "Island ECC, Quarry Bay, Hong Kong", requires_rsvp: false },
    { activity_id: "hyrox-quarry-bay", name: "ITC HYROX", venue: "10/F, Island ECC, Quarry Bay", weekday: 6, start_time: "10:30:00", duration_minutes: 60, capacity: 30, price_hkd: 180, default_open: true, active: true, category: "HYROX", maps_query: "Island ECC, Quarry Bay, Hong Kong", requires_rsvp: false },
    { activity_id: "wnt", name: "Wednesday Night Training", venue: "TBC", weekday: 3, start_time: "19:30:00", duration_minutes: 60, capacity: null, price_hkd: 0, default_open: true, active: true, category: "Strength", maps_query: null, requires_rsvp: true },
    { activity_id: "run", name: "ITC Run Club", venue: "TBC", weekday: 1, start_time: "19:30:00", duration_minutes: 45, capacity: null, price_hkd: 0, default_open: true, active: true, category: "Run", maps_query: null, requires_rsvp: true },
    { activity_id: "water", name: "ITC Swimming", venue: "TBC", weekday: 2, start_time: "19:30:00", duration_minutes: 90, capacity: null, price_hkd: 0, default_open: true, active: true, category: "Water", maps_query: null, requires_rsvp: true },
    { activity_id: "lunch", name: "Post-Training Lunch", venue: "TBC", weekday: 6, start_time: "12:45:00", duration_minutes: 75, capacity: null, price_hkd: 0, default_open: true, active: true, category: "Socials", maps_query: null, requires_rsvp: true },
  ],
  operational_bookings: [{
    id: "pooled-booking",
    profile_id: fixtureMember.id,
    session_id: null,
    hyrox_cycle_id: "hyrox-pool-2099-01-03",
    status: "reserved",
    reserved_at: "2098-12-29T10:03:00.000Z",
    pay_deadline_at: "2099-01-01T11:00:00.000Z",
    payment_marked_at: null,
    payment_method: null,
    payment_reference: null,
    paid_at: null,
    confirmed_by: null,
    deferred_from_booking_id: null,
    deferred_to_booking_id: null,
    venue_preference: "midtown",
    fallback_acknowledged_at: "2098-12-29T10:03:00.000Z",
    promoted_from_waitlist_at: null,
    allocation_state: null,
    allocation_source: null,
    allocated_at: null,
    allocation_snapshot: null,
    payment_rejected_at: null,
    payment_rejected_by: null,
    payment_rejection_reason: null,
    attended_at: null,
    attended_by: null,
    snapshot: {
      name: "ITC HYROX",
      booking_mode: "weekly_pool",
      session_date: "2099-01-03",
      price_hkd: 180,
    },
    created_at: "2098-12-29T10:03:00.000Z",
    updated_at: "2098-12-29T10:03:00.000Z",
  }],
  operational_queue_entries: [],
  operational_receipts: [{
    id: "pooled-receipt",
    receipt_number: "ITC-2099-POOL",
    booking_id: "pooled-booking",
    profile_id: fixtureMember.id,
    session_id: null,
    hyrox_cycle_id: "hyrox-pool-2099-01-03",
    amount_hkd: 180,
    currency: "HKD",
    payment_method: "fps",
    status: "paid",
    issued_at: "2098-12-29T10:04:00.000Z",
  }],
  collector_assignments: [{
    week_start: "2099-01-03",
    collector_profile_id: fixtureMember.id,
    assigned_by: "approved-admin",
    assigned_at: "2098-12-29T09:00:00.000Z",
  }],
  collector_payout_profiles: [],
  operational_session_venue_overrides: [{
    session_id: "wnt-2026-08-26",
    activity_id: "wnt",
    location: "Tamar Park",
    maps_query: "Tamar Park",
    meeting_lat: 22.2825,
    meeting_lng: 114.1659,
    set_by: "live-admin",
    set_at: "2026-08-05T02:00:00.000Z",
    member_notified_at: "2026-08-05T02:00:00.000Z",
  }],
};
let authStateChangeHandler = null;
let authCallbackLocked = false;
let oauthCalls = 0;
let oauthOptions = null;
let releaseOAuth = null;
let magicLinkCalls = 0;
let magicLinkOptions = null;
let releaseMagicLink = null;
let signOutCalls = 0;
let releaseSignOut = null;
const avatarFunctionCalls = [];
const avatarResolveCalls = [];
let avatarInvokeError = null;
let avatarModerationError = null;
let avatarModerationGate = null;
let avatarResolveStatus = 200;
let avatarPresentation = {
  profileId: authUser.id,
  url: "https://example.supabase.co/storage/v1/object/sign/profile-avatars/live-user-1/google.jpg?token=test-token",
  source: "google",
  state: "active",
  expiresAt: "2026-08-05T02:10:00.000Z",
};
const avatarSessionRows = [
  {
    profileId: "attendee-live-1",
    displayName: "Alex T.",
    url: "https://example.supabase.co/storage/v1/object/sign/profile-avatars/attendee-live-1/custom.jpg?token=attendee-token",
    source: "custom",
    state: "active",
    expiresAt: "2026-08-05T02:10:00.000Z",
  },
];
const avatarAdminRows = [
  {
    profileId: "approved-admin",
    displayName: "Tina Admin",
    url: "https://example.supabase.co/storage/v1/object/sign/profile-avatars/approved-admin/custom.jpg?token=admin-active-token",
    source: "custom",
    state: "active",
    expiresAt: "2026-08-05T02:10:00.000Z",
    pendingPreviewUrl: null,
    moderationReason: null,
    moderatedAt: null,
  },
  {
    profileId: "approved-member",
    displayName: "Micah Member",
    url: null,
    source: "initials",
    state: "pending_review",
    expiresAt: null,
    pendingPreviewUrl: "https://example.supabase.co/storage/v1/object/sign/profile-avatars/approved-member/pending.jpg?token=admin-pending-token",
    moderationReason: "Previous photo hidden",
    moderatedAt: "2026-08-05T01:00:00.000Z",
  },
];
const deferredAuthTasks = [];
const LIVE_TABLES_COUNT = 10;
const fixedIso = "2026-08-05T02:00:00.000Z";
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fixedIso]));
  }
  static now() {
    return new RealDate(fixedIso).getTime();
  }
  static parse(value) {
    return RealDate.parse(value);
  }
  static UTC(...args) {
    return RealDate.UTC(...args);
  }
};

let liveSession = {
  access_token: "test-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "test-refresh-token",
  user: authUser,
};
const fakeSupabase = {
  auth: {
    getSession: () => {
      if (authCallbackLocked) {
        throw new Error("getSession must not run while the auth callback lock is held");
      }
      return Promise.resolve({
        data: {
          session: liveSession,
        },
        error: null,
      });
    },
    onAuthStateChange(callback) {
      authStateChangeHandler = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signInWithOAuth(options) {
      oauthCalls++;
      oauthOptions = options;
      return new Promise((resolve) => { releaseOAuth = resolve; });
    },
    signInWithOtp(options) {
      magicLinkCalls++;
      magicLinkOptions = options;
      return new Promise((resolve) => { releaseMagicLink = resolve; });
    },
    signOut() {
      signOutCalls++;
      return new Promise((resolve) => { releaseSignOut = resolve; });
    },
  },
  functions: {
    async invoke(name, options = {}) {
      avatarFunctionCalls.push({ name, options });
      if (name === "moderate-profile-avatar") {
        if (avatarModerationGate) await avatarModerationGate;
        if (avatarModerationError) return { data: null, error: avatarModerationError };
        const command = options.body;
        const row = avatarAdminRows.find((item) => item.profileId === command.profileId);
        if (row) {
          if (command.action === "approve") {
            row.state = "active";
            row.source = "custom";
            row.url = row.pendingPreviewUrl;
            row.pendingPreviewUrl = null;
            row.moderationReason = null;
          } else {
            row.state = "hidden";
            row.source = "initials";
            row.url = null;
            row.pendingPreviewUrl = null;
            row.moderationReason = command.reason;
          }
        }
        return {
          data: {
            presentation: row
              ? {
                profileId: row.profileId,
                url: row.url,
                source: row.source,
                state: row.state,
                expiresAt: row.expiresAt,
              }
              : structuredClone(avatarPresentation),
          },
          error: null,
        };
      }
      if (name !== "process-profile-avatar") throw new Error(`Unexpected function: ${name}`);
      if (avatarInvokeError) return { data: null, error: avatarInvokeError };
      const action = options.body instanceof FormData ? options.body.get("action") : options.body?.action;
      const source = options.method === "DELETE" ? "google" : action === "upload" ? "custom" : "google";
      avatarPresentation = {
        ...avatarPresentation,
        source,
        url: source === "custom"
          ? "https://example.supabase.co/storage/v1/object/sign/profile-avatars/live-user-1/custom.jpg?token=custom-token"
          : "https://example.supabase.co/storage/v1/object/sign/profile-avatars/live-user-1/google.jpg?token=google-token",
      };
      return { data: { presentation: structuredClone(avatarPresentation) }, error: null };
    },
  },
  get storage() {
    throw new Error("Browser avatar code must not use the Supabase Storage client");
  },
  from(table) {
    if (table === "profiles") {
      return {
        select() {
          return {
            eq(column, value) {
              if (column !== "id" || value !== authUser.id) {
                throw new Error("Profile query did not target the signed-in user");
              }
              return {
                maybeSingle: async () => ({ data: profile, error: null }),
              };
            },
            order(column, options) {
              if (column !== "created_at" || options?.ascending !== true) {
                throw new Error("Profile list query should order by created_at ascending");
              }
              return Promise.resolve({
                data: [
                  structuredClone(profile),
                  ...structuredClone(approvedProfiles),
                  ...structuredClone(pendingProfiles),
                  ...structuredClone(declinedProfiles),
                ],
                error: profileListError,
              });
            },
          };
        },
        update(patch) {
          let targetId = null;
          let expectedRole = null;
          const result = {
            eq(column, value) {
              if (column === "id") targetId = value;
              else if (column === "role") expectedRole = value;
              else throw new Error(`Unexpected profile update filter: ${column}`);
              return result;
            },
            select(columns) {
              if (!["id, role", "*"].includes(columns)) {
                throw new Error("Unexpected profile update return columns");
              }
              return {
                single: async () => {
                  if (profileUpdateGate) await profileUpdateGate;
                  const target = targetId === profile.id
                    ? profile
                    : [...approvedProfiles, ...pendingProfiles].find((item) => item.id === targetId);
                  profileUpdates.push({ id: targetId, expectedRole, ...structuredClone(patch) });
                  if (profileUpdateError) return { data: null, error: profileUpdateError };
                  if (profileUpdateResult === "zero" || !target || (expectedRole && target.role !== expectedRole)) {
                    return { data: null, error: null };
                  }
                  Object.assign(target, patch);
                  if (profileListErrorAfterUpdate) profileListError = profileListErrorAfterUpdate;
                  return {
                    data: columns === "*"
                      ? target
                      : { id: targetId, role: target.role },
                    error: null,
                  };
                },
              };
            },
          };
          return result;
        },
      };
    }
    if (table === "notifications") {
      return {
        select(columns) {
          if (columns !== "*") throw new Error("Notification query should select all row fields");
          return {
            async order(column, options) {
              if (column !== "created_at" || options?.ascending !== false) {
                throw new Error("Notifications should be newest first");
              }
              notificationQueryCount++;
              const rows = structuredClone(notificationRows);
              const error = notificationReadError;
              const gate = notificationReadGate;
              notificationReadError = null;
              notificationReadGate = null;
              if (gate) await gate;
              return { data: rows, error };
            },
          };
        },
        update(patch) {
          let targetId = null;
          const result = {
            eq(column, value) {
              if (column !== "id") throw new Error("Notification update should target its id");
              targetId = value;
              return result;
            },
            is(column, value) {
              if (column !== "read_at" || value !== null) {
                throw new Error("Notification update should require an unread row");
              }
              return result;
            },
            select(columns) {
              if (columns !== "id, read_at") {
                throw new Error("Notification update must return id and read_at");
              }
              return {
                single: async () => {
                  notificationUpdates.push({ id: targetId, ...structuredClone(patch) });
                  if (notificationUpdateGate) await notificationUpdateGate;
                  if (notificationUpdateError) return { data: null, error: notificationUpdateError };
                  const row = notificationRows.find((item) => item.id === targetId);
                  if (notificationUpdateResult === "zero" || !row || row.read_at) {
                    return { data: null, error: null };
                  }
                  Object.assign(row, structuredClone(patch));
                  return { data: { id: row.id, read_at: row.read_at }, error: null };
                },
              };
            },
          };
          return result;
        },
      };
    }
    if (table === "giving_campaigns") {
      return {
        select() {
          return {
            order(column, options) {
              if (column !== "created_at" || options?.ascending !== false) {
                throw new Error("Giving campaign list must be newest first");
              }
              return Promise.resolve({
                data: givingCampaignListError ? null : givingCampaignRows,
                error: givingCampaignListError,
              });
            },
            eq(column, value) {
              if (column !== "status" || value !== "published") {
                throw new Error("Active Giving query must target published campaigns");
              }
              return {
                maybeSingle: async () => ({
                  data: structuredClone(activeGivingCampaignRow),
                  error: activeGivingCampaignError,
                }),
              };
            },
          };
        },
      };
    }
    if (table === "applications") {
      return {
        select() {
          return {
            eq(column, value) {
              if (column !== "profile_id" || value !== authUser.id) {
                throw new Error("Application query did not target the signed-in user");
              }
              return {
                maybeSingle: async () => {
                  const readGate = applicationReadGates.shift() || applicationReadGate;
                  if (readGate) await readGate;
                  return {
                    data: structuredClone(applicationRows.get(value) || null),
                    error: applicationReadError,
                  };
                },
              };
            },
            then(resolve, reject) {
              return Promise.resolve({
                data: Array.from(applicationRows.values()).map((row) => structuredClone(row)),
                error: applicationListError,
              }).then(resolve, reject);
            },
          };
        },
        upsert(row) {
          applicationRows.set(row.profile_id, structuredClone(row));
          return Promise.resolve({ data: structuredClone(row), error: null });
        },
        update(patch) {
          return {
            eq(column, value) {
              if (column !== "profile_id" || value !== authUser.id) {
                throw new Error("Application update did not target the signed-in user");
              }
              applicationUpdates.push(structuredClone(patch));
              const next = {
                ...(applicationRows.get(value) || { profile_id: value }),
                ...patch,
              };
              applicationRows.set(value, next);
              return {
                select() {
                  return {
                    single: async () => ({ data: structuredClone(next), error: null }),
                  };
                },
              };
            },
          };
        },
      };
    }
    if (table in operationalTableRows) {
      operationalTableQueries.push(table);
      const rows = operationalTableRows[table];
      const sessionFilters = { since: null, ids: null };
      const result = () => {
        let error = table === "operational_session_venue_overrides"
          ? operationalVenueOverrideReadError
          : table === "operational_hyrox_queue_entries" && !liveSession
            ? { message: "permission denied for table operational_hyrox_queue_entries" }
            : null;
        if (table === "operational_sessions" && sessionFilters.ids) {
          const failedId = sessionFilters.ids.find((id) =>
            operationalSessionRelationshipReadErrors.has(id));
          if (failedId) {
            error = operationalSessionRelationshipReadErrors.get(failedId);
            operationalSessionRelationshipReadErrors.delete(failedId);
          }
        }
        if (table === "operational_session_venue_overrides") {
          operationalVenueOverrideReadError = null;
        }
        const role = operationalRoleFor(authUser.id);
        let visibleRows = rows;
        if (table === "operational_bookings"
            && !["admin", "super_admin"].includes(role)) {
          visibleRows = visibleRows.filter((row) => row.profile_id === authUser.id);
        }
        if (table === "operational_sessions") {
          if (sessionFilters.since) {
            visibleRows = visibleRows.filter((row) => row.session_date >= sessionFilters.since);
          }
          if (sessionFilters.ids) {
            const ids = new Set(sessionFilters.ids);
            visibleRows = visibleRows.filter((row) => ids.has(row.id));
          }
          operationalSessionQueries.push({ ...sessionFilters, ids: sessionFilters.ids?.slice() || null });
        }
        if (table === "collector_payout_profiles") {
          visibleRows = ["admin", "super_admin"].includes(role)
            ? visibleRows
            : visibleRows.filter((row) => row.profile_id === authUser.id);
          operationalPayoutDirectReads.push({
            profileId: authUser.id,
            profileIds: visibleRows.map((row) => row.profile_id),
          });
        }
        return { data: error ? null : visibleRows.slice(), error };
      };
      const thenable = () => Promise.resolve(result());
      const chain = {
        order: thenable,
        gte(column, value) {
          if (table !== "operational_sessions" || column !== "session_date") {
            throw new Error("Only operational session date queries may use gte");
          }
          sessionFilters.since = value;
          return chain;
        },
        or: () => chain,
        eq: () => chain,
        neq: () => chain,
        in(column, values) {
          if (table !== "operational_sessions" || column !== "id") {
            throw new Error("Only operational session ID queries may use in");
          }
          sessionFilters.ids = values;
          return chain;
        },
        is: () => chain,
        match: () => chain,
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return { select: () => chain };
    }
    throw new Error(`Unexpected table: ${table}`);
  },
  rpc(name, args) {
    if (prayerRpcNames.has(name)) {
      prayerRpcCalls.push({ name, args: args === undefined ? undefined : structuredClone(args) });
      if (prayerRpcGate?.name === name) return prayerRpcGate.promise;
      return Promise.resolve({
        data: prayerRpcErrors.has(name) ? null : prayerRpcResult(name),
        error: prayerRpcErrors.get(name) || null,
      });
    }
    if (operationalRpcHandler) return operationalRpcHandler(name, args);
    return Promise.resolve({ data: null, error: null });
  },
  channel(name) {
    const channel = {
      name,
      handlers: [],
      on(event, filter, handler) {
        channel.handlers.push({ event, filter, handler });
        return channel;
      },
      subscribe() { operationalSubscriptions.push(channel); return channel; },
    };
    return channel;
  },
  removeChannel(ch) {
    const idx = operationalSubscriptions.indexOf(ch);
    if (idx >= 0) operationalSubscriptions.splice(idx, 1);
    return Promise.resolve();
  },
};

globalThis.window = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: { createClient: () => fakeSupabase },
};

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.pathname !== "/functions/v1/resolve-profile-avatars") {
    throw new Error(`Unexpected fetch URL: ${url}`);
  }
  avatarResolveCalls.push({ url: parsed.toString(), options });
  const scope = parsed.searchParams.get("scope");
  const payload = avatarResolveStatus !== 200
    ? { error: "sensitive resolver detail" }
    : scope === "session"
    ? { avatars: structuredClone(avatarSessionRows) }
    : scope === "admin_members"
    ? { rows: structuredClone(avatarAdminRows) }
    : { avatars: [structuredClone(avatarPresentation)] };
  return new Response(JSON.stringify(payload), {
    status: avatarResolveStatus,
    headers: { "content-type": "application/json" },
  });
};

// Seed operational fake tables with authoritative recurring free occurrences
// plus at least one upcoming paid session so scheduled live-mode views can render.
const today = new Date();
const fixedHktTodayIso = "2026-08-05";
const authoritativeFreeSessionIds = [
  "run-2026-08-10",
  "water-2026-08-11",
  "wnt-2026-08-12",
];
for (const id of [
  ...authoritativeFreeSessionIds,
  "wnt-2026-08-26",
  "water-2026-08-27",
]) {
  const activityId = id.split("-")[0];
  const template = operationalTableRows.operational_activity_templates
    .find((row) => row.activity_id === activityId);
  operationalTableRows.operational_sessions.push({
    id,
    activity_id: activityId,
    session_date: id.slice(-10),
    start_time: template.start_time,
    duration_minutes: template.duration_minutes,
    venue: template.venue,
    capacity: null,
    price_hkd: 0,
    is_open: true,
    venue_tbc: true,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
}
const aug15Iso = "2026-08-15";
const seededCancelled = new Set(["hyrox-bft-2026-08-15", "hyrox-midtown-2026-08-15"]);
const normalWeeklyFixtureDates = [];
const firstNormalSaturday = new RealDate(`${fixedHktTodayIso}T00:00:00.000Z`);
const daysUntilNextSaturday = ((6 - firstNormalSaturday.getUTCDay() + 7) % 7) || 7;
firstNormalSaturday.setUTCDate(firstNormalSaturday.getUTCDate() + daysUntilNextSaturday);
for (let week = 0; normalWeeklyFixtureDates.length < 4; week += 1) {
  const d = new RealDate(firstNormalSaturday);
  d.setUTCDate(firstNormalSaturday.getUTCDate() + week * 7);
  const iso = d.toISOString().slice(0, 10);
  if (iso === aug15Iso) continue;
  normalWeeklyFixtureDates.push(iso);
  operationalTableRows.operational_sessions.push({
    id: `hyrox-bft-${iso}`,
    activity_id: "hyrox-bft",
    session_date: iso,
    start_time: "11:15:00",
    duration_minutes: 60,
    venue: "BFT Causeway Bay",
    capacity: 20,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `hyrox-quarry-bay-${iso}`,
    activity_id: "hyrox-quarry-bay",
    session_date: iso,
    start_time: "10:30:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `lunch-${iso}`,
    activity_id: "lunch",
    session_date: iso,
    start_time: "12:45:00",
    duration_minutes: 75,
    venue: "TBC",
    capacity: null,
    price_hkd: 0,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `hyrox-quarry-bay-early-${iso}`,
    activity_id: "hyrox-quarry-bay-early",
    session_date: iso,
    start_time: "09:15:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
  operationalTableRows.operational_sessions.push({
    id: `hyrox-midtown-${iso}`,
    activity_id: "hyrox-midtown",
    session_date: iso,
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "Midtown 28",
    capacity: 12,
    price_hkd: 180,
    is_open: false,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  });
}

// Seed the 15 August 2026 cancelled sessions with system provenance.
operationalTableRows.operational_sessions.push({
  id: "hyrox-bft-2026-08-15",
  activity_id: "hyrox-bft",
  session_date: aug15Iso,
  start_time: "11:15:00",
  duration_minutes: 60,
  venue: "BFT Causeway Bay",
  capacity: 20,
  price_hkd: 180,
  is_open: true,
  venue_tbc: false,
  notice: null,
  cancelled_at: today.toISOString(),
  cancelled_by: null,
  cancelled_source: "system",
  cancel_reason: "HYROX race weekend",
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: today.toISOString(),
  updated_at: today.toISOString(),
});
operationalTableRows.operational_sessions.push({
  id: "hyrox-midtown-2026-08-15",
  activity_id: "hyrox-midtown",
  session_date: aug15Iso,
  start_time: "11:00:00",
  duration_minutes: 60,
  venue: "Midtown 28",
  capacity: 12,
  price_hkd: 180,
  is_open: false,
  venue_tbc: false,
  notice: null,
  cancelled_at: today.toISOString(),
  cancelled_by: null,
  cancelled_source: "system",
  cancel_reason: "HYROX race weekend",
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: today.toISOString(),
  updated_at: today.toISOString(),
});

assert.equal(normalWeeklyFixtureDates.length, 4, "live smoke needs four normal weekly fixtures");
assert.ok(!normalWeeklyFixtureDates.includes(aug15Iso), "normal weekly fixtures must skip the cancelled race weekend");
assert.ok(
  normalWeeklyFixtureDates.every((iso) => new RealDate(`${iso}T00:00:00Z`).getUTCDay() === 6),
  "normal weekly fixture dates must all be Saturdays",
);
const operationalSessionIds = operationalTableRows.operational_sessions.map((row) => row.id);
assert.equal(
  new Set(operationalSessionIds).size,
  operationalSessionIds.length,
  "live operational fixture IDs must be unique",
);

const islandEccSessionId = `hyrox-quarry-bay-${normalWeeklyFixtureDates[0]}`;
const islandEccEarlySessionId = `hyrox-quarry-bay-early-${normalWeeklyFixtureDates[0]}`;
const retiredBftSessionId = `hyrox-bft-${normalWeeklyFixtureDates[0]}`;
const retiredRouteBookingId = "booking-8f30c7a1";
const retiredRouteReceiptId = "receipt-4d92be67";
const paidBookingFields = {
  status: "confirmed",
  reserved_at: fixedIso,
  pay_deadline_at: fixedIso,
  payment_marked_at: fixedIso,
  payment_method: "fps",
  payment_reference: "fixture",
  paid_at: fixedIso,
  confirmed_by: "approved-admin",
  deferred_from_booking_id: null,
  deferred_to_booking_id: null,
  created_at: fixedIso,
  updated_at: fixedIso,
};
operationalTableRows.operational_bookings.push(
  {
    ...paidBookingFields,
    id: retiredRouteBookingId,
    profile_id: fixtureMember.id,
    session_id: retiredBftSessionId,
    hyrox_cycle_id: null,
    snapshot: { name: "ITC HYROX", activity_id: "hyrox-bft", session_date: normalWeeklyFixtureDates[0], price_hkd: 180 },
  },
  {
    ...paidBookingFields,
    id: "island-ecc-booking",
    profile_id: fixtureMember.id,
    session_id: islandEccSessionId,
    hyrox_cycle_id: null,
    snapshot: { name: "ITC HYROX", activity_id: "hyrox-quarry-bay", session_date: normalWeeklyFixtureDates[0], price_hkd: 180 },
  },
);
operationalTableRows.operational_queue_entries.push(
  {
    id: "retired-bft-queue",
    session_id: retiredBftSessionId,
    profile_id: fixtureMember.id,
    kind: "waitlist",
    status: "active",
    joined_at: fixedIso,
    resolved_at: null,
  },
  {
    id: "island-ecc-queue",
    session_id: islandEccSessionId,
    profile_id: fixtureMember.id,
    kind: "waitlist",
    status: "active",
    joined_at: fixedIso,
    resolved_at: null,
  },
);
operationalTableRows.operational_receipts.push(
  {
    id: retiredRouteReceiptId,
    receipt_number: "ITC-2026-BFT",
    booking_id: retiredRouteBookingId,
    profile_id: fixtureMember.id,
    session_id: retiredBftSessionId,
    hyrox_cycle_id: null,
    amount_hkd: 180,
    currency: "HKD",
    payment_method: "fps",
    status: "paid",
    issued_at: fixedIso,
  },
  {
    id: "island-ecc-receipt",
    receipt_number: "ITC-2026-ECC",
    booking_id: "island-ecc-booking",
    profile_id: fixtureMember.id,
    session_id: islandEccSessionId,
    hyrox_cycle_id: null,
    amount_hkd: 180,
    currency: "HKD",
    payment_method: "fps",
    status: "paid",
    issued_at: fixedIso,
  },
);

const historicalRelationshipSessions = [
  {
    id: "historical-retired-queue-session",
    activity_id: "hyrox-bft",
    session_date: "2026-07-01",
    start_time: "11:15:00",
    duration_minutes: 60,
    venue: "BFT Causeway Bay",
    capacity: 20,
    price_hkd: 180,
    is_open: true,
  },
  {
    id: "historical-ecc-queue-session",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-07-01",
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
  },
  {
    id: "historical-retired-replacement-session",
    activity_id: "hyrox-midtown",
    session_date: "2026-06-20",
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "Midtown28 Fitness",
    capacity: 12,
    price_hkd: 180,
    is_open: false,
  },
  {
    id: "historical-ecc-replacement-session",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-06-20",
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
  },
  {
    id: "post-success-ecc-replacement-session",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-06-13",
    start_time: "11:00:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
  },
].map((row) => ({
  ...row,
  venue_tbc: false,
  notice: null,
  cancelled_at: null,
  cancelled_by: null,
  cancelled_source: null,
  cancel_reason: null,
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: fixedIso,
  updated_at: fixedIso,
}));
operationalTableRows.operational_sessions.push(...historicalRelationshipSessions);
operationalTableRows.operational_queue_entries.push(
  {
    id: "historical-retired-queue",
    session_id: "historical-retired-queue-session",
    profile_id: fixtureMember.id,
    kind: "waitlist",
    status: "active",
    joined_at: fixedIso,
    resolved_at: null,
  },
  {
    id: "historical-ecc-queue",
    session_id: "historical-ecc-queue-session",
    profile_id: fixtureMember.id,
    kind: "waitlist",
    status: "active",
    joined_at: fixedIso,
    resolved_at: null,
  },
);

const seededRsvpLunchId = `lunch-${normalWeeklyFixtureDates[0]}`;
const seededRsvpSnapshot = {
  name: "Post-Training Lunch",
  session_date: normalWeeklyFixtureDates[0],
  start_time: "12:45:00",
  venue: "TBC",
  price_hkd: 0,
};
operationalTableRows.operational_bookings.push(
  {
    id: "rsvp-other-confirmed",
    profile_id: "rsvp-other-member",
    session_id: seededRsvpLunchId,
    status: "confirmed",
    reserved_at: fixedIso,
    pay_deadline_at: fixedIso,
    payment_marked_at: null,
    payment_method: null,
    payment_reference: null,
    paid_at: fixedIso,
    confirmed_by: null,
    deferred_from_booking_id: null,
    deferred_to_booking_id: null,
    snapshot: structuredClone(seededRsvpSnapshot),
    created_at: fixedIso,
    updated_at: fixedIso,
  },
  ...["reserved", "cancelled", "deferred"].map((status) => ({
    id: `rsvp-noise-${status}`,
    profile_id: `rsvp-noise-member-${status}`,
    session_id: seededRsvpLunchId,
    status,
    reserved_at: fixedIso,
    pay_deadline_at: fixedIso,
    payment_marked_at: null,
    payment_method: null,
    payment_reference: null,
    paid_at: status === "deferred" ? fixedIso : null,
    confirmed_by: null,
    deferred_from_booking_id: null,
    deferred_to_booking_id: null,
    snapshot: structuredClone(seededRsvpSnapshot),
    created_at: fixedIso,
    updated_at: fixedIso,
  })),
);

operationalRpcHandler = (name, args) => {
  operationalRpcCalls.push({ name, args: structuredClone(args) });
  const override = operationalAuthSubOverride;
  operationalAuthSubOverride = null;
  const now = new Date().toISOString();
  const actingProfile = override || authUser.id;
  if (name === "get_assigned_collector_payout_profiles") {
    const role = operationalRoleFor(actingProfile);
    if (!["member", "admin", "super_admin"].includes(role)) {
      return Promise.resolve({ data: null, error: { message: "Approved membership required." } });
    }
    const assignedIds = [...new Set(
      operationalTableRows.collector_assignments.map((row) => row.collector_profile_id)
    )];
    const assignedPayouts = assignedIds.map((profileId) => {
      const application = applicationRows.get(profileId);
      const payout = operationalTableRows.collector_payout_profiles
        .find((row) => row.profile_id === profileId);
      const memberProfile = [...approvedProfiles, ...pendingProfiles, ...declinedProfiles]
        .find((item) => item.id === profileId);
      return {
        profile_id: profileId,
        payme_link: payout?.payme_link || null,
        fps_phone: application?.mobile || null,
        full_name: application?.profiles?.full_name || memberProfile?.full_name || null,
        preferred_name: application?.preferred_name || null,
      };
    });
    return Promise.resolve({ data: assignedPayouts, error: null });
  }
  if (name === "get_operational_rsvp_counts") {
    if (operationalRsvpCountError) {
      return Promise.resolve({ data: null, error: operationalRsvpCountError });
    }
    if (operationalRsvpCountRowsOverride !== null) {
      return Promise.resolve({
        data: structuredClone(operationalRsvpCountRowsOverride),
        error: null,
      });
    }
    const counts = new Map();
    for (const booking of operationalTableRows.operational_bookings) {
      if (booking.status !== "confirmed") continue;
      const session = operationalTableRows.operational_sessions
        .find((row) => row.id === booking.session_id);
      const template = operationalTableRows.operational_activity_templates
        .find((row) => row.activity_id === session?.activity_id);
      if (!template?.requires_rsvp) continue;
      counts.set(booking.session_id, (counts.get(booking.session_id) || 0) + 1);
    }
    return Promise.resolve({
      data: [...counts].map(([session_id, going_count]) => ({ session_id, going_count })),
      error: null,
    });
  }
  if (name === "cancel_operational_session") {
    const session = operationalTableRows.operational_sessions.find((row) => row.id === args.p_session_id);
    if (!session) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    if (session.cancelled_at) return Promise.resolve({ data: null, error: { message: "Session is already cancelled." } });
    session.cancelled_at = now;
    session.cancelled_by = actingProfile;
    session.cancelled_source = "admin";
    session.cancel_reason = args.p_reason;
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "reopen_operational_rsvp") {
    const session = operationalTableRows.operational_sessions.find((row) => row.id === args.p_session_id);
    const template = operationalTableRows.operational_activity_templates
      .find((row) => row.activity_id === session?.activity_id);
    if (!session) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    if (!session.cancelled_at || !template?.requires_rsvp || Number(session.price_hkd) !== 0) {
      return Promise.resolve({ data: null, error: { message: "Only cancelled RSVP events can be reopened." } });
    }
    session.cancelled_at = null;
    session.cancelled_by = null;
    session.cancelled_source = null;
    session.cancel_reason = null;
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "create_operational_event") {
    const activityId = `event-${operationalTableRows.operational_activity_templates.length + 1}`;
    operationalTableRows.operational_activity_templates.push({
      activity_id: activityId,
      name: args.p_name,
      venue: args.p_venue,
      weekday: new Date(`${args.p_session_date}T00:00:00`).getDay(),
      start_time: args.p_start_time,
      duration_minutes: args.p_duration_minutes,
      capacity: args.p_capacity,
      price_hkd: args.p_price_hkd,
      default_open: true,
      active: false,
      category: args.p_category || "Other",
      maps_query: args.p_maps_query || null,
      requires_rsvp: !!args.p_requires_rsvp,
    });
    const session = {
      id: `${activityId}-${args.p_session_date}`,
      activity_id: activityId,
      session_date: args.p_session_date,
      start_time: args.p_start_time,
      duration_minutes: args.p_duration_minutes,
      venue: args.p_venue,
      capacity: args.p_capacity,
      price_hkd: args.p_price_hkd,
      is_open: true,
      venue_tbc: false,
      notice: null,
      cancelled_at: null,
      cancelled_by: null,
      cancelled_source: null,
      cancel_reason: null,
      gym_confirmed_at: null,
      gym_confirmed_by: null,
      gym_note: null,
      created_at: now,
      updated_at: now,
    };
    operationalTableRows.operational_sessions.push(session);
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "delete_operational_event") {
    const idx = operationalTableRows.operational_sessions.findIndex((s) => s.id === args.p_session_id);
    const row = operationalTableRows.operational_sessions[idx];
    if (!row) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    if (!row.activity_id.startsWith("event-")) {
      return Promise.resolve({ data: null, error: { message: "Only one-off events can be deleted; cancel recurring sessions instead." } });
    }
    const hasBookings = operationalTableRows.operational_bookings.some(
      (b) => b.session_id === args.p_session_id && ["reserved", "confirmed"].includes(b.status)
    );
    if (hasBookings) {
      return Promise.resolve({ data: null, error: { message: "Event has active bookings — cancel the session instead." } });
    }
    operationalTableRows.operational_sessions.splice(idx, 1);
    const tIdx = operationalTableRows.operational_activity_templates.findIndex((t) => t.activity_id === row.activity_id);
    if (tIdx >= 0) operationalTableRows.operational_activity_templates.splice(tIdx, 1);
    return Promise.resolve({ data: null, error: null });
  }
  if (name === "reserve_operational_session") {
    const sessionRow = operationalTableRows.operational_sessions.find((s) => s.id === args.p_session_id);
    const templateRow = operationalTableRows.operational_activity_templates.find((t) => t.activity_id === sessionRow?.activity_id);
    const isRsvp = sessionRow && Number(sessionRow.price_hkd) === 0 && templateRow?.requires_rsvp;
    if (sessionRow && Number(sessionRow.price_hkd) === 0 && !isRsvp) {
      return Promise.resolve({ data: null, error: { message: "Session does not require RSVP." } });
    }
    const id = "b-" + (operationalTableRows.operational_bookings.length + 1);
    const booking = {
      id,
      profile_id: actingProfile,
      session_id: args.p_session_id,
      status: isRsvp ? "confirmed" : "reserved",
      reserved_at: now,
      pay_deadline_at: now,
      payment_marked_at: null,
      payment_method: null,
      payment_reference: null,
      paid_at: isRsvp ? now : null,
      confirmed_by: null,
      snapshot: isRsvp && sessionRow
        ? {
          name: templateRow?.name || sessionRow.activity_id,
          session_date: sessionRow.session_date,
          start_time: sessionRow.start_time,
          venue: sessionRow.venue,
          price_hkd: 0,
        }
        : {
          name: "ITC HYROX",
          session_date: "2026-08-22",
          start_time: "11:15:00",
          venue: "BFT Causeway Bay",
          price_hkd: 180,
        },
    };
    operationalTableRows.operational_bookings.push(booking);
    return Promise.resolve({ data: booking, error: null });
  }
  if (name === "withdraw_operational_rsvp") {
    const row = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    const sRow = operationalTableRows.operational_sessions.find((s) => s.id === row?.session_id);
    const templateRow = operationalTableRows.operational_activity_templates.find((t) => t.activity_id === sRow?.activity_id);
    if (!row || row.profile_id !== actingProfile || !sRow || Number(sRow.price_hkd) > 0
        || !templateRow?.requires_rsvp || row.status !== "confirmed") {
      return Promise.resolve({ data: null, error: { message: "Only your own confirmed RSVP can be withdrawn." } });
    }
    row.status = "cancelled";
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "set_operational_attendance") {
    if (operationalAttendanceError) {
      return Promise.resolve({ data: null, error: operationalAttendanceError });
    }
    const row = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    if (!row) return Promise.resolve({ data: null, error: { message: "Booking not found." } });
    if (args.p_arrived && row.status === "confirmed") {
      row.status = "attended";
      row.attended_at = now;
      row.attended_by = actingProfile;
    } else if (!args.p_arrived && row.status === "attended") {
      row.status = "confirmed";
      row.attended_at = null;
      row.attended_by = null;
    }
    return Promise.resolve({ data: structuredClone(row), error: null });
  }
  if (name === "mark_operational_payment") {
    const row = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    if (row) {
      row.payment_marked_at = now;
      row.payment_method = args.p_method;
      row.payment_reference = args.p_reference || null;
    }
    return Promise.resolve({ data: row || null, error: null });
  }
  if (name === "set_collector_assignment") {
    const idx = operationalTableRows.collector_assignments.findIndex((row) => row.week_start === args.p_week_start);
    const row = {
      week_start: args.p_week_start,
      collector_profile_id: args.p_profile_id,
      assigned_by: actingProfile,
      assigned_at: now,
    };
    if (idx >= 0) operationalTableRows.collector_assignments[idx] = row;
    else operationalTableRows.collector_assignments.push(row);
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "update_collector_payout_profile") {
    const idx = operationalTableRows.collector_payout_profiles.findIndex((row) => row.profile_id === args.p_profile_id);
    const row = {
      profile_id: args.p_profile_id,
      payme_link: args.p_payme_link || null,
      fps_phone: args.p_fps_phone || null,
    };
    if (idx >= 0) operationalTableRows.collector_payout_profiles[idx] = row;
    else operationalTableRows.collector_payout_profiles.push(row);
    return Promise.resolve({ data: row, error: null });
  }
  if (name === "defer_operational_booking") {
    const source = operationalTableRows.operational_bookings.find((b) => b.id === args.p_booking_id);
    if (!source) return Promise.resolve({ data: null, error: { message: "Booking not found." } });
    const target = operationalTableRows.operational_sessions.find((s) => s.id === args.p_target_session_id);
    if (!target) return Promise.resolve({ data: null, error: { message: "Target session not found." } });
    const newBooking = {
      id: "b-def-" + (operationalTableRows.operational_bookings.length + 1),
      profile_id: source.profile_id,
      session_id: target.id,
      status: "confirmed",
      reserved_at: now,
      pay_deadline_at: now,
      payment_marked_at: source.payment_marked_at,
      payment_method: source.payment_method,
      payment_reference: source.payment_reference,
      paid_at: source.paid_at,
      confirmed_by: source.confirmed_by,
      deferred_from_booking_id: source.id,
      snapshot: { ...target, session_date: target.session_date, price_hkd: target.price_hkd, venue: target.venue },
    };
    operationalTableRows.operational_bookings.push(newBooking);
    source.status = "deferred";
    source.deferred_to_booking_id = newBooking.id;
    return Promise.resolve({ data: newBooking, error: null });
  }
  if (name === "finalize_operational_gym") {
    const session = operationalTableRows.operational_sessions.find((s) => s.id === args.p_session_id);
    if (!session) return Promise.resolve({ data: null, error: { message: "Session not found." } });
    session.gym_confirmed_at = now;
    session.gym_confirmed_by = actingProfile;
    session.gym_note = args.p_note || null;
    return Promise.resolve({ data: session, error: null });
  }
  if (name === "set_session_venue") {
    const sessionId = args.p_session_id;
    const activityId = String(sessionId || "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
    if (!["wnt", "run", "water", "lunch"].includes(activityId)) {
      return Promise.resolve({ data: null, error: { message: "Activity venue is fixed." } });
    }
    const existing = operationalTableRows.operational_session_venue_overrides
      .find((row) => row.session_id === sessionId);
    const location = String(args.p_location || "").trim() || null;
    const normalizedLocation = String(location || "").trim().toLowerCase().replace(/\s+/g, " ");
    const acceptsPoint = activityId === "wnt"
      && ["tamar park", "tamar park, admiralty"].includes(normalizedLocation);
    const next = {
      session_id: sessionId,
      activity_id: activityId,
      location,
      maps_query: String(args.p_maps_query || "").trim() || null,
      meeting_lat: acceptsPoint ? args.p_meeting_lat ?? null : null,
      meeting_lng: acceptsPoint ? args.p_meeting_lng ?? null : null,
      set_by: actingProfile,
      set_at: now,
      member_notified_at: existing?.member_notified_at || null,
    };
    if (args.p_was_tbc && !existing?.member_notified_at && next.location && next.maps_query) {
      next.member_notified_at = now;
    }
    if (existing) Object.assign(existing, next);
    else operationalTableRows.operational_session_venue_overrides.push(next);
    return Promise.resolve({ data: next, error: null });
  }
  return Promise.resolve({ data: null, error: null });
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
const data = await import("./js/data.js");
const operations = await import("./js/operations.js");
const todayISO = data.todayHktISO();
assert.equal(todayISO, fixedHktTodayIso,
  "fixed live smoke instant must resolve to the same HKT date in every host timezone");
assert.equal(
  data.hktEventStartMs("2026-08-05", "10:00:00"),
  RealDate.parse(fixedIso),
  "live event wall time must resolve as an HKT instant in every host timezone",
);
store.load();

// Prayer store actions must use only the five authoritative RPCs in live mode,
// normalize snake_case rows, reject unsafe inputs before RPC, and never fall
// back to device-local prayer data when Supabase fails.
const submittedPrayer = await store.submitPrayerRequest({
  request: "  Prayer  ",
  anonymousToLeaders: true,
});
assert.deepEqual(submittedPrayer, {
  id: PRAYER_ID,
  request: "Prayer",
  anonymousToLeaders: true,
  status: "new",
  createdAt: "2026-08-05T02:00:00.000Z",
  updatedAt: "2026-08-05T02:00:00.000Z",
  closedAt: null,
  withdrawnAt: null,
});
const liveMemberPrayers = await store.listMyPrayerRequests();
assert.deepEqual(liveMemberPrayers, [submittedPrayer]);
const withdrawnPrayer = await store.setMyPrayerRequestState(PRAYER_ID, "withdraw");
assert.equal(withdrawnPrayer.status, "withdrawn");
assert.equal(withdrawnPrayer.request, null);
const liveAdminPrayers = await store.listAdminPrayerRequests();
assert.deepEqual(liveAdminPrayers, [{
  id: SECOND_PRAYER_ID,
  request: "A private live concern",
  anonymousToLeaders: true,
  status: "prayed_for",
  createdAt: "2026-08-05T01:00:00.000Z",
  updatedAt: "2026-08-05T02:00:00.000Z",
  closedAt: null,
  withdrawnAt: null,
  displayName: "Anonymous member",
}]);
assert.equal("ownerId" in liveAdminPrayers[0], false);
assert.equal("owner_id" in liveAdminPrayers[0], false);
assert.equal("email" in liveAdminPrayers[0], false);
const adminClosedPrayer = await store.setAdminPrayerRequestStatus(SECOND_PRAYER_ID, "closed");
assert.equal(adminClosedPrayer.status, "closed");
assert.equal(adminClosedPrayer.displayName, "Anonymous member");
assert.deepEqual(prayerRpcCalls.slice(0, 5), [
  {
    name: "submit_prayer_request",
    args: { p_request_text: "Prayer", p_anonymous_to_leaders: true },
  },
  { name: "list_my_prayer_requests", args: undefined },
  {
    name: "set_my_prayer_request_state",
    args: { p_request_id: PRAYER_ID, p_action: "withdraw" },
  },
  { name: "list_admin_prayer_requests", args: undefined },
  {
    name: "set_admin_prayer_request_status",
    args: { p_request_id: SECOND_PRAYER_ID, p_status: "closed" },
  },
]);

const prayerCallCountBeforeValidation = prayerRpcCalls.length;
await assert.rejects(
  () => store.submitPrayerRequest({ request: " " }),
  /between 1 and 2,000 characters/i,
);
await assert.rejects(
  () => store.submitPrayerRequest({ request: "x".repeat(2001) }),
  /between 1 and 2,000 characters/i,
);
await assert.rejects(
  () => store.setMyPrayerRequestState("not-a-uuid", "withdraw"),
  /valid prayer request/i,
);
await assert.rejects(
  () => store.setMyPrayerRequestState(PRAYER_ID, "reopen"),
  /close or withdraw/i,
);
await assert.rejects(
  () => store.setAdminPrayerRequestStatus(PRAYER_ID, "new"),
  /prayed_for or closed/i,
);
assert.equal(prayerRpcCalls.length, prayerCallCountBeforeValidation,
  "invalid live prayer inputs must not reach Supabase");

const localPrayerState = JSON.parse(mem.get("itc.prototype.v1"));
localPrayerState.prayers = [{
  id: "device-only-prayer",
  request: "Never expose this as a live fallback",
  status: "new",
}];
mem.set("itc.prototype.v1", JSON.stringify(localPrayerState));
store.load();
const persistedLocalPrayers = JSON.parse(mem.get("itc.prototype.v1")).prayers;
for (const [name, invoke, message] of [
  ["submit_prayer_request", () => store.submitPrayerRequest({ request: "Failure check" }), /could not be sent/i],
  ["list_my_prayer_requests", () => store.listMyPrayerRequests(), /could not be loaded/i],
  ["set_my_prayer_request_state", () => store.setMyPrayerRequestState(PRAYER_ID, "close"), /could not be updated/i],
  ["list_admin_prayer_requests", () => store.listAdminPrayerRequests(), /could not be loaded for Admin/i],
  ["set_admin_prayer_request_status", () => store.setAdminPrayerRequestStatus(PRAYER_ID, "closed"), /status could not be updated/i],
]) {
  prayerRpcErrors.set(name, { message: `sensitive ${name} failure` });
  await assert.rejects(invoke, message);
  prayerRpcErrors.delete(name);
}
assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).prayers, persistedLocalPrayers,
  "failed live prayer RPCs must neither save nor replace device-local prayer rows");
console.log("ok  live prayer actions use authoritative RPCs, safe normalization, and no local fallback");

await operations.ensureLiveSessionWindow();
assert.deepEqual(
  operationalRpcCalls.find((call) => call.name === "ensure_operational_sessions")?.args,
  { p_start_date: fixedHktTodayIso, p_weeks: 16 },
  "live boot must keep the generic operational session window provisioned",
);
assert.equal(
  operationalRpcCalls.some((call) => call.name === "ensure_hyrox_cycles"),
  false,
  "live boot must not provision retired HYROX pool cycles",
);
await store.hydrateLiveOperations();
const hydratedFreeSessions = store.upcomingSessions(21)
  .filter((session) => ["wnt", "run", "water"].includes(session.activityId));
assert.equal(hydratedFreeSessions.length, 3,
  "live Schedule must expose only the three authoritative free fixtures in this horizon");
assert.deepEqual(
  hydratedFreeSessions.map((session) => session.id).sort(),
  authoritativeFreeSessionIds.slice().sort(),
  "live recurring free occurrences must come from operational session IDs",
);
assert.ok(hydratedFreeSessions.every((session) =>
  session.kind === "free" && session.requiresRsvp === true
), "live recurring free sessions must retain free presentation and RSVP capability");
assert.equal(new Set(hydratedFreeSessions.map((session) => session.id)).size, 3,
  "live recurring free occurrences must not be duplicated by local recurrence generation");
const priorAuthoritativeWeekOffset = views.scheduleState.weekOffset;
const priorAuthoritativeSelected = views.scheduleState.selected;
views.scheduleState.weekOffset = 1;
const authoritativeWeekScheduleHtml = authoritativeFreeSessionIds.map((sessionId) => {
  views.scheduleState.selected = sessionId.slice(-10);
  return views.viewSchedule();
}).join("");
views.scheduleState.weekOffset = priorAuthoritativeWeekOffset;
views.scheduleState.selected = priorAuthoritativeSelected;
for (const sessionId of authoritativeFreeSessionIds) {
  const renderedHref = `href="#/activity/${sessionId}"`;
  assert.equal(authoritativeWeekScheduleHtml.split(renderedHref).length - 1, 1,
    `live Schedule must render authoritative session ${sessionId} exactly once in its week`);
}
const hydratedRun = hydratedFreeSessions.find((session) => session.activityId === "run");
assert.equal(hydratedRun.photo, "../assets/itc/running.webp");
assert.match(hydratedRun.blurb, /nobody gets left behind/i);
assert.equal(hydratedRun.memberNote, "Bag drop with a leader at the start point.");
assert.equal(store.getSession("wnt-2026-08-19"), null,
  "an unmaterialized local recurrence must not exist in live mode");
assert.deepEqual(
  [...new Set(store.upcomingSessions(21)
    .filter((row) => row.category === "HYROX")
    .map((row) => row.activityId))],
  ["hyrox-quarry-bay-early", "hyrox-quarry-bay"],
  "both Island ECC slots must be the only HYROX activities admitted to the live session cache",
);
assert.equal(store.getSession(retiredBftSessionId), null);
assert.ok(store.getSession(islandEccSessionId), "Island ECC sessions must remain available");
assert.ok(store.getSession(islandEccEarlySessionId), "the early Island ECC slot must remain available");
assert.deepEqual(
  store.upcomingSessions(21)
    .filter((row) => row.dateISO === normalWeeklyFixtureDates[0])
    .map((row) => row.time),
  ["09:15", "10:30", "12:45"],
  "live Saturday sessions must place lunch after both HYROX slots",
);
assert.equal(store.getBooking("pooled-booking"), null);
assert.equal(store.getBooking(retiredRouteBookingId), null);
assert.ok(store.getBooking("island-ecc-booking"), "Island ECC bookings must remain available");
assert.equal(store.getReceipt("pooled-receipt"), null);
assert.equal(store.getReceipt(retiredRouteReceiptId), null);
assert.equal(operations.isLiveRetiredReceiptId(retiredRouteReceiptId), true,
  "retired receipt identity must remain only in the in-memory route tombstone");
assert.equal(operations.isLiveRetiredReceiptId("island-ecc-receipt"), false,
  "Island ECC receipt IDs must not enter the retirement tombstone");
assert.equal(store.isRetiredHyroxMemberRoute("booking", retiredRouteBookingId), true,
  "relationship-backed retired booking IDs must retain non-display route identity");
assert.equal(store.isRetiredHyroxMemberRoute("receipt", retiredRouteReceiptId), true,
  "relationship-backed retired receipt IDs must retain non-display route identity");
assert.equal(store.isRetiredHyroxMemberRoute("receipt", "island-ecc-receipt"), false,
  "Island ECC receipts must remain active");
assert.ok(store.getReceipt("island-ecc-receipt"), "Island ECC receipts must remain available");
assert.equal(typeof store.listHyroxCycles, "undefined");
assert.equal(typeof store.getHyroxCycle, "undefined");
assert.equal(typeof operations.listLiveHyroxCycles, "undefined");
assert.equal(typeof operations.getLiveHyroxCycle, "undefined");
assert.equal(typeof operations.liveHyroxQueuesForCycle, "undefined");
assert.equal(typeof store.hyroxCycleQueues, "undefined",
  "the retired Admin pool queue selector must be removed");
assert.equal(operationalTableQueries.includes("operational_hyrox_cycles"), false,
  "hydration must not query retired pool cycles");
assert.equal(operationalTableQueries.includes("operational_hyrox_queue_entries"), false,
  "hydration must not query retired pool queues");
assert.equal(
  operations.liveQueueForSession("historical-retired-queue-session").waitlist.length,
  0,
  "an out-of-horizon retired direct queue must not enter the live cache",
);
assert.equal(
  operations.liveQueueForSession("historical-ecc-queue-session").waitlist[0]?.id,
  "historical-ecc-queue",
  "a same-shape out-of-horizon Island ECC queue must remain active",
);
assert.ok(operationalSessionQueries.some((query) =>
  query.ids?.includes("historical-retired-queue-session")
  && query.ids?.includes("historical-ecc-queue-session")
), "queue session relationships must be fetched by canonical session ID");
assert.equal(operations.liveAssigneeForWeek("2099-01-03")?.userId, fixtureMember.id,
  "collector duty is a shared week record and must remain available for Island ECC");

const retirementNotificationRows = [
  {
    id: "retired-pool-notification",
    kind: "operational_hyrox_reserved",
    title: "Old pool reservation",
    body: "Retained pool fixture",
    destination: "#/booking/pooled-booking",
    created_at: fixedIso,
    read_at: null,
  },
  {
    id: "retired-booking-notification",
    kind: "operational_payment_confirmed",
    title: "Old BFT payment",
    body: "Retained BFT fixture",
    destination: `#/booking/${retiredRouteBookingId}`,
    created_at: fixedIso,
    read_at: null,
  },
  {
    id: "island-ecc-payment-notification",
    kind: "operational_payment_confirmed",
    title: "Island ECC payment",
    body: "Active Island ECC fixture",
    destination: "#/booking/island-ecc-booking",
    created_at: fixedIso,
    read_at: null,
  },
];
notificationRows.push(...retirementNotificationRows);
const filteredLiveNotifications = await store.listMyNotifications();
assert.equal(filteredLiveNotifications.some((row) => row.id === "retired-pool-notification"), false);
assert.equal(filteredLiveNotifications.some((row) => row.id === "retired-booking-notification"), false);
assert.equal(filteredLiveNotifications.some((row) => row.id === "island-ecc-payment-notification"), true,
  "Island ECC payment notifications must remain visible");
notificationRows.splice(-retirementNotificationRows.length);

const retiredMutationCallCount = operationalRpcCalls.length;
for (const mutate of [
  () => store.reserveSession(fixtureMember.id, retiredBftSessionId),
  () => store.markBookingPaid("pooled-booking", "FPS", "retired"),
  () => store.confirmBookingPayment(retiredRouteBookingId),
  () => store.releaseReservation("pooled-booking"),
  () => store.setBookingAttendance(retiredRouteBookingId, true),
]) {
  await assert.rejects(async () => mutate(), /This session is no longer available\./);
}
assert.equal(operationalRpcCalls.length, retiredMutationCallCount,
  "retired session and booking targets must be rejected before any live RPC");
const attendeeRpcCount = operationalRpcCalls
  .filter((call) => call.name === "get_operational_attendee_names").length;
for (const retiredSessionId of [
  retiredBftSessionId,
  "hyrox-bft-2099-02-07",
  "hyrox-midtown-2099-02-07",
]) {
  await assert.rejects(
    () => store.attendeeNamesFor(retiredSessionId),
    /This session is no longer available\./,
  );
}
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "get_operational_attendee_names").length,
  attendeeRpcCount,
  "hydrated and unloaded retired attendee selectors must stop before the live RPC",
);
for (const activeOrLookalikeId of [
  islandEccSessionId,
  "hyrox-quarry-bay-2099-02-07",
  "event-hyrox-bft-party-2099-02-07",
]) {
  await store.attendeeNamesFor(activeOrLookalikeId);
}
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "get_operational_attendee_names").length,
  attendeeRpcCount + 3,
  "Island ECC and unrelated lookalike attendee selectors must retain the live RPC",
);

const attendanceRow = operationalTableRows.operational_bookings
  .find((booking) => booking.id === "island-ecc-booking");
attendanceRow.status = "attended";
attendanceRow.attended_at = "2026-08-05T02:01:00.000Z";
attendanceRow.attended_by = "approved-admin";
await operations.hydrateOperationalState({ force: true, authenticated: true });
assert.equal(store.getBooking("island-ecc-booking")?.status, "attended");
assert.equal(store.getBooking("island-ecc-booking")?.attendedAt, RealDate.parse("2026-08-05T02:01:00.000Z"));
assert.equal(store.getBooking("island-ecc-booking")?.attendedBy, "approved-admin");
attendanceRow.status = "confirmed";
attendanceRow.attended_at = null;
attendanceRow.attended_by = null;
await operations.hydrateOperationalState({ force: true, authenticated: true });
const attendanceCallsBefore = operationalRpcCalls.length;
await operations.liveSetOperationalAttendance("island-ecc-booking", true);
assert.deepEqual(operationalRpcCalls[attendanceCallsBefore], {
  name: "set_operational_attendance",
  args: { p_booking_id: "island-ecc-booking", p_arrived: true },
});
assert.equal(store.getBooking("island-ecc-booking")?.status, "attended",
  "successful Island ECC attendance RPC must refresh the authoritative booking cache");
assert.equal(store.getBooking("island-ecc-booking")?.attendedBy, authUser.id);
operationalAttendanceError = { message: "Attendance is outside the check-in window." };
await assert.rejects(
  () => operations.liveSetOperationalAttendance("island-ecc-booking", false),
  /Attendance is outside the check-in window/,
);
assert.equal(store.getBooking("island-ecc-booking")?.status, "attended",
  "a rejected Island ECC attendance RPC must leave the authoritative cache unchanged");
operationalAttendanceError = null;
await operations.liveSetOperationalAttendance("island-ecc-booking", false);
assert.equal(store.getBooking("island-ecc-booking")?.status, "confirmed");
assert.equal(store.getBooking("island-ecc-booking")?.attendedAt, null);
assert.equal(store.getBooking("island-ecc-booking")?.attendedBy, null);
console.log("ok  live attendance rows map and RPC mutations refresh authoritative state");
for (const removedPoolAdapter of [
  "liveReserveHyroxCycle",
  "liveJoinHyroxCycleWaitlist",
  "liveLeaveHyroxCycleQueue",
  "liveRejectHyroxPayment",
  "liveScheduleHyroxCycle",
  "liveFinalizeHyroxVenuePlan",
  "liveSelectHyroxVenue",
  "liveJoinHyroxVenueSwitchQueue",
  "liveLeaveHyroxVenueSwitchQueue",
  "liveCloseHyroxVenueAllocation",
  "liveCancelHyroxCycle",
  "liveSweepHyroxDeadlines",
  "liveSetMidtownOpen",
]) {
  assert.equal(typeof operations[removedPoolAdapter], "undefined",
    `${removedPoolAdapter} must be removed with the retired pool workflow`);
}
for (const retiredRpc of [
  "sweep_hyrox_cycle_deadlines", "send_hyrox_member_payment_reminders",
  "send_hyrox_collector_payment_reminder", "send_hyrox_venue_reminders",
]) {
  assert.equal(operationalRpcCalls.some((call) => call.name === retiredRpc), false,
    `hydration must not invoke retired pool RPC ${retiredRpc}`);
}
await store.hydrateLiveOperations({ force: true });
assert.equal(typeof store.reserveHyroxCycle, "undefined",
  "the retired pooled reservation action must not remain exported");
liveSession = null;
await store.hydrateLiveOperations({ force: true });
liveSession = {
  access_token: "test-access-token", token_type: "bearer", expires_in: 3600,
  expires_at: 9999999999, refresh_token: "test-refresh-token", user: authUser,
};
const initialRealtimeHandlers = operationalSubscriptions.flatMap((channel) => channel.handlers);
assert.equal(
  initialRealtimeHandlers.filter(({ filter }) => filter.table === "operational_hyrox_cycles").length,
  0,
  "live operations must not subscribe to retired pool cycles",
);
assert.equal(
  initialRealtimeHandlers.filter(({ filter }) => filter.table === "operational_hyrox_queue_entries").length,
  0,
  "live operations must not subscribe to retired pool queues",
);

// Assigned collector payout enrichment is optional. Missing, forbidden, or
// membership-gated RPCs must never hide the public operational schedule or
// the Admin's paid-session controls.
const successfulAssignedPayoutHandler = operationalRpcHandler;
const assignedPayoutFailures = [
  {
    label: "function unavailable",
    message: "Could not find the function public.get_assigned_collector_payout_profiles without parameters in the schema cache",
  },
  {
    label: "permission denied",
    message: "permission denied for function get_assigned_collector_payout_profiles",
  },
  { label: "membership required", message: "Approved membership required." },
];
for (const failure of assignedPayoutFailures) {
  operationalRpcHandler = (name, args) => {
    if (name === "get_assigned_collector_payout_profiles") {
      operationalRpcCalls.push({ name, args: structuredClone(args) });
      return Promise.resolve({ data: null, error: { message: failure.message } });
    }
    return successfulAssignedPayoutHandler(name, args);
  };
  const assignedCallsBeforeHydration = operationalRpcCalls
    .filter((call) => call.name === "get_assigned_collector_payout_profiles").length;
  await store.hydrateLiveOperations({ force: true });
  assert.equal(
    operationalRpcCalls.filter((call) => call.name === "get_assigned_collector_payout_profiles").length,
    assignedCallsBeforeHydration + 1,
    `${failure.label} test must exercise a forced assigned-payout hydration`
  );
  assert.ok(store.upcomingSessions(21).some((session) => session.kind === "paid"),
    `${failure.label} payout enrichment must preserve paid sessions`);
  assert.ok(store.upcomingSessions(21).some((session) => session.kind === "rsvp"),
    `${failure.label} payout enrichment must preserve RSVP sessions`);
  const status = operations.operationalStateStatus();
  assert.equal(status.error, null, `${failure.label} must not become a core operations error`);
  assert.equal(status.payoutError, failure.message,
    `${failure.label} must report only payout degradation`);
  assert.equal(status.rsvpCountError, null,
    `${failure.label} payout degradation must not affect RSVP count hydration`);
}

operationalRpcHandler = successfulAssignedPayoutHandler;
const originalAuthIdentity = structuredClone(authUser);
const originalProfileIdentity = structuredClone(profile);
for (const operationalIdentity of [
  { label: "anonymous", id: "anonymous-profile", role: null },
  { label: "pending", id: "pending-submitted", role: "pending" },
  { label: "declined", id: "declined-member", role: "declined" },
]) {
  Object.assign(authUser, {
    id: operationalIdentity.id,
    email: `${operationalIdentity.label}@example.com`,
  });
  Object.assign(profile, {
    id: operationalIdentity.id,
    email: `${operationalIdentity.label}@example.com`,
    role: operationalIdentity.role,
  });
  await store.hydrateLiveOperations({ force: true });
  const status = operations.operationalStateStatus();
  assert.equal(status.error, null,
    `${operationalIdentity.label} payout gating must not become a core operations error`);
  assert.equal(status.payoutError, "Approved membership required.",
    `${operationalIdentity.label} must report payout-only membership degradation`);
  assert.equal(status.rsvpCountError, null,
    `${operationalIdentity.label} payout gating must not affect RSVP count hydration`);
  assert.ok(store.upcomingSessions(21).some((session) => session.kind === "paid"),
    `${operationalIdentity.label} public Schedule source must retain paid sessions`);
  assert.ok(store.upcomingSessions(21).some((session) => session.kind === "rsvp"),
    `${operationalIdentity.label} public Schedule source must retain RSVP sessions`);
}
Object.assign(authUser, originalAuthIdentity);
Object.assign(profile, originalProfileIdentity);

const assignedPayoutFixture = {
  profile_id: "assigned-enrichment-collector",
  payme_link: "https://payme.hsbc.com.hk/1/assigned-enrichment",
  fps_phone: "+852 6888 8888",
};
const directPayoutFixture = {
  profile_id: "approved-member",
  payme_link: "https://payme.hsbc.com.hk/1/direct-member",
  fps_phone: "+852 6111 1111",
};
applicationRows.set(assignedPayoutFixture.profile_id, {
  profile_id: assignedPayoutFixture.profile_id,
  mobile: assignedPayoutFixture.fps_phone,
  preferred_name: "Jerry",
  profiles: { full_name: "Jerry Chan" },
});
applicationRows.set(directPayoutFixture.profile_id, {
  profile_id: directPayoutFixture.profile_id,
  mobile: "+852 6222 2222",
});
const assignedCollectorSession = store.upcomingSessions(21)
  .find((session) => session.kind === "paid" && !session.cancelled);
assert.ok(assignedCollectorSession, "assigned collector identity coverage needs a paid session");
operationalTableRows.collector_assignments.push(
  {
    week_start: assignedCollectorSession.dateISO,
    collector_profile_id: assignedPayoutFixture.profile_id,
    assigned_at: fixedIso,
  },
  {
    week_start: "2026-08-15",
    collector_profile_id: directPayoutFixture.profile_id,
    assigned_at: fixedIso,
  },
);
operationalTableRows.collector_payout_profiles.push(assignedPayoutFixture, directPayoutFixture);
Object.assign(authUser, { id: "approved-member", email: "micah.member@example.com" });
Object.assign(profile, {
  id: "approved-member",
  email: "micah.member@example.com",
  role: "member",
});
await store.hydrateLiveOperations({ force: true });
assert.equal(operations.operationalStateStatus().payoutError, null,
  "successful payout enrichment must clear prior degradation");
assert.equal(operations.operationalStateStatus().rsvpCountError, null,
  "successful payout enrichment must coexist with RSVP count hydration");
assert.deepEqual(operations.livePayoutFor("assigned-enrichment-collector"), {
  profileId: "assigned-enrichment-collector",
  paymeLink: "https://payme.hsbc.com.hk/1/assigned-enrichment",
  fpsPhone: "+852 6888 8888",
  fullName: "Jerry Chan",
  preferredName: "Jerry",
}, "assigned payout hydration must carry the narrow collector display identity");
const assignedCollector = store.collectorFor(assignedCollectorSession.id);
assert.equal(assignedCollector?.preferredName, "Jerry",
  "member payment identity must resolve the assigned collector name without the Admin directory");
assert.deepEqual(operations.livePayoutFor("approved-member"), {
  profileId: "approved-member",
  paymeLink: "https://payme.hsbc.com.hk/1/direct-member",
  fpsPhone: "+852 6222 2222",
  fullName: "Micah Member",
}, "applications.mobile must override a stale direct RLS payout phone for an assigned collector");
Object.assign(authUser, originalAuthIdentity);
Object.assign(profile, originalProfileIdentity);
operationalTableRows.collector_assignments = operationalTableRows.collector_assignments
  .filter((row) => ![assignedPayoutFixture.profile_id, directPayoutFixture.profile_id]
    .includes(row.collector_profile_id));
operationalTableRows.collector_payout_profiles = operationalTableRows.collector_payout_profiles
  .filter((row) => ![assignedPayoutFixture.profile_id, directPayoutFixture.profile_id].includes(row.profile_id));
applicationRows.delete(assignedPayoutFixture.profile_id);
applicationRows.delete(directPayoutFixture.profile_id);
await store.hydrateLiveOperations({ force: true });
console.log("ok  payout RPC degradation preserves sessions and successful enrichment recovers");

// Both optional enrichments share one hydration without sharing failure state.
// Exercise forced calls in each direction with an assigned collector hidden
// from the member's direct payout query, then recover both channels. All fake
// auth, RPC, aggregate, and table state is restored for later live fixtures.
{
  const successfulCombinedOperationalRpcHandler = operationalRpcHandler;
  const combinedLunch = store.upcomingSessions(21).find((session) => session.kind === "rsvp");
  const combinedAssignedId = "combined-assigned-collector";
  const combinedAssignedPayout = {
    profile_id: combinedAssignedId,
    payme_link: "https://payme.hsbc.com.hk/1/combined-assigned",
    fps_phone: "+852 6999 0000",
  };
  assert.ok(combinedLunch, "combined hydration requires a live RSVP lunch");
  operationalTableRows.collector_assignments.push({
    week_start: combinedLunch.dateISO,
    collector_profile_id: combinedAssignedId,
    assigned_by: "approved-admin",
    assigned_at: fixedIso,
  });
  operationalTableRows.collector_payout_profiles.push(combinedAssignedPayout);
  applicationRows.set(combinedAssignedId, {
    profile_id: combinedAssignedId,
    mobile: combinedAssignedPayout.fps_phone,
  });

  const combinedOriginalAuthIdentity = structuredClone(authUser);
  const combinedOriginalProfileIdentity = structuredClone(profile);
  const optionalRpcCallCount = (name) => operationalRpcCalls
    .filter((call) => call.name === name).length;
  const forceCombinedHydration = async (label) => {
    const payoutCallsBefore = optionalRpcCallCount("get_assigned_collector_payout_profiles");
    const countCallsBefore = optionalRpcCallCount("get_operational_rsvp_counts");
    await store.hydrateLiveOperations({ force: true });
    assert.equal(
      optionalRpcCallCount("get_assigned_collector_payout_profiles"),
      payoutCallsBefore + 1,
      `${label} must force assigned-payout hydration`,
    );
    assert.equal(
      optionalRpcCallCount("get_operational_rsvp_counts"),
      countCallsBefore + 1,
      `${label} must force RSVP-count hydration`,
    );
  };

  try {
    Object.assign(authUser, { id: "approved-member", email: "micah.member@example.com" });
    Object.assign(profile, {
      id: "approved-member",
      email: "micah.member@example.com",
      role: "member",
    });

    operationalRsvpCountRowsOverride = [{ session_id: combinedLunch.id, going_count: 4 }];
    operationalRpcHandler = (name, args) => {
      if (name === "get_assigned_collector_payout_profiles") {
        operationalRpcCalls.push({ name, args: structuredClone(args) });
        return Promise.resolve({
          data: null,
          error: { message: "assigned payout unavailable" },
        });
      }
      return successfulCombinedOperationalRpcHandler(name, args);
    };
    await forceCombinedHydration("combined payout failure");
    assert.equal(operations.operationalStateStatus().error, null);
    assert.equal(operations.operationalStateStatus().payoutError, "assigned payout unavailable");
    assert.equal(operations.operationalStateStatus().rsvpCountError, null);
    assert.equal(store.attendeeCountFor(combinedLunch), 4,
      "successful RSVP counts must survive assigned-payout degradation");
    assert.equal(operations.livePayoutFor(combinedAssignedId), null,
      "the member must not receive an assigned payout when its enrichment fails");
    assert.ok(store.upcomingSessions(21).some((session) => session.kind === "paid"));
    assert.ok(store.upcomingSessions(21).some((session) => session.kind === "rsvp"));

    operationalRpcHandler = successfulCombinedOperationalRpcHandler;
    operationalRsvpCountRowsOverride = null;
    operationalRsvpCountError = { message: "RSVP count unavailable" };
    await forceCombinedHydration("combined RSVP count failure");
    assert.equal(operations.operationalStateStatus().error, null);
    assert.equal(operations.operationalStateStatus().payoutError, null);
    assert.equal(operations.operationalStateStatus().rsvpCountError, "RSVP count unavailable");
    assert.deepEqual(operations.livePayoutFor(combinedAssignedId), {
      profileId: combinedAssignedId,
      paymeLink: "https://payme.hsbc.com.hk/1/combined-assigned",
      fpsPhone: "+852 6999 0000",
    }, "assigned payout hydration must survive RSVP-count degradation");
    assert.ok(store.getSession(combinedLunch.id),
      "RSVP-count degradation must preserve the core RSVP session");
    assert.ok(store.upcomingSessions(21).some((session) => session.kind === "paid"),
      "RSVP-count degradation must preserve core paid sessions");

    operationalRsvpCountError = null;
    await forceCombinedHydration("combined enrichment recovery");
    assert.equal(operations.operationalStateStatus().error, null);
    assert.equal(operations.operationalStateStatus().payoutError, null);
    assert.equal(operations.operationalStateStatus().rsvpCountError, null);
    assert.equal(store.attendeeCountFor(combinedLunch), 1,
      "recovered RSVP hydration must restore the fixture's one confirmed attendee");
    assert.ok(operations.livePayoutFor(combinedAssignedId),
      "recovered payout hydration must retain the assigned collector");
    console.log("ok  optional payout and RSVP-count hydration fail independently and recover with core sessions");
  } finally {
    operationalRpcHandler = successfulCombinedOperationalRpcHandler;
    operationalRsvpCountRowsOverride = null;
    operationalRsvpCountError = null;
    Object.assign(authUser, combinedOriginalAuthIdentity);
    Object.assign(profile, combinedOriginalProfileIdentity);
    operationalTableRows.collector_assignments = operationalTableRows.collector_assignments
      .filter((row) => row.collector_profile_id !== combinedAssignedId);
    operationalTableRows.collector_payout_profiles = operationalTableRows.collector_payout_profiles
      .filter((row) => row.profile_id !== combinedAssignedId);
    applicationRows.delete(combinedAssignedId);
    await store.hydrateLiveOperations({ force: true });
  }
}

// Live callers receive exactly their requested HKT calendar-day horizon. The
// Social preview applies its additional rolling HKT start-time boundary.
const horizonDay14Iso = "2026-08-18";
const horizonDay15Iso = "2026-08-19";
const temporaryHorizonRows = [
  {
    id: "hyrox-horizon-day-14",
    activity_id: "hyrox-quarry-bay",
    session_date: horizonDay14Iso,
    start_time: "10:30:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: fixedIso,
    updated_at: fixedIso,
  },
  {
    id: "hyrox-horizon-day-15",
    activity_id: "hyrox-quarry-bay",
    session_date: horizonDay15Iso,
    start_time: "10:30:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: fixedIso,
    updated_at: fixedIso,
  },
  ...[
    ["lunch-social-started", "09:59:00"],
    ["lunch-social-future", "10:01:00"],
  ].map(([id, startTime]) => ({
    id,
    activity_id: "lunch",
    session_date: fixedHktTodayIso,
    start_time: startTime,
    duration_minutes: 30,
    venue: "TBC",
    capacity: null,
    price_hkd: 0,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: fixedIso,
    updated_at: fixedIso,
  })),
];
operationalTableRows.operational_sessions.push(...temporaryHorizonRows);
await operations.refreshOperationalState();
const fourteenDayIds = store.upcomingSessions(14).map((session) => session.id);
assert.ok(fourteenDayIds.includes("hyrox-horizon-day-14"),
  "14-day live horizon must include its final calendar day");
assert.ok(!fourteenDayIds.includes("hyrox-horizon-day-15"),
  "14-day live horizon must exclude calendar day 15");
assert.equal(store.nextSocialSession()?.id, "lunch-social-future",
  "rolling Social preview must skip a same-day event whose start time passed");
const temporaryHorizonIds = new Set(temporaryHorizonRows.map((row) => row.id));
operationalTableRows.operational_sessions = operationalTableRows.operational_sessions
  .filter((row) => !temporaryHorizonIds.has(row.id));
await operations.refreshOperationalState();
console.log("ok  live horizon is inclusive through day 14 and Socials use start time");

const hydratedWntPoint = store.getSession("wnt-2026-08-26");
assert.equal(hydratedWntPoint.meetingLat, 22.2825);
assert.equal(hydratedWntPoint.meetingLng, 114.1659);
const hydratedBft = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-bft");
const hydratedMidtown = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-midtown");
const hydratedQuarryBay = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-quarry-bay");
const hydratedQuarryBayEarly = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-quarry-bay-early");
assert.equal(hydratedBft, undefined, "retired BFT HYROX must not hydrate");
assert.equal(hydratedMidtown, undefined, "retired Midtown HYROX must not hydrate");
assert.ok(hydratedQuarryBay, "live operations must hydrate the Island ECC HYROX session");
assert.ok(hydratedQuarryBayEarly, "live operations must hydrate the early Island ECC HYROX session");
assert.ok(
  operationalTableRows.operational_sessions
    .filter((row) => row.activity_id === "hyrox-quarry-bay")
    .every((row) => row.capacity === 30),
  "every live Quarry Bay HYROX session fixture must have capacity 30"
);
assert.deepEqual({
  time: hydratedQuarryBay.time,
  durationMin: hydratedQuarryBay.durationMin,
  location: hydratedQuarryBay.location,
  mapsQuery: hydratedQuarryBay.mapsQuery,
  price: hydratedQuarryBay.price,
  capacity: hydratedQuarryBay.capacity,
  isOpen: hydratedQuarryBay.isOpen,
}, {
  time: "10:30",
  durationMin: 60,
  location: "10/F, Island ECC, Quarry Bay",
  mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
  price: 180,
  capacity: 30,
  isOpen: true,
});
assert.deepEqual({
  time: hydratedQuarryBayEarly.time,
  durationMin: hydratedQuarryBayEarly.durationMin,
  location: hydratedQuarryBayEarly.location,
  mapsQuery: hydratedQuarryBayEarly.mapsQuery,
  price: hydratedQuarryBayEarly.price,
  capacity: hydratedQuarryBayEarly.capacity,
  isOpen: hydratedQuarryBayEarly.isOpen,
}, {
  time: "09:15",
  durationMin: 60,
  location: "10/F, Island ECC, Quarry Bay",
  mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
  price: 180,
  capacity: 30,
  isOpen: true,
});
assert.equal(hydratedQuarryBay.photo, "../assets/itc/hyrox.webp");
assert.match(views.viewActivity(hydratedQuarryBay.id),
  /class="detail-photo" src="\.\.\/assets\/itc\/hyrox\.webp"/);

const appSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
assert.match(appSource, /form\.dataset\.form === "apply"/);
assert.match(appSource, /payload\.waiver = !!fd\.get\("waiver"\)/);
assert.match(appSource, /await store\.saveMyApplication\(payload\)/);
assert.match(appSource, /form\.dataset\.form === "membership-details"/);
assert.match(appSource, /await store\.updateMyMembershipDetails\(/);
assert.match(appSource, /await store\.acceptMyIndemnity\(\{/);
assert.match(appSource, /const acceptButton = form\.querySelector\("\[data-doc-submit\]"\)/);
assert.match(appSource, /acceptButton\.disabled/);
assert.match(appSource, /signature:\s*fd\.get\("signature"\)/);
assert.match(appSource, /signedAt:\s*fd\.get\("signedAt"\)/);
assert.match(appSource, /emergencyRelationship:\s*fd\.get\("emergencyRelationship"\)/);
assert.match(appSource, /t\.name !== "age_over_18"/);
assert.match(appSource, /const APPLY_DRAFT_DEBOUNCE_MS = 500/);
assert.match(appSource, /case "save-draft"/);
assert.match(appSource, /case "discard-draft"/);
assert.match(appSource, /store\.saveApplyDraft/);
assert.match(appSource, /store\.clearApplyDraft/);
assert.match(appSource, /function consumeAuthCallbackError\(/);
assert.match(appSource, /bad_oauth_state/);
assert.match(appSource, /That Google sign-in expired/);

await store.setWeekVenue("wnt-2026-08-05", {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
  wasTBC: true,
});
await operations.refreshOperationalState();
const lastVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.equal(lastVenueCall.args.p_session_id, "wnt-2026-08-05");
assert.equal(lastVenueCall.args.p_location, "Central Harbourfront — 7pm sharp");
assert.equal(lastVenueCall.args.p_maps_query, "Central Harbourfront, Hong Kong");
assert.equal(lastVenueCall.args.p_was_tbc, true);
assert.equal(lastVenueCall.args.p_meeting_lat, null);
assert.equal(lastVenueCall.args.p_meeting_lng, null);
assert.equal(lastVenueCall.name, "set_session_venue");
assert.deepEqual(operations.getLiveVenueOverride("wnt-2026-08-05"), {
  sessionId: "wnt-2026-08-05",
  activityId: "wnt",
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
  meetingLat: null,
  meetingLng: null,
  setBy: authUser.id,
  setAt: Date.parse(fixedIso),
  memberNotifiedAt: Date.parse(fixedIso),
});
const realtimeHandlers = operationalSubscriptions
  .flatMap((channel) => channel.handlers);
assert.ok(
  operationalSubscriptions.some((channel) =>
    channel.handlers.length >= LIVE_TABLES_COUNT),
  "Realtime channel should subscribe to every operational table"
);
assert.ok(operations.LIVE_TABLES.includes("collector_payout_profiles"),
  "the payout table must remain part of the operational Realtime contract");
assert.ok(realtimeHandlers.some(({ filter }) =>
  filter.table === "collector_payout_profiles"),
"the operational channel must retain assigned-payout refreshes");
assert.ok(operations.LIVE_TABLES.includes("operational_rsvp_counts"),
  "the count table must be part of the operational Realtime contract");
assert.ok(realtimeHandlers.some(({ filter }) =>
  filter.table === "operational_rsvp_counts"),
"the operational channel must subscribe to identity-free RSVP count changes");
assert.equal(operations.operationalStateStatus().loaded, true);

// The mutation result is authoritative even when the best-effort full refresh
// immediately after it fails. A rerender must see the just-saved override.
const cacheFirstSessionId = "water-2026-08-11";
operationalVenueOverrideReadError = { message: "simulated venue override refresh failure" };
const refreshWarnings = [];
const consoleWarnBeforeCacheTest = console.warn;
console.warn = (...args) => refreshWarnings.push(args);
await store.setWeekVenue(cacheFirstSessionId, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
});
console.warn = consoleWarnBeforeCacheTest;
assert.ok(
  refreshWarnings.some(([message]) => message === "operations refresh after rpc failed"),
  "the live regression must exercise the failed best-effort refresh path"
);
assert.deepEqual(operations.getLiveVenueOverride(cacheFirstSessionId), {
  sessionId: cacheFirstSessionId,
  activityId: "water",
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
  meetingLat: null,
  meetingLng: null,
  setBy: authUser.id,
  setAt: Date.parse(fixedIso),
  memberNotifiedAt: Date.parse(fixedIso),
});
const cacheFirstDecoratedSession = store.getSession(cacheFirstSessionId);
assert.equal(cacheFirstDecoratedSession.location, "Victoria Park Swimming Pool");
assert.equal(cacheFirstDecoratedSession.mapsQuery, "Victoria Park Swimming Pool, Hong Kong");
await operations.refreshOperationalState();
assert.equal(
  operations.operationalStateStatus().error,
  null,
  "a one-shot refresh failure must not poison later operational refreshes"
);
console.log("ok  successful venue RPC updates live cache before a failed refresh");

const partialLiveSessionId = "water-2026-08-27";
await store.setWeekVenue(partialLiveSessionId, {
  location: "",
  mapsQuery: "Sun Yat Sen Pool, Hong Kong",
});
const partialLiveOverride = operations.getLiveVenueOverride(partialLiveSessionId);
const partialLiveSession = store.getSession(partialLiveSessionId);
assert.equal(partialLiveOverride.memberNotifiedAt, null);
assert.equal(partialLiveSession.location, "TBC");
assert.notEqual(partialLiveSession.venueTBC, false);
await store.setWeekVenue(partialLiveSessionId, {
  location: "Sun Yat Sen Memorial Park Swimming Pool",
  mapsQuery: "Sun Yat Sen Pool, Hong Kong",
});
assert.equal(
  operations.getLiveVenueOverride(partialLiveSessionId).memberNotifiedAt,
  Date.parse(fixedIso),
  "completing a live partial override must consume member dedupe only then"
);
console.log("ok  live partial venue remains TBC until both values confirm it");

const signedOutHome = views.viewHome();
assert.match(signedOutHome, /data-action="sign-in-google"[^>]*>Continue with Google</);
assert.match(signedOutHome, /href="#\/account"[^>]*>Use an email link instead</);
assert.doesNotMatch(signedOutHome, /href="#\/account"[^>]*>Sign in or join</);
store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
const signedOutHomeWithDraft = views.viewHome();
const signedOutAccount = await views.viewAccount();
assert.doesNotMatch(
  signedOutHomeWithDraft,
  /Continue your application|Unfinished application|Sign in to continue|data-draft-resume/,
  "live signed-out Home must not advertise a device draft before sign-in"
);
assert.doesNotMatch(
  signedOutAccount,
  /Continue your application|Unfinished application|Sign in to continue|data-draft-resume/,
  "live signed-out Account must not advertise a device draft before sign-in"
);
assert.match(signedOutAccount, /data-action="sign-in-google"/);
assert.match(
  signedOutAccount,
  /Use your Google account to sign in to Island Training Club\.<\/p>\s*<p class="muted small mt8">New here\?/,
  "Account sign-in copy must separate Google sign-in from the new-member application note"
);
assert.match(signedOutAccount, /id="form-magic-link"/);
assert.match(signedOutAccount, /<input(?=[^>]*name="email")(?=[^>]*type="email")[^>]*>/);
assert.match(signedOutAccount, /Email me a sign-in link/);
assert.ok(
  signedOutAccount.indexOf('data-action="sign-in-google"')
    < signedOutAccount.indexOf('id="form-magic-link"'),
  "Google must remain before the email alternative"
);
store.clearApplyDraft();

await store.getCurrentUser();
prayerRpcErrors.set("list_my_prayer_requests", { message: "sensitive stale row failure" });
const failedPrayerListHtml = await views.viewCommunity("prayers");
prayerRpcErrors.delete("list_my_prayer_requests");
assert.match(failedPrayerListHtml, /could not be loaded[\s\S]*try again/i,
  "a failed authoritative Prayer list must render safe retryable feedback");
assert.match(failedPrayerListHtml, /data-action="retry-prayer-requests"/,
  "a failed Prayer list must expose a retry control");
assert.doesNotMatch(failedPrayerListHtml, /Never expose this as a live fallback/,
  "a failed live Prayer list must never render device-local rows");
prayerRpcErrors.set("list_admin_prayer_requests", { message: "sensitive Admin prayer list failure" });
const failedAdminPrayerListHtml = await views.viewAdmin("prayers");
prayerRpcErrors.delete("list_admin_prayer_requests");
assert.match(failedAdminPrayerListHtml, /could not be loaded[\s\S]*try again/i,
  "a failed authoritative Admin Prayer list must render safe retryable feedback");
assert.match(failedAdminPrayerListHtml, /data-action="retry-admin-prayer-requests"/,
  "a failed Admin Prayer list must expose a retry control");
assert.doesNotMatch(failedAdminPrayerListHtml,
  /Never expose this as a live fallback|sensitive Admin prayer list failure/,
  "a failed live Admin Prayer list must expose neither stale rows nor backend errors");
for (const failure of assignedPayoutFailures) {
  operationalRpcHandler = (name, args) => {
    if (name === "get_assigned_collector_payout_profiles") {
      operationalRpcCalls.push({ name, args: structuredClone(args) });
      return Promise.resolve({ data: null, error: { message: failure.message } });
    }
    return successfulAssignedPayoutHandler(name, args);
  };
  await store.hydrateLiveOperations({ force: true });
  const activitiesHtml = await views.viewAdmin("activities");
  assert.equal(typeof activitiesHtml, "string",
    `${failure.label} must keep the Admin Activities route available`);
  assert.ok(!activitiesHtml.includes("No upcoming paid sessions."),
    `${failure.label} payout enrichment must preserve Admin paid controls`);
}
operationalRpcHandler = successfulAssignedPayoutHandler;
await store.hydrateLiveOperations({ force: true });
assert.equal(operations.operationalStateStatus().payoutError, null,
  "successful Admin hydration must clear payout degradation");
const liveRosterHtml = await views.viewAdmin("payments");
const liveRosterStart = liveRosterHtml.indexOf(`data-payment-roster="${islandEccSessionId}"`);
const liveRoster = liveRosterStart < 0 ? "" : liveRosterHtml.slice(liveRosterStart);
assert.match(liveRoster, /Payment roster[\s\S]*Micah Member[\s\S]*Paid/);
assert.doesNotMatch(liveRoster, /micah\.member@example\.com/i,
  "live financial roster must use the Admin directory without exposing email");
console.log("ok  live Admin Payments renders directory-backed financial names");

// Avatar adapters use only authenticated Edge Functions and keep signed URLs
// in memory. Cache hits avoid resolver traffic; mutations replace that cache.
const firstAvatar = await store.getOwnAvatar();
assert.equal(firstAvatar.source, "google");
assert.equal(avatarResolveCalls.length, 1);
assert.equal(new URL(avatarResolveCalls[0].url).searchParams.get("scope"), "self");
assert.equal(avatarResolveCalls[0].options.method, "GET");
assert.equal(avatarResolveCalls[0].options.headers.Authorization, "Bearer test-access-token");
assert.equal(avatarResolveCalls[0].options.headers.apikey, "test-anon-key");
await store.getOwnAvatar();
assert.equal(avatarResolveCalls.length, 1, "fresh own-avatar cache should suppress duplicate resolution");
await store.getOwnAvatar({ force: true });
assert.equal(avatarResolveCalls.length, 2, "forced own-avatar resolution should replace cache");

avatarPresentation.state = "unexpected";
store.clearAvatarCache();
assert.deepEqual(
  await store.getOwnAvatar(),
  { profileId: "live-user-1", url: null, source: "initials", state: "hidden", expiresAt: null },
  "malformed resolver state must fail closed without returning its signed URL",
);
avatarPresentation.state = "active";

avatarPresentation.expiresAt = null;
store.clearAvatarCache();
const unsignedExpiryResolveCount = avatarResolveCalls.length;
await store.getOwnAvatar();
await store.getOwnAvatar();
assert.equal(avatarResolveCalls.length, unsignedExpiryResolveCount + 2,
  "a signed URL without expiry metadata must never be cached indefinitely");
avatarPresentation.expiresAt = "2026-08-05T02:10:00.000Z";
store.clearAvatarCache();

const uploadedAvatar = await store.uploadMyAvatar(new Blob(["jpeg"], { type: "image/jpeg" }));
assert.equal(uploadedAvatar.source, "custom");
const uploadCall = avatarFunctionCalls.at(-1);
assert.equal(uploadCall.name, "process-profile-avatar");
assert.equal(uploadCall.options.method, "POST");
assert.ok(uploadCall.options.body instanceof FormData);
assert.equal(uploadCall.options.body.get("action"), "upload");
assert.ok(uploadCall.options.body.get("file") instanceof Blob);
const resolveCountAfterUpload = avatarResolveCalls.length;
assert.equal((await store.getOwnAvatar()).source, "custom");
assert.equal(avatarResolveCalls.length, resolveCountAfterUpload, "upload should replace own cache");

const removedAvatar = await store.removeMyAvatar();
assert.equal(removedAvatar.source, "google");
const removeCall = avatarFunctionCalls.at(-1);
assert.equal(removeCall.name, "process-profile-avatar");
assert.equal(removeCall.options.method, "DELETE");
assert.equal((await store.getOwnAvatar()).source, "google");

avatarInvokeError = { message: "sensitive service-role detail", context: { status: 500 } };
await assert.rejects(
  store.uploadMyAvatar(new Blob(["jpeg"], { type: "image/jpeg" })),
  (error) => /could not be saved/i.test(error.message) && !/service-role/i.test(error.message),
);
avatarInvokeError = null;
assert.equal((await store.uploadMyAvatar(new Blob(["jpeg"], { type: "image/jpeg" }))).source, "custom",
  "avatar mutation must recover after an error");

store.clearAvatarCache();
avatarResolveStatus = 401;
await assert.rejects(
  store.getOwnAvatar(),
  (error) => /sign in again/i.test(error.message) && !/sensitive/i.test(error.message),
);
avatarResolveStatus = 200;
assert.equal((await store.getOwnAvatar()).source, "custom", "401 must not leave a rejected request cached");
const syncBefore = avatarFunctionCalls.length;
await store.syncGoogleAvatar();
assert.equal(avatarFunctionCalls.length, syncBefore + 1);
assert.deepEqual(avatarFunctionCalls.at(-1), {
  name: "process-profile-avatar",
  options: { method: "POST", body: { action: "sync_google" } },
});

const sessionResolveBefore = avatarResolveCalls.length;
const sessionAvatars = await store.getSessionAvatars("hyrox-2026-08-15");
assert.equal(sessionAvatars[0].displayName, "Alex T.");
assert.equal(avatarResolveCalls.length, sessionResolveBefore + 1);
const sessionResolveUrl = new URL(avatarResolveCalls.at(-1).url);
assert.equal(sessionResolveUrl.searchParams.get("scope"), "session");
assert.equal(sessionResolveUrl.searchParams.get("sessionId"), "hyrox-2026-08-15");
await store.getSessionAvatars("hyrox-2026-08-15");
assert.equal(avatarResolveCalls.length, sessionResolveBefore + 1,
  "session avatar rows should use their fresh in-memory cache");

const adminRows = await store.getAdminAvatarRows();
assert.equal(adminRows.length, 2);
assert.equal(adminRows.find((row) => row.state === "pending_review").pendingPreviewUrl.includes("pending.jpg"), true);
const adminResolveUrl = new URL(avatarResolveCalls.at(-1).url);
assert.equal(adminResolveUrl.searchParams.get("scope"), "admin_members");
const adminAvatarHtml = await views.viewAdmin("members");
assert.match(adminAvatarHtml, /Profile photo review/);
assert.match(adminAvatarHtml, /data-action="avatar-hide"/);
assert.match(adminAvatarHtml, /data-action="avatar-approve"/);
assert.match(adminAvatarHtml, /data-action="avatar-reject"/);
assert.match(adminAvatarHtml, /data-avatar-moderation-reason/);
store.clearAvatarCache();
avatarResolveStatus = 500;
const unavailableAdminAvatarHtml = await views.viewAdmin("members");
avatarResolveStatus = 200;
assert.match(unavailableAdminAvatarHtml, /Photo review status unavailable/);
assert.doesNotMatch(unavailableAdminAvatarHtml, /No profile photos awaiting review/);
assert.doesNotMatch(await views.viewAccount(), /data-action="avatar-(?:hide|approve|reject)"/,
  "member Profile must never contain moderation controls");

const moderationCallsBeforeValidation = avatarFunctionCalls.length;
await assert.rejects(store.moderateAvatar("approved-admin", "hide", "   "), /reason is required/i);
await assert.rejects(store.moderateAvatar("approved-member", "reject", ""), /reason is required/i);
assert.equal(avatarFunctionCalls.length, moderationCallsBeforeValidation,
  "invalid moderation must fail before an Edge Function call");
const activeRowBackup = structuredClone(avatarAdminRows[0]);
const hiddenPresentation = await store.moderateAvatar("approved-admin", "hide", "  Inappropriate image  ");
assert.equal(hiddenPresentation.state, "hidden");
assert.deepEqual(avatarFunctionCalls.at(-1), {
  name: "moderate-profile-avatar",
  options: {
    method: "POST",
    body: { profileId: "approved-admin", action: "hide", reason: "Inappropriate image" },
  },
});
Object.assign(avatarAdminRows[0], activeRowBackup);
store.clearAvatarCache();
const pendingRowBackup = structuredClone(avatarAdminRows[1]);
const approvedPresentation = await store.moderateAvatar("approved-member", "approve");
assert.equal(approvedPresentation.state, "active");
assert.deepEqual(avatarFunctionCalls.at(-1), {
  name: "moderate-profile-avatar",
  options: {
    method: "POST",
    body: { profileId: "approved-member", action: "approve" },
  },
});
Object.assign(avatarAdminRows[1], pendingRowBackup);
store.clearAvatarCache();
avatarModerationError = { message: "sensitive audit detail", context: { status: 500 } };
await assert.rejects(
  store.moderateAvatar("approved-member", "reject", "Not suitable"),
  (error) => /could not be completed/i.test(error.message) && !/audit/i.test(error.message),
);
avatarModerationError = null;
assert.equal((await store.getAdminAvatarRows({ force: true })).some((row) => row.state === "pending_review"), true,
  "failed moderation must preserve the pending row and recover cleanly");

const storeSourceForAvatar = readFileSync(resolve(__dirnameSmoke, "js/store.js"), "utf8");
assert.doesNotMatch(storeSourceForAvatar, /supabase[.]storage|[.]storage[.]from/,
  "browser avatar adapters must never mutate Storage directly");

const approvedRole = store.currentUser().role;
store.currentUser().role = "unexpected_role";
store.clearAvatarCache();
const malformedRoleResolveCount = avatarResolveCalls.length;
assert.equal((await store.getOwnAvatar()).source, "initials");
assert.equal(avatarResolveCalls.length, malformedRoleResolveCount,
  "unknown roles must never call the avatar resolver");
await assert.rejects(
  store.uploadMyAvatar(new Blob(["jpeg"], { type: "image/jpeg" })),
  /Approved membership is required/,
);
store.currentUser().role = approvedRole;
store.clearAvatarCache();

const originalProfileForApply = structuredClone(profile);
const originalApplicationForApply = structuredClone(applicationRows.get(authUser.id));
Object.assign(profile, { role: "pending", full_name: null });
applicationRows.delete(authUser.id);
await store.getCurrentUser();
const pendingAvatarResolveCount = avatarResolveCalls.length;
assert.deepEqual(await store.getSessionAvatars("hyrox-2026-08-15"), []);
assert.deepEqual(await store.getAdminAvatarRows(), []);
assert.equal(avatarResolveCalls.length, pendingAvatarResolveCount,
  "pending viewers must not call attendee or Admin avatar scopes");
const liveApplyHtml = await views.viewApply();
assert.match(liveApplyHtml, /data-form="apply"/);
assert.match(liveApplyHtml, /name="full_name"[^>]*required/);
assert.match(liveApplyHtml, /name="full_name"[^>]*autocomplete="name"/);
assert.match(liveApplyHtml, /name="preferred_name"/);
assert.ok(
  liveApplyHtml.indexOf('name="full_name"') < liveApplyHtml.indexOf('name="preferred_name"')
    && liveApplyHtml.indexOf('name="preferred_name"') < liveApplyHtml.indexOf('name="mobile"'),
  "live apply must place preferred name after full name and before mobile"
);
assert.match(liveApplyHtml, /name="mobile"/);
assert.match(liveApplyHtml, /name="age_over_18"/);
for (const name of ["emergency_relationship", "waiver_signature_text", "waiver_signed_at"]) {
  assert.match(liveApplyHtml, new RegExp(`name="${name}"`));
}
assert.match(liveApplyHtml, /name="waiver"/);
assert.match(liveApplyHtml, /data-doc-accept="indemnity"/);
assert.match(liveApplyHtml, /name="waiver"[^>]*disabled[^>]*data-doc-checkbox/);
assert.match(liveApplyHtml, new RegExp(`name="waiver_signed_at"[^>]*value="${todayISO}"`));
assert.match(liveApplyHtml, new RegExp(`name="waiver_signed_at"[^>]*max="${todayISO}"`));
assert.ok(
  liveApplyHtml.indexOf('data-doc-accept="privacy"')
    < liveApplyHtml.indexOf('data-doc-accept="guidelines"')
    && liveApplyHtml.indexOf('data-doc-accept="guidelines"')
      < liveApplyHtml.indexOf('data-doc-accept="indemnity"')
    && liveApplyHtml.indexOf('data-doc-accept="indemnity"')
      < liveApplyHtml.indexOf('name="waiver_signature_text"')
    && liveApplyHtml.indexOf('name="waiver_signature_text"')
      < liveApplyHtml.indexOf('name="waiver_signed_at"'),
  "live apply must put indemnity, signature, and signing date after community guidelines"
);
assert.doesNotMatch(liveApplyHtml, /name="email"/);

store.saveApplyDraft({
  profileId: "someone-else",
  fields: { mobile: "+852 0000 0000", full_name: "Other Person" },
});
assert.equal(
  store.getApplyDraft({ profileId: authUser.id }),
  null,
  "a draft owned by another profile must not resume for this signed-in applicant"
);
assert.doesNotMatch(
  await views.viewApply(),
  /Other Person|data-draft-resume/,
  "live apply must not resume another account's unfinished form"
);
assert.equal(
  store.getApplyDraft({ profileId: "someone-else" })?.fields?.full_name,
  "Other Person",
  "opening apply as one account must not delete another account's owned draft"
);
store.clearApplyDraft({ profileId: "someone-else" });
localStorage.setItem("itc.apply.drafts.v2", JSON.stringify({
  __unclaimed__: {
    version: 2,
    deviceId: store.getApplyDeviceId(),
    profileId: null,
    savedAt: Date.now(),
    fields: { full_name: "Unclaimed Leftover", mobile: "+852 1111 2222" },
  },
  "ops-admin": {
    version: 2,
    deviceId: store.getApplyDeviceId(),
    profileId: "ops-admin",
    savedAt: Date.now(),
    fields: { full_name: "Ops Admin Draft", mobile: "+852 3333 4444" },
  },
}));
assert.equal(
  store.getApplyDraft({ profileId: authUser.id }),
  null,
  "an unclaimed browser draft must never be claimed by the next signed-in account"
);
assert.doesNotMatch(
  await views.viewApply(),
  /Unclaimed Leftover|Ops Admin Draft|data-draft-resume/,
  "live apply must ignore unclaimed leftovers and other accounts' drafts on this device"
);
assert.equal(
  store.getApplyDraft(),
  null,
  "opening live apply must clear unclaimed leftovers so they cannot merge later"
);
assert.equal(
  store.getApplyDraft({ profileId: "ops-admin" })?.fields?.full_name,
  "Ops Admin Draft",
  "another Google account's owned draft must remain untouched on the same device"
);
const inherited = store.saveApplyDraft({
  profileId: authUser.id,
  fields: { preferred_name: "Riley" },
});
assert.equal(inherited?.fields?.full_name, undefined,
  "signed-in saves must not inherit fields from a cleared unclaimed leftover");
assert.equal(inherited?.fields?.preferred_name, "Riley");
assert.equal(
  store.getApplyDraft({ profileId: "ops-admin" })?.fields?.full_name,
  "Ops Admin Draft",
  "saving one account's draft must not overwrite another account's draft"
);
store.clearApplyDraft({ profileId: authUser.id });
assert.equal(
  store.getApplyDraft({ profileId: "ops-admin" })?.fields?.full_name,
  "Ops Admin Draft",
  "clearing one account's draft must not remove another account's draft"
);
store.clearApplyDraft({ profileId: "ops-admin" });
store.saveApplyDraft({
  profileId: authUser.id,
  fields: {
  full_name: "Riley Magic",
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  emergency_name: "Taylor Coach",
  emergency_relationship: "Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  preferred_name: "Riley",
  photo_consent: true,
  waiver: true,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
  privacy: true,
  guidelines: true,
} });
const draftApplyHtml = await views.viewApply();
assert.match(draftApplyHtml, /data-draft-resume/);
assert.match(draftApplyHtml, /name="full_name" value="Riley Magic"/);
assert.match(draftApplyHtml, /value="\+852 6123 4567"/);
assert.match(draftApplyHtml, /name="age_over_18" value="yes" checked/);
assert.match(draftApplyHtml, /name="emergency_relationship" value="Coach"/);
assert.match(draftApplyHtml, /name="waiver_signature_text" value="Riley Runner"/);
assert.match(draftApplyHtml, /name="waiver_signed_at" value="2026-08-05"/);
assert.match(draftApplyHtml, /data-action="save-draft"/);
assert.match(draftApplyHtml, /data-action="discard-draft"/);

const liveApplyPayload = {
  full_name: "  Riley Magic  ",
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  guardian_name: "",
  guardian_phone: "",
  emergency_name: "Taylor Coach",
  emergency_relationship: "Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  heard_detail: "",
  preferred_name: "Riley",
  photo_consent: false,
  waiver: true,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
};
for (const [label, overrides] of [
  ["missing emergency name", { emergency_name: "" }],
  ["missing emergency phone", { emergency_phone: "" }],
]) {
  await assert.rejects(
    () => store.saveMyApplication({ ...liveApplyPayload, ...overrides }),
    /Enter emergency contact name, relationship and phone/,
    `${label} should be rejected during live application submit`
  );
}
await assert.rejects(
  () => store.saveMyApplication({ ...liveApplyPayload, full_name: "   " }),
  /Enter your full name/
);

profileUpdateError = new Error("Profile name unavailable");
await assert.rejects(
  () => store.saveMyApplication(liveApplyPayload),
  /Profile name unavailable/
);
assert.equal(
  applicationRows.has(authUser.id),
  false,
  "application must not be written after profile-name failure"
);
profileUpdateError = null;

const profileUpdatesBeforeApplication = profileUpdates.length;
await store.saveMyApplication(liveApplyPayload);
assert.equal(profile.full_name, "Riley Magic");
assert.ok(profileUpdates.slice(profileUpdatesBeforeApplication).some((update) =>
  update.id === authUser.id && update.full_name === "Riley Magic"
));
assert.equal(applicationRows.get(authUser.id).profile_id, authUser.id);
assert.equal((await store.getCurrentUser()).fullName, "Riley Magic");
assert.equal(store.getApplyDraft(), null, "successful live submit must clear its draft");

Object.assign(profile, originalProfileForApply);
if (originalApplicationForApply) applicationRows.set(authUser.id, originalApplicationForApply);
await store.getCurrentUser();
const queue = await store.listApprovalCandidates();
const submitted = queue.find((item) => item.id === "pending-submitted");
const incomplete = queue.find((item) => item.id === "pending-incomplete");
if (!submitted?.applicationSubmitted || incomplete?.applicationSubmitted !== false) {
  throw new Error("Approval queue must include both pending groups");
}
if (queue.some((item) => item.id === authUser.id)) {
  throw new Error("Approved/admin profiles must not enter the approval queue");
}
const approvalsHtml = await views.viewAdmin("approvals");
assert.match(approvalsHtml, /Ready for review \(1\)/);
assert.match(approvalsHtml, /Awaiting application \(1\)/);
const readyForReviewStart = approvalsHtml.indexOf("Ready for review (1)");
const awaitingApplicationStart = approvalsHtml.indexOf("Awaiting application (1)");
const readyForReviewHtml = approvalsHtml.slice(readyForReviewStart, awaitingApplicationStart);
assert.match(readyForReviewHtml, /data-applicant-name="Submitted Runner"/,
  "the submitted application must render in Ready for review");
assert.doesNotMatch(readyForReviewHtml, /data-applicant-name="Incomplete Runner"/,
  "an incomplete application must not render in Ready for review");
if (!approvalsHtml.includes("Application not submitted")) {
  throw new Error("Approvals must explain incomplete pending profiles");
}
assert.match(approvalsHtml, /<dt>Indemnity<\/dt><dd>Accepted<\/dd>/);
const submittedApplication = structuredClone(applicationRows.get("pending-submitted"));
applicationRows.set("pending-submitted", {
  ...submittedApplication,
  emergency_phone: "",
});
const reviewRequiredHtml = await views.viewAdmin("approvals");
assert.match(reviewRequiredHtml, /<dt>Indemnity<\/dt><dd>Review required<\/dd>/);
applicationRows.set("pending-submitted", submittedApplication);
const submittedProfile = pendingProfiles.find((item) => item.id === "pending-submitted");
const incompleteProfile = pendingProfiles.find((item) => item.id === "pending-incomplete");
submittedProfile.role = "member";
const readyEmptyHtml = await views.viewAdmin("approvals");
assert.match(readyEmptyHtml, /Ready for review \(0\)[\s\S]*No applications ready for review\./);
assert.match(readyEmptyHtml, /Awaiting application \(1\)/);
submittedProfile.role = "pending";
incompleteProfile.role = "member";
const awaitingEmptyHtml = await views.viewAdmin("approvals");
assert.match(awaitingEmptyHtml, /Ready for review \(1\)/);
assert.match(awaitingEmptyHtml, /Awaiting application \(0\)[\s\S]*No members awaiting an application\./);
submittedProfile.role = "member";
const allEmptyHtml = await views.viewAdmin("approvals");
assert.doesNotMatch(allEmptyHtml, /data-approval-card|Ready for review|Awaiting application/,
  "Members must omit the approval groups when no pending profiles remain");
submittedProfile.role = "pending";
incompleteProfile.role = "pending";
const decisionButton = (profileId, action) => approvalsHtml.match(
  new RegExp(`<button[^>]*data-action="${action}"[^>]*data-user="${profileId}"[^>]*>`)
)?.[0] || "";
for (const action of ["approve", "decline"]) {
  assert.match(decisionButton("pending-incomplete", action), /\sdisabled(?:\s|>)/,
    `Incomplete ${action} must be disabled`);
  assert.doesNotMatch(decisionButton("pending-submitted", action), /\sdisabled(?:\s|>)/,
    `Submitted ${action} must be enabled`);
}
const liveActivitiesHtml = await views.viewAdmin("activities");
assert.equal((liveActivitiesHtml.match(/>Weekly Event Controls</g) || []).length, 1,
  "Live Admin Activities must render exactly one Weekly Event Controls section");
assert.match(liveActivitiesHtml, /Free &amp; RSVP Events/);
assert.match(liveActivitiesHtml, /Paid Sessions/);
assert.doesNotMatch(liveActivitiesHtml, />Weekly Venue Overrides<|>Weekly Session Overrides</);
const liveWeeklyControlsStart = liveActivitiesHtml.indexOf(">Weekly Event Controls<");
const liveOneOffEventsStart = liveActivitiesHtml.indexOf(">One-off Events<");
const liveWeeklyControlsHtml = liveWeeklyControlsStart === -1 || liveOneOffEventsStart === -1
  ? ""
  : liveActivitiesHtml.slice(liveWeeklyControlsStart, liveOneOffEventsStart);
for (const sessionId of authoritativeFreeSessionIds) {
  const cardMarker = `data-session="${sessionId}"`;
  assert.ok(liveWeeklyControlsHtml.includes(cardMarker),
    `${sessionId} must render dated Admin controls`);
  const markerIndex = liveWeeklyControlsHtml.indexOf(cardMarker);
  const cardStart = liveWeeklyControlsHtml.lastIndexOf('<div class="card mt16', markerIndex);
  const cardEnd = liveWeeklyControlsHtml.indexOf('</div></div>', markerIndex);
  const cardHtml = liveWeeklyControlsHtml.slice(cardStart, cardEnd + 12);
  assert.match(cardHtml, /\d+ going/,
    `${sessionId} must display its attendee count even though its presentation kind is free`);
  assert.match(cardHtml,
    new RegExp(`id="form-cancel-week"[^>]*data-session="${sessionId}"`),
    `${sessionId} must expose per-occurrence cancellation`);
}
for (const marker of [
  'data-action="form-week-venue"',
  'data-action="reset-week-venue"',
  "Cancel this week's event",
  'id="form-session-time"',
  'id="form-session-notice"',
  'data-action="venue-tbc-toggle"',
  'id="form-cancel-week"',
]) {
  assert.ok(liveWeeklyControlsHtml.includes(marker),
    `Live Weekly Event Controls must preserve ${marker}`);
}
assert.match(liveWeeklyControlsHtml, /\d+ going/,
  "Live Weekly Event Controls must preserve the RSVP count");
assert.ok(liveWeeklyControlsStart < liveOneOffEventsStart,
  "Live One-off Events must follow Weekly Event Controls");
assert.match(liveActivitiesHtml,
  /aria-labelledby="paid-sessions-title">[\s\S]*<\/section>\s*<\/details>\s*<details class="admin-section mt24">\s*<summary><h2>One-off Events<\/h2>/,
  "Live One-off Events must remain outside Weekly Event Controls");
assert.match(liveActivitiesHtml, /Weekly Event Controls &gt; Free &amp; RSVP Events/);
assert.doesNotMatch(liveActivitiesHtml, /BFT Causeway Bay \(BFT\)|Midtown28 Fitness \(Midtown\)/,
  "Live Admin Activities must not append redundant HYROX venue suffixes");
assert.doesNotMatch(liveActivitiesHtml, /confirmed in-app|awaiting payment|Not open/,
  "Live Admin Activities must not carry HYROX booking/payment status");
const livePaymentsHtml = await views.viewAdmin("payments");
for (const [surface, html] of [
  ["Live Admin Activities", liveActivitiesHtml],
  ["Live Admin Payments", livePaymentsHtml],
]) {
  assert.doesNotMatch(html, /BFT|Midtown|shared pool|venue allocation|switch queue|weekly booking setup/i,
    `${surface} must not render retired pool operations`);
  assert.doesNotMatch(html,
    /hyrox-allocation-close|midtown-toggle|form-cancel-hyrox-cycle|hyrox-plan-retry|form-hyrox-payment-reject/,
    `${surface} must not expose retired pool action contracts`);
  assert.match(html, /Island ECC/, `${surface} must retain Island ECC administration`);
}
const liveIslandEccRosters = [...livePaymentsHtml.matchAll(
  /data-payment-roster="(hyrox-quarry-bay-[^"]+)"/g
)].map((match) => match[1]);
assert.ok(liveIslandEccRosters.length > 0, "Live Admin Payments must render Island ECC");
assert.equal(new Set(liveIslandEccRosters).size, liveIslandEccRosters.length,
  "Live Admin Payments must render each Island ECC session once");
assert.match(livePaymentsHtml, /Payment reconciliation|HYROX booking &amp; payment/,
  "Live Admin Payments must carry Island ECC payment controls");
for (const contract of [
  'case "confirm-payment"', 'case "attendance-toggle"', 'case "replacement-decision"',
  'case "join-waitlist"', 'case "leave-waitlist"', 'case "cancel-booking"',
  'case "form-gym-note"',
]) {
  assert.ok(appSource.includes(contract), `direct Island ECC handler must remain: ${contract}`);
}
for (const contract of ['case "hyrox-plan-retry"', 'case "midtown-toggle"']) {
  assert.equal(appSource.includes(contract), false, `retired Admin pool handler remains: ${contract}`);
}
const liveActivityEditorHtml = views.viewAdminActivity("wnt");
assert.match(liveActivityEditorHtml, /Weekly Event Controls &gt; Free &amp; RSVP Events/);
console.log("ok  live Admin Activities groups dated controls without changing form contracts");

const membersHtml = await views.viewAdmin("members");
assert.doesNotMatch(membersHtml, /member-summary|Member status counts|data-change="member-(?:status|role)-filter"/);
for (const [key, options] of Object.entries({
  status: [["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["declined", "Declined"]],
  role: [["all", "All roles"], ["member", "Member"], ["admin", "Admin"], ["superadmin", "Super Admin"]],
})) {
  for (const [value, label] of options) {
    assert.match(membersHtml, new RegExp(`<button[^>]*data-action="admin-member-filter"[^>]*data-filter-key="${key}"[^>]*data-filter-value="${value}"[^>]*aria-pressed="${value === "all"}"[^>]*>${label}</button>`));
  }
}
assert.doesNotMatch(membersHtml, /Clear filters/);
if (!/Declined Runner[\s\S]*badge danger">Declined</.test(membersHtml)) {
  throw new Error("Members must badge declined profiles as Declined");
}
assert.match(membersHtml, />Super Admin</);
assert.match(membersHtml, />Admin</);
assert.match(membersHtml, />Member</);
assert.doesNotMatch(membersHtml, />super_?admin</i, "Raw role spellings must not appear as labels");
assert.match(membersHtml, /Search members/);
assert.match(membersHtml, /Status/);
assert.match(membersHtml, /Role/);
views.adminMemberFilters.query = "tina";
views.adminMemberFilters.status = "approved";
views.adminMemberFilters.role = "admin";
const filteredMembersHtml = await views.viewAdmin("members");
assert.match(filteredMembersHtml, /data-action="admin-member-filters-clear"[^>]*>Clear filters</);
const filteredResultsStart = filteredMembersHtml.indexOf('class="member-results"');
const filteredApprovalsStart = filteredMembersHtml.indexOf('class="member-approvals"');
const filteredResultsHtml = filteredMembersHtml.slice(
  filteredResultsStart, filteredApprovalsStart < 0 ? undefined : filteredApprovalsStart
);
assert.match(filteredResultsHtml, /Tina Admin/);
for (const excluded of ["Riley Runner", "Micah Member", "Submitted Runner", "Declined Runner"]) {
  assert.doesNotMatch(filteredResultsHtml, new RegExp(excluded));
}
views.adminMemberFilters.query = "nobody";
const noMembersHtml = await views.viewAdmin("members");
assert.match(noMembersHtml, /No members match/i);
assert.match(noMembersHtml, /nobody/i);
assert.match(noMembersHtml, /Approved/);
assert.match(noMembersHtml, /Admin/);
views.adminMemberFilters.query = "";
views.adminMemberFilters.status = "all";
views.adminMemberFilters.role = "all";

// Admin Giving falls back to a clear "setup required" panel when the deployed
// Supabase project is missing the giving_campaigns table. Other errors must
// still surface to the caller.
givingCampaignListError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const setupHtml = await views.viewAdmin("giving");
assert.match(setupHtml, /Giving setup required/);
assert.match(setupHtml, /20260805000011_giving_campaigns\.sql/);
assert.match(setupHtml, /20260806000001_donor_id\.sql/);
for (const forbidden of ["+ Create campaign", "form-campaign", "campaign-row", "Publish campaign", "Close campaign"]) {
  assert.doesNotMatch(setupHtml, new RegExp(forbidden.replace(/[+]/g, "\\+")));
}
const setupDetailHtml = await views.viewAdminCampaign("new");
assert.match(setupDetailHtml, /Giving setup required/);
assert.match(setupDetailHtml, /20260805000011_giving_campaigns\.sql/);
assert.match(setupDetailHtml, /20260806000001_donor_id\.sql/);
for (const forbidden of ["+ Create campaign", "form-campaign", "campaign-row", "Publish campaign", "Close campaign"]) {
  assert.doesNotMatch(setupDetailHtml, new RegExp(forbidden.replace(/[+]/g, "\\+")));
}

givingCampaignListError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewAdmin("giving"), (error) => error?.message === "permission denied");
await assert.rejects(() => views.viewAdminCampaign("new"), (error) => error?.message === "permission denied");
givingCampaignListError = null;

// Live Admin list/render: present a closed campaign row so the fake proves
// Supabase query normalization + closed-history rendering end-to-end, then
// restore the rows so downstream tests do not observe the fixture.
const originalGivingCampaignRows = givingCampaignRows;
givingCampaignRows = [{
  id: "live-closed-1",
  title: "Live Closed Campaign",
  description: "A previously closed live Giving campaign.",
  goal_hkd: 12345,
  fps_id: "9876543",
  fps_payee: "Island Evangelical Community Church",
  status: "closed",
  creator_profile_id: "live-admin",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
  published_at: "2026-07-02T00:00:00.000Z",
  closed_at: "2026-07-15T00:00:00.000Z",
}];
try {
  const liveGivingHtml = await views.viewAdmin("giving");
  assert.match(liveGivingHtml, /Live Closed Campaign/);
  assert.match(liveGivingHtml, /<span class="badge neutral">closed<\/span>/);
  assert.match(liveGivingHtml, /\+ Create campaign/);
} finally {
  givingCampaignRows = originalGivingCampaignRows;
}

await store.decideApplication(submitted.id, "declined");
if (!profileUpdates.some((update) =>
  update.id === submitted.id && update.role === "declined" && update.expectedRole === "pending"
)) {
  throw new Error("Decline must change exactly the targeted pending profile role");
}
await assert.rejects(
  () => store.decideApplication(incomplete.id, "member"),
  /Application not submitted/
);
profile.role = "declined";
await store.getCurrentUser();
if (store.currentUser().status !== "declined") {
  throw new Error("Live declined profiles must hydrate with declined status");
}
profile.role = "super_admin";
await store.getCurrentUser();
let renderedUser = store.currentUser();
if (!renderedUser || renderedUser.id !== authUser.id) {
  throw new Error("A fetched Supabase session was not available to synchronous views");
}
const notificationNow = new RealDate("2026-08-05T06:40:00.000Z");
profile.role = "admin";
await store.getCurrentUser();
const ordinaryAdminNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(ordinaryAdminNotificationsHtml, /Application &lt;submitted&gt;/,
  "Ordinary admins must receive operational notifications");
profile.role = "super_admin";
await store.getCurrentUser();
renderedUser = store.currentUser();
const categoryRows = [
  ...notificationRows,
  {
    id: "notification-decision",
    kind: "admin_application_approved",
    title: "Application approved",
    body: "A membership was approved.",
    created_at: "2026-08-05T06:34:00.000Z",
    read_at: null,
  },
  {
    id: "notification-role-unread",
    kind: "admin_role_promoted",
    title: "Member promoted",
    body: "A member became an administrator.",
    created_at: "2026-08-05T06:33:30.000Z",
    read_at: null,
  },
  {
    id: "notification-club",
    kind: "giving_campaign_published",
    title: "Giving campaign published",
    body: "A campaign is ready.",
    created_at: "2026-08-05T06:33:00.000Z",
    read_at: null,
  },
];
views.notificationFilters.kind = "all";
const categoryNotificationsHtml = await views.viewNotifications(notificationNow, categoryRows);
for (const badge of ["Application", "Decision", "Role change", "Club update", "My account"]) {
  assert.match(categoryNotificationsHtml, new RegExp(`class="notification-kind-badge">${badge}<`));
}
assert.match(categoryNotificationsHtml, /Giving campaign published[\s\S]*?data-destination="#\/giving"|data-destination="#\/giving"[\s\S]*?Giving campaign published/);
const semanticFallbackRows = [
  {
    id: "notification-booking-reserved",
    kind: "operational_booking_reserved",
    title: "Booking reserved",
    body: "Complete payment for your reservation.",
    created_at: "2026-08-05T06:38:00.000Z",
    read_at: null,
  },
  {
    id: "notification-rsvp-confirmed",
    kind: "operational_rsvp_confirmed",
    title: "You're in",
    body: "See you at lunch.",
    created_at: "2026-08-05T06:37:30.000Z",
    read_at: null,
  },
  {
    id: "notification-payment-marked",
    kind: "operational_payment_marked",
    title: "Payment marked",
    body: "Review the member payment.",
    created_at: "2026-08-05T06:37:00.000Z",
    read_at: null,
  },
  {
    id: "notification-session-cancelled",
    kind: "operational_session_cancelled_no_defer",
    title: "Session cancelled without deferral",
    body: "Review the schedule.",
    created_at: "2026-08-05T06:36:00.000Z",
    read_at: null,
  },
  {
    id: "notification-rsvp-cancelled",
    kind: "operational_session_cancelled_no_defer",
    title: "RSVP session cancelled",
    body: "Session cancelled by ITC — Lunch venue unavailable.",
    destination: "#/activity/lunch-2026-08-08",
    created_at: "2026-08-05T06:35:30.000Z",
    read_at: null,
  },
];
const semanticFallbackHtml = await views.viewNotifications(notificationNow, semanticFallbackRows);
const semanticFallbackButtons = semanticFallbackHtml.match(/<button class="notification-row[\s\S]*?<\/button>/g) || [];
for (const [title, destination] of [
  ["Booking reserved", "#/account/payments"],
  ["You&#39;re in", "#/schedule"],
  ["Payment marked", "#/admin/payments"],
  ["Session cancelled without deferral", "#/schedule"],
  ["RSVP session cancelled", "#/activity/lunch-2026-08-08"],
]) {
  const button = semanticFallbackButtons.find((row) => row.includes(`<strong>${title}</strong>`));
  assert.ok(button, `${title} must render as a notification row`);
  assert.match(button, new RegExp(`data-destination="${destination}"`),
    `${title} must render its semantic section fallback without an explicit destination`);
}
const categoryFilterCases = [
  ["application", "Application &lt;submitted&gt;"],
  ["decision", "Application approved"],
  ["role", "Member promoted"],
  ["club", "Giving campaign published"],
];
for (const [kind, expectedTitle] of categoryFilterCases) {
  views.notificationFilters.kind = kind;
  const filteredHtml = await views.viewNotifications(notificationNow, categoryRows);
  assert.match(filteredHtml, new RegExp(expectedTitle), `${kind} notifications must display in their filter`);
  for (const [, otherTitle] of categoryFilterCases) {
    if (otherTitle !== expectedTitle) {
      assert.doesNotMatch(filteredHtml, new RegExp(otherTitle), `${kind} filter must exclude other notification categories`);
    }
  }
}
views.notificationFilters.kind = "all";
const adminNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(adminNotificationsHtml, /<h1[^>]*>Notifications<\/h1>/);
for (const label of ["All", "Applications", "Decisions", "Role changes", "Club updates", "My account"]) {
  assert.match(adminNotificationsHtml, new RegExp(`data-notification-filter="[^"]+"[^>]*>${label}<\\/button>`));
}
assert.match(adminNotificationsHtml, /data-notification-filter="all"[^>]*aria-pressed="true"/);
assert.doesNotMatch(adminNotificationsHtml, /<h2[^>]*>Club operations<\/h2>|<h2[^>]*>My notifications<\/h2>/);
assert.equal((adminNotificationsHtml.match(/class="notification-list"/g) || []).length, 1,
  "Notifications must render one chronological list");
assert.ok(adminNotificationsHtml.indexOf("Application &lt;submitted&gt;") < adminNotificationsHtml.indexOf("Welcome to ITC"));
assert.doesNotMatch(adminNotificationsHtml, /Application <submitted>|Riley & approve/,
  "Notification content must be HTML escaped");
assert.doesNotMatch(adminNotificationsHtml, /Role changed|Imported notification/,
  "Read notification history must not render in the notification window");
const notificationButtons = adminNotificationsHtml.match(/<button class="notification-row[\s\S]*?<\/button>/g) || [];
assert.equal(notificationButtons.length, 2, "Only unread notification rows must remain visible");
for (const button of notificationButtons) {
  assert.match(button, /class="notification-row unread"[^>]*type="button"/,
    "Every rendered notification row must be unread");
  assert.match(button, /class="notification-kind-badge"/,
    "Every notification row must show its category badge");
  assert.match(button, /class="notification-unread" aria-label="Unread"/);
  assert.doesNotMatch(button, /data-notification-read="true"/);
}
assert.match(adminNotificationsHtml, /5 minutes ago/);
assert.match(adminNotificationsHtml, /5 Aug 2026, 2:32 PM HKT/);
assert.doesNotMatch(adminNotificationsHtml, /Invalid Date|NaN/);
assert.match(adminNotificationsHtml, /data-destination="#\/admin\/approvals"/);
assert.match(adminNotificationsHtml, /data-destination="#\/account"/);
const allReadNotificationsHtml = await views.viewNotifications(
  notificationNow,
  notificationRows.filter((row) => row.read_at)
);
assert.match(allReadNotificationsHtml, /No any notifications\./,
  "An inbox containing only audited read rows must render the unread empty state");
assert.doesNotMatch(allReadNotificationsHtml, /class="notification-row/);
renderedUser.role = "member";
views.notificationFilters.kind = "all";
const memberNotificationsHtml = await views.viewNotifications(notificationNow);
for (const label of ["All", "Club updates", "My account"]) assert.match(memberNotificationsHtml, new RegExp(`>${label}<\\/button>`));
assert.doesNotMatch(memberNotificationsHtml, />Applications<\/button>|>Decisions<\/button>|>Role changes<\/button>/);
assert.doesNotMatch(memberNotificationsHtml, /Application &lt;submitted&gt;|Role changed/);
assert.match(memberNotificationsHtml, /Welcome to ITC/);
views.notificationFilters.kind = "club";
const memberClubNotificationsHtml = await views.viewNotifications(notificationNow, categoryRows);
assert.match(memberClubNotificationsHtml, /Giving campaign published/);
assert.doesNotMatch(memberClubNotificationsHtml, /Application &lt;submitted&gt;|Application approved|Role changed|Welcome to ITC/);
const emptyClubNotificationsHtml = await views.viewNotifications(notificationNow);
assert.match(emptyClubNotificationsHtml, /No Club updates notifications\./,
  "The active filter empty state must name its filter");
assert.doesNotMatch(emptyClubNotificationsHtml, /<section class="card notification-section"/,
  "Filter empty states must not wrap in a card/box container");
const emptyMemberNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyMemberNotificationsHtml, /New notifications will appear here\./,
  "Empty inbox must not render the explanatory 'New notifications will appear here.' sentence");
assert.match(emptyMemberNotificationsHtml, /No Club updates notifications\./);
assert.doesNotMatch(emptyMemberNotificationsHtml, /<section class="card notification-section"/);
renderedUser.role = "super_admin";
views.notificationFilters.kind = "all";
const emptyAdminNotificationsHtml = await views.viewNotifications(notificationNow, []);
assert.doesNotMatch(emptyAdminNotificationsHtml, /New notifications will appear here\./);
assert.match(emptyAdminNotificationsHtml, /No any notifications\./,
  "The All filter empty state must use the simplified copy");
assert.doesNotMatch(emptyAdminNotificationsHtml, /<section class="card notification-section"/);
const liveApplication = await store.getMyApplication();
if (!liveApplication || liveApplication.waiver_accepted_at !== "2026-08-05T01:00:00.000Z") {
  throw new Error("waiver missing");
}
const confirmedDay = "5 Aug 2026";
const account = await views.viewAccount();
if (!account.includes("Super admin")) {
  throw new Error("Account did not display the live super-admin role");
}
if (!account.includes("Member since Aug 2026")) {
  throw new Error("Account did not map the live profile creation date");
}
if (!account.includes(`Indemnity confirmed on ${confirmedDay}`) || account.includes("To be accepted")) {
  throw new Error("Account should reflect the live application waiver acceptance date");
}
if (account.includes("undefined") || account.includes("Invalid Date")) {
  throw new Error("Account displayed an undefined role or invalid membership date");
}
const indemnity = await views.viewAccount("indemnity");
if (!indemnity.includes(`Indemnity confirmed on ${confirmedDay}`) || indemnity.includes("To be accepted")) {
  throw new Error("Indemnity page should reflect the live application waiver acceptance date");
}
for (const marker of [
  "Signed by",
  "Riley Runner",
  "Date of signing",
  "Emergency contact relationship",
  "Coach",
  "Document version",
  "v1",
]) {
  if (!indemnity.includes(marker)) {
    throw new Error(`Current live indemnity page missing ${marker}`);
  }
}
store.currentUser().role = "pending";
store.currentUser().status = "pending";
const pendingAccount = await views.viewAccount();
if (!pendingAccount.includes("+852 6123 4567")) {
  throw new Error("Pending Profile should render the fetched application phone");
}
if (!pendingAccount.includes("Taylor Coach · Coach · +852 6777 8888")) {
  throw new Error("Pending Profile should render the fetched application emergency contact and relationship");
}
if (!pendingAccount.includes("Accepted")) {
  throw new Error("Pending Profile should render the fetched application waiver state");
}
if (!pendingAccount.includes("Yes")) {
  throw new Error("Pending Profile should render the fetched application photo consent");
}
const gatedPaidSession = store.upcomingSessions(14).find((session) => session.kind === "paid");
if (!gatedPaidSession) throw new Error("Live access checks need an upcoming paid session");
store.currentUser().role = "super_admin";
store.currentUser().status = "approved";
const uuidBooking = await store.reserveSession(authUser.id, gatedPaidSession, Date.now());
if (uuidBooking.userId !== authUser.id) {
  throw new Error("Payment records must use the authenticated Supabase profile UUID");
}
assert.equal(
  uuidBooking.snapshot.time,
  "11:15",
  "live booking snapshots must normalize database start_time for sessionStarted and views",
);
assert.doesNotThrow(() => data.sessionStarted(uuidBooking.snapshot));
for (const status of ["pending", "declined"]) {
  store.currentUser().role = status;
  store.currentUser().status = status;
  const gatedSurfaces = [
    views.viewActivity(gatedPaidSession.id),
    views.viewCheckout(gatedPaidSession.id),
    await views.viewGiving(),
  ];
  const renderedControls = gatedSurfaces
    .filter((surface) => typeof surface === "string")
    .join("\n");
  for (const forbidden of [
    'id="form-reserve"',
    'data-action="join-waitlist"',
    'data-action="join-interest"',
    'id="form-giving"',
    'data-action="giving-amount"',
    'data-action="giving-confirm"',
  ]) {
    if (renderedControls.includes(forbidden)) {
      throw new Error(`${status} live profiles must not render gated control: ${forbidden}`);
    }
  }
  const directPayHtml = views.viewPay(uuidBooking.id);
  if (typeof directPayHtml !== "string" || !directPayHtml.includes("Booking not found.")) {
    throw new Error(`${status} live profiles must not render the direct-pay route`);
  }
}
console.log("ok  pending and declined live profiles cannot render Payment or Giving controls");
store.currentUser().role = "super_admin";
store.currentUser().status = "approved";

// Live booking snapshots come from the DB with start_time/session_date/
// venue/price_hkd keys; Profile > History must render them (a missing
// time mapping previously crashed fmtTime with undefined).
const liveHistoryHtml = await views.viewAccount("history");
if (typeof liveHistoryHtml !== "string") {
  throw new Error("live booking history must render for the signed-in member");
}
if (!liveHistoryHtml.includes("11:15 AM") || liveHistoryHtml.includes("undefined")) {
  throw new Error("live booking history must render the snapshot start_time, not undefined");
}
console.log("ok  live booking history renders snapshot start_time without crashing");

// History must hydrate omitted booking snapshot fields from the authoritative
// operational session, and must collapse repeated RSVP join/withdraw rows.
const liveHistoryPaidSessionRow = operationalTableRows.operational_sessions.find(
  (row) => row.activity_id === "hyrox-quarry-bay" && row.id !== uuidBooking.sessionId
);
const liveHistoryRsvpSessionRow = operationalTableRows.operational_sessions.find(
  (row) => row.activity_id === "lunch" && row.id !== seededRsvpLunchId
);
if (!liveHistoryPaidSessionRow || !liveHistoryRsvpSessionRow) {
  throw new Error("live History regressions need separate paid and RSVP sessions");
}
const liveHistoryGapBooking = {
  id: "history-gap-paid",
  profile_id: authUser.id,
  session_id: liveHistoryPaidSessionRow.id,
  status: "reserved",
  reserved_at: fixedIso,
  pay_deadline_at: fixedIso,
  payment_marked_at: null,
  payment_method: null,
  payment_reference: null,
  paid_at: null,
  confirmed_by: null,
  deferred_from_booking_id: null,
  deferred_to_booking_id: null,
  snapshot: { session_date: liveHistoryPaidSessionRow.session_date },
  created_at: fixedIso,
  updated_at: fixedIso,
};
const liveHistoryRsvpRows = [
  {
    id: "history-rsvp-old",
    profile_id: authUser.id,
    session_id: liveHistoryRsvpSessionRow.id,
    status: "confirmed",
    reserved_at: fixedIso,
    pay_deadline_at: fixedIso,
    payment_marked_at: null,
    payment_method: null,
    payment_reference: null,
    paid_at: fixedIso,
    confirmed_by: null,
    deferred_from_booking_id: null,
    deferred_to_booking_id: null,
    snapshot: { session_date: liveHistoryRsvpSessionRow.session_date },
    created_at: "2026-08-05T01:00:00.000Z",
    updated_at: "2026-08-05T01:00:00.000Z",
  },
  {
    id: "history-rsvp-new",
    profile_id: authUser.id,
    session_id: liveHistoryRsvpSessionRow.id,
    status: "cancelled",
    reserved_at: fixedIso,
    pay_deadline_at: fixedIso,
    payment_marked_at: null,
    payment_method: null,
    payment_reference: null,
    paid_at: fixedIso,
    confirmed_by: null,
    deferred_from_booking_id: null,
    deferred_to_booking_id: null,
    snapshot: { session_date: liveHistoryRsvpSessionRow.session_date },
    created_at: "2026-08-05T03:00:00.000Z",
    updated_at: "2026-08-05T03:00:00.000Z",
  },
];
operationalTableRows.operational_bookings.push(liveHistoryGapBooking, ...liveHistoryRsvpRows);
await operations.refreshOperationalState();
const liveGapHistoryHtml = await views.viewAccount("history");
const liveGapPaidCard = liveGapHistoryHtml
  .split('<div class="card booking-card">')
  .find((card) => card.includes(`href="#/booking/${liveHistoryGapBooking.id}"`)) || "";
if (!liveGapPaidCard.includes("10:30 AM")
    || !liveGapPaidCard.includes("ITC HYROX")
    || !liveGapPaidCard.includes("10/F, Island ECC, Quarry Bay")
    || !liveGapPaidCard.includes("60 min")
    || !liveGapPaidCard.includes("HK$180 to be paid")
    || liveGapPaidCard.includes("null min")
    || liveGapPaidCard.includes("paid HK$180")) {
  throw new Error("live History must hydrate paid booking display data and unpaid copy from its session");
}
if (liveGapHistoryHtml.includes(`href="#/booking/${liveHistoryRsvpRows[0].id}"`)
    || liveGapHistoryHtml.includes(`href="#/booking/${liveHistoryRsvpRows[1].id}"`)) {
  throw new Error("live History must omit cancelled RSVP records that are not current bookings");
}
console.log("ok  live History hydrates gaps and omits cancelled RSVP records");

// A booking can outlive the operational Schedule horizon. The History read
// must fetch its missing session by ID rather than rendering a partial row.
const historicalSessionRows = [
  {
    id: "history-old-session",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-07-01",
    start_time: "10:30:00",
    duration_minutes: 55,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: fixedIso,
    updated_at: fixedIso,
  },
  {
    id: "history-tie-session-a",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-07-02",
    start_time: "09:00:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
    created_at: fixedIso,
    updated_at: fixedIso,
  },
  {
    id: "history-tie-session-z",
    activity_id: "hyrox-quarry-bay",
    session_date: "2026-07-02",
    start_time: "09:00:00",
    duration_minutes: 60,
    venue: "10/F, Island ECC, Quarry Bay",
    capacity: 30,
    price_hkd: 180,
    is_open: true,
    venue_tbc: false,
    notice: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_source: null,
    cancel_reason: null,
    gym_confirmed_at: null,
    gym_confirmed_by: null,
    gym_note: null,
  },
].map((row) => ({ ...row, created_at: fixedIso, updated_at: fixedIso }));
const historicalBookingBase = {
  profile_id: authUser.id,
  status: "reserved",
  reserved_at: fixedIso,
  pay_deadline_at: fixedIso,
  payment_marked_at: null,
  payment_method: null,
  payment_reference: null,
  paid_at: null,
  confirmed_by: null,
  deferred_from_booking_id: null,
  deferred_to_booking_id: null,
  snapshot: {},
  created_at: fixedIso,
  updated_at: fixedIso,
};
// Mixed cutover: stale direct snapshots arrive after RLS already hides sessions.
const unresolvedDirectRows = ["stale-bft", "delayed-ecc"].map((id) => ({
  ...historicalBookingBase, id, session_id: `${id}-session`, hyrox_cycle_id: null,
  snapshot: { name: "ITC HYROX", venue: id === "stale-bft" ? "BFT Causeway Bay" : "Island ECC" },
}));
const unresolvedReceipts = unresolvedDirectRows.map((row) => ({
  id: `${row.id}-receipt`, booking_id: row.id, session_id: row.session_id,
  profile_id: authUser.id, amount_hkd: 180, issued_at: fixedIso,
}));
unresolvedReceipts.push({ ...unresolvedReceipts[0], id: "orphan-receipt", booking_id: "missing-booking", session_id: "missing-session" });
const nonDirectControl = {
  ...historicalBookingBase, id: "non-direct-control", session_id: null,
  hyrox_cycle_id: "community-cycle-2099-01-03",
};
const nonDirectReceipt = {
  ...unresolvedReceipts[0], id: "non-direct-receipt", booking_id: nonDirectControl.id,
  session_id: null, hyrox_cycle_id: nonDirectControl.hyrox_cycle_id,
};
operationalTableRows.operational_bookings.push(...unresolvedDirectRows, nonDirectControl);
operationalTableRows.operational_receipts.push(...unresolvedReceipts, nonDirectReceipt);
await operations.refreshOperationalState();
for (const row of unresolvedDirectRows) assert.equal(operations.liveBookingById(row.id), null,
  "unresolved direct booking must fail closed even with a display snapshot");
for (const row of unresolvedReceipts) assert.equal(operations.liveReceiptById(row.id), null,
  "unresolved direct receipt must fail closed");
assert.ok(operations.liveBookingById(nonDirectControl.id), "non-direct non-pool behavior is unchanged");
assert.ok(operations.liveReceiptById(nonDirectReceipt.id), "non-direct non-pool receipt remains visible");
operationalTableRows.operational_sessions.push({ ...historicalSessionRows[0], id: "delayed-ecc-session" });
await operations.refreshOperationalState();
assert.ok(operations.liveBookingById("delayed-ecc"), "later canonical ECC hydration recovers booking");
assert.ok(operations.liveReceiptById("delayed-ecc-receipt"), "later canonical ECC hydration recovers receipt");
assert.equal(operations.liveBookingById("stale-bft"), null);
assert.equal(operations.liveReceiptById("stale-bft-receipt"), null);
operationalTableRows.operational_bookings = operationalTableRows.operational_bookings.filter((row) => ![...unresolvedDirectRows, nonDirectControl].some((item) => item.id === row.id));
operationalTableRows.operational_receipts = operationalTableRows.operational_receipts.filter((row) => ![...unresolvedReceipts, nonDirectReceipt].some((item) => item.id === row.id));
operationalTableRows.operational_sessions = operationalTableRows.operational_sessions.filter((row) => row.id !== "delayed-ecc-session");
console.log("ok  unresolved stale direct records fail closed and ECC recovers");
operationalTableRows.operational_sessions.push(...historicalSessionRows);
operationalTableRows.operational_bookings.push(
  { ...historicalBookingBase, id: "history-old-booking", session_id: "history-old-session", snapshot: { session_date: "2026-07-01" } },
  { ...historicalBookingBase, id: "history-tie-z", session_id: "history-tie-session-z", snapshot: { session_date: "2026-07-02" } },
  { ...historicalBookingBase, id: "history-tie-a", session_id: "history-tie-session-a", snapshot: { session_date: "2026-07-02" } },
);
await operations.refreshOperationalState();
const historicalHistoryHtml = await views.viewAccount("history");
const historicalCard = historicalHistoryHtml
  .split('<div class="card booking-card">')
  .find((card) => card.includes('href="#/booking/history-old-booking"')) || "";
if (!historicalCard.includes("10:30 AM")
    || !historicalCard.includes("55 min")
    || !historicalCard.includes("ITC HYROX")
    || !historicalCard.includes("10/F, Island ECC, Quarry Bay")
    || !historicalCard.includes("HK$180 to be paid")
    || historicalCard.includes("null min")
    || historicalCard.includes("paid HK$180")) {
  throw new Error("History must hydrate a session older than the 7-day query by ID");
}
const fallbackQuery = operationalSessionQueries.find((query) =>
  query.ids?.includes("history-old-session"));
if (!fallbackQuery || fallbackQuery.since !== null
    || !fallbackQuery.ids.includes("history-tie-session-a")
    || !fallbackQuery.ids.includes("history-tie-session-z")) {
  throw new Error("History must use a targeted operational_sessions ID lookup for missing sessions");
}
const tieA = historicalHistoryHtml.indexOf('href="#/booking/history-tie-a"');
const tieZ = historicalHistoryHtml.indexOf('href="#/booking/history-tie-z"');
if (tieA < 0 || tieZ < 0 || tieA > tieZ) {
  throw new Error("History must use booking ID as a deterministic equal-timestamp tie-break");
}
console.log("ok  live History hydrates older sessions and sorts equal timestamps deterministically");
operationalTableRows.operational_bookings = operationalTableRows.operational_bookings
  .filter((row) => ![
    liveHistoryGapBooking.id,
    ...liveHistoryRsvpRows.map((item) => item.id),
    "history-old-booking",
    "history-tie-z",
    "history-tie-a",
  ].includes(row.id));
operationalTableRows.operational_sessions = operationalTableRows.operational_sessions
  .filter((row) => !historicalSessionRows.some((item) => item.id === row.id));
await operations.refreshOperationalState();

// --- One-off events (live) ---
const freeEventRow = await store.createOneOffEvent({
  name: "Charity Gala Workout", dateISO: "2026-09-12", time: "09:00",
  durationMin: 45, location: "Sun Yat Sen Memorial Park", mapsQuery: "",
  category: "Other", price: 0, capacity: 30,
});
const freeEventSession = store.getSession(freeEventRow.id);
if (!freeEventSession || !freeEventSession.oneOff
    || freeEventSession.name !== "Charity Gala Workout"
    || freeEventSession.kind !== "free" || freeEventSession.weekday !== 6
    || freeEventSession.requiresRsvp !== true || freeEventSession.capacity !== null) {
  throw new Error("live one-off free event must hydrate as an uncapped free RSVP session");
}
assert.deepEqual(
  operationalRpcCalls.filter((call) => call.name === "create_operational_event").at(-1)?.args,
  {
    p_name: "Charity Gala Workout",
    p_session_date: "2026-09-12",
    p_start_time: "09:00",
    p_duration_minutes: 45,
    p_venue: "Sun Yat Sen Memorial Park",
    p_maps_query: null,
    p_category: "Other",
    p_price_hkd: 0,
    p_capacity: null,
    p_requires_rsvp: true,
  },
  "free one-off creation must select the compatible RSVP RPC signature and leave capacity to server authority",
);
if (!store.upcomingSessions(45).some((s) => s.id === freeEventRow.id)) {
  throw new Error("live one-off event must appear in upcoming sessions");
}
const paidEventRow = await store.createOneOffEvent({
  name: "Pop-up HYROX", dateISO: "2026-09-19", time: "08:30",
  durationMin: 60, location: "BFT Central", mapsQuery: "BFT Central",
  category: "HYROX", price: 200, capacity: 10,
});
const paidEventSession = store.getSession(paidEventRow.id);
if (!paidEventSession || paidEventSession.kind !== "paid" || paidEventSession.price !== 200
    || paidEventSession.category !== "HYROX" || paidEventSession.mapsQuery !== "BFT Central") {
  throw new Error("live paid one-off event must hydrate with price, category and maps query");
}
await store.deleteOneOffEvent(paidEventRow.id);
if (store.getSession(paidEventRow.id)) {
  throw new Error("deleted one-off event must leave the live cache");
}
const keptEventRow = await store.createOneOffEvent({
  name: "Sunset Social Run", dateISO: "2026-09-20", time: "18:00",
  durationMin: 60, location: "Harbourfront", category: "Run", price: 150, capacity: 12,
});
await store.reserveSession(authUser.id, keptEventRow.id, Date.now());
try {
  await store.deleteOneOffEvent(keptEventRow.id);
  throw new Error("delete must refuse one-off events with active bookings");
} catch (err) {
  if (!/cancel the session instead/i.test(err.message)) throw err;
}
console.log("ok  live one-off events create, hydrate, delete, and guard booked deletion");

// --- RSVP events (live): price-0 sessions confirm instantly, no payment ---
const lunchSession = store.upcomingSessions(21).find((s) => s.kind === "rsvp");
if (!lunchSession || lunchSession.category !== "Socials" || lunchSession.name !== "Post-Training Lunch") {
  throw new Error("live RSVP lunch session must hydrate with rsvp kind and Socials category");
}
if (lunchSession.capacity !== null || store.spotsLeft(lunchSession) !== null) {
  throw new Error("the lunch is uncapped — capacity and spots must be null");
}
const otherLunchSession = store.upcomingSessions(28).find(
  (session) => session.activityId === "lunch"
    && session.id !== lunchSession.id
    && session.dateISO !== lunchSession.dateISO
);
if (!otherLunchSession || otherLunchSession.location !== "TBC") {
  throw new Error("live smoke needs another dated lunch at TBC to verify venue isolation");
}
const savedProfileRole = profile.role;
const signedInOperationalUser = store.currentUser();
const savedCurrentRole = signedInOperationalUser.role;
profile.role = "member";
signedInOperationalUser.role = "member";
signedInOperationalUser.status = "approved";

// Count enrichment is optional: a rejected aggregate must not poison core
// sessions, and the status must identify count-only degradation.
operationalRsvpCountError = { message: "permission denied for function get_operational_rsvp_counts" };
await operations.refreshOperationalState();
assert.equal(operations.operationalStateStatus().loaded, true);
assert.equal(operations.operationalStateStatus().error, null);
assert.equal(operations.operationalStateStatus().payoutError, null,
  "RSVP count degradation must not affect assigned payout hydration");
assert.match(operations.operationalStateStatus().rsvpCountError || "",
  /permission denied for function get_operational_rsvp_counts/);
assert.ok(store.getSession(lunchSession.id),
  "a failed RSVP count RPC must leave core live sessions visible");
assert.equal(operations.liveRsvpCountFor(lunchSession.id), null,
  "degraded count hydration must expose null rather than a stale total");

operationalRsvpCountError = null;
operationalRsvpCountRowsOverride = [];
await operations.refreshOperationalState();
assert.equal(operations.liveRsvpCountFor(lunchSession.id), null,
  "a successful empty aggregate must leave RSVP sessions unset (not seed a false zero)");
operationalRsvpCountRowsOverride = null;
await operations.refreshOperationalState();
assert.equal(operations.operationalStateStatus().rsvpCountError, null,
  "successful count hydration must clear degraded status");
assert.equal(operations.operationalStateStatus().payoutError, null,
  "successful count recovery must preserve assigned payout hydration");
assert.equal(operations.liveRsvpCountFor(lunchSession.id), 1,
  "count aggregate must include another member's confirmed lunch RSVP");
assert.equal(store.attendeeCountFor(lunchSession), 1,
  "ordinary members must see the exact baseline despite booking RLS");
assert.ok(!operations.liveBookingsForSession(lunchSession.id)
  .some((booking) => booking.userId === "rsvp-other-member"),
"ordinary members must not receive another member's direct booking row");
assert.ok(![...approvedProfiles, ...pendingProfiles, ...declinedProfiles]
  .some((row) => row.id === "rsvp-other-member"),
"the aggregate must not hydrate another RSVP member's profile row");

const lunchHtml = views.viewActivity(lunchSession.id);
if (!lunchHtml.includes('data-action="rsvp-join"') || lunchHtml.includes("Book & pay")) {
  throw new Error("live RSVP activity should offer Count me in, not checkout");
}

// Booking RLS suppresses another member's booking event, but the public
// identity-free count-table event must still refresh this ordinary member.
const foreignRealtimeBooking = {
  ...structuredClone(operationalTableRows.operational_bookings
    .find((booking) => booking.id === "rsvp-other-confirmed")),
  id: "rsvp-foreign-realtime-confirmed",
  profile_id: "rsvp-foreign-realtime-member",
};
operationalTableRows.operational_bookings.push(foreignRealtimeBooking);
assert.equal(store.attendeeCountFor(lunchSession), 1,
  "a foreign booking hidden by RLS must not update the cached aggregate by itself");
const countTableHandler = realtimeHandlers.find(({ filter }) =>
  filter.table === "operational_rsvp_counts");
assert.ok(countTableHandler, "count-table Realtime handler must exist");
const countRefresh = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    unsubscribe();
    reject(new Error("count-table Realtime event did not refresh operational state"));
  }, 1000);
  const unsubscribe = operations.subscribeOperationalState(() => {
    clearTimeout(timeout);
    unsubscribe();
    resolve();
  });
});
countTableHandler.handler({
  eventType: "UPDATE",
  new: { session_id: lunchSession.id, going_count: 2, updated_at: fixedIso },
  old: { session_id: lunchSession.id, going_count: 1, updated_at: fixedIso },
});
await countRefresh;
assert.equal(store.attendeeCountFor(lunchSession), 2,
  "a foreign count-table event must refresh the ordinary member's exact aggregate");
assert.ok(!operations.liveBookingsForSession(lunchSession.id)
  .some((booking) => booking.userId === foreignRealtimeBooking.profile_id),
"the count refresh must not bypass booking RLS or hydrate the foreign owner");

const countBeforeRsvp = store.attendeeCountFor(lunchSession);
const rsvpBooking = await store.rsvpSession(authUser.id, lunchSession.id);
if (rsvpBooking.status !== "confirmed") {
  throw new Error("live RSVP should confirm instantly without payment");
}
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp + 1,
  "Count me in must increase the all-member RSVP count by exactly one");
assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).users, [],
  "live RSVP join must not copy identity rows into prototype state");
const joinedTotal = countBeforeRsvp + 1;
const goingHtml = views.viewActivity(lunchSession.id);
if (!goingHtml.includes("rsvp-withdraw")) {
  throw new Error("RSVP'd member should see a withdraw action");
}
const priorCountWeekOffset = views.scheduleState.weekOffset;
const priorCountSelected = views.scheduleState.selected;
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(lunchSession.dateISO)) - data.sundayOf(data.todayLocal())) / (7 * 86400000)
);
views.scheduleState.selected = lunchSession.dateISO;
const countScheduleHtml = views.viewSchedule();
views.scheduleState.weekOffset = priorCountWeekOffset;
views.scheduleState.selected = priorCountSelected;
const scheduleRowStart = countScheduleHtml.indexOf(`href="#/activity/${lunchSession.id}"`);
const scheduleRowEnd = countScheduleHtml.indexOf("</a>", scheduleRowStart);
const ownerScheduleRow = countScheduleHtml.slice(scheduleRowStart, scheduleRowEnd);
assert.ok(ownerScheduleRow.includes(
  `<span class="badge free booked">Going</span><span class="spots">${joinedTotal} going</span>`
), "an RSVP owner must see the exact count beside Going on Schedule");
signedInOperationalUser.role = "super_admin";
const countAdminHtml = await views.viewAdmin("activities");
signedInOperationalUser.role = "member";
for (const [surface, html] of [
  ["Schedule", countScheduleHtml],
  ["Activity Details", goingHtml],
  ["Admin", countAdminHtml],
]) {
  assert.ok(html.includes(`${joinedTotal} going`),
    `${surface} must render the same exact RSVP aggregate`);
}

await store.withdrawRsvp(rsvpBooking.id);
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp,
  "withdrawal must decrease the all-member RSVP count by exactly one");
assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).users, [],
  "live RSVP withdrawal must leave prototype identity rows empty");
if (store.getBooking(rsvpBooking.id).status !== "cancelled") {
  throw new Error("withdraw should cancel the RSVP");
}
profile.role = savedProfileRole;
signedInOperationalUser.role = savedCurrentRole;
signedInOperationalUser.status = "approved";
await operations.refreshOperationalState();
console.log("ok  exact RSVP aggregates survive member RLS and degrade without hiding core sessions");

// Same-day live sessions order by start time, and weekly venue overrides
// apply to live RSVP sessions (not just locally-seeded free events).
const saturdaySessions = store.upcomingSessions(14).filter((s) => s.dateISO === lunchSession.dateISO);
const saturdayTimes = saturdaySessions.map((s) => s.time);
assert.deepEqual(saturdayTimes, ["09:15", "10:30", "12:45"],
  "same-day live sessions must place lunch after both Island ECC slots");
await store.setWeekVenue(lunchSession.id, { location: "Cafe Deco, Central", mapsQuery: "Cafe Deco, Central" });
const overriddenLunch = store.getSession(lunchSession.id);
if (overriddenLunch.location !== "Cafe Deco, Central" || overriddenLunch.mapsQuery !== "Cafe Deco, Central") {
  throw new Error("weekly venue override must apply to live RSVP sessions");
}
if (store.getSession(otherLunchSession.id)?.location !== "TBC") {
  throw new Error("saving a live lunch venue must not change another dated lunch");
}
const priorScheduleWeekOffset = views.scheduleState.weekOffset;
const priorScheduleSelected = views.scheduleState.selected;
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(lunchSession.dateISO)) - data.sundayOf(data.todayLocal())) / (7 * 86400000)
);
views.scheduleState.selected = lunchSession.dateISO;
const lunchScheduleHtml = views.viewSchedule();
const lunchDetailHtml = views.viewActivity(lunchSession.id);
const earlyScheduleIndex = lunchScheduleHtml.indexOf(
  `href="#/activity/hyrox-quarry-bay-early-${lunchSession.dateISO}"`
);
const lateScheduleIndex = lunchScheduleHtml.indexOf(
  `href="#/activity/hyrox-quarry-bay-${lunchSession.dateISO}"`
);
const lunchScheduleIndex = lunchScheduleHtml.indexOf(
  `href="#/activity/${lunchSession.id}"`
);
assert.ok(earlyScheduleIndex >= 0
  && earlyScheduleIndex < lateScheduleIndex
  && lateScheduleIndex < lunchScheduleIndex,
"live Schedule must render 9:15 HYROX, 10:30 HYROX, then 12:45 lunch");
if (!lunchScheduleHtml.includes("Cafe Deco, Central")
    || !lunchDetailHtml.includes("Cafe Deco, Central")) {
  throw new Error("live lunch venue override must appear on Schedule and Activity Details");
}
views.scheduleState.weekOffset = priorScheduleWeekOffset;
views.scheduleState.selected = priorScheduleSelected;
await store.setWeekVenue(lunchSession.id, {
  location: null,
  mapsQuery: null,
  meetingLat: null,
  meetingLng: null,
});
const resetLunch = store.getSession(lunchSession.id);
if (resetLunch.location !== "TBC") {
  throw new Error("resetting a live lunch venue should restore its TBC recurring default");
}
if (store.getSession(otherLunchSession.id)?.location !== "TBC") {
  throw new Error("resetting a live lunch venue must not change another dated lunch");
}
console.log("ok  live sessions order by start time and lunch accepts isolated weekly venue overrides");

const futureLunchBeforeCancellation = structuredClone(
  operationalTableRows.operational_sessions.find((row) => row.activity_id === "lunch"
    && row.id !== lunchSession.id && row.session_date > lunchSession.dateISO)
);
await store.cancelSessionWeek(lunchSession.id, "Organizer away");
const cancelledLiveAdminHtml = await views.viewAdmin("activities");
const cancelledLunchMarker = cancelledLiveAdminHtml.indexOf(`data-session="${lunchSession.id}"`);
const cancelledLunchCardStart = cancelledLiveAdminHtml.lastIndexOf('<div class="card mt16', cancelledLunchMarker);
const cancelledLunchCardEnd = cancelledLiveAdminHtml.indexOf('</div></div>', cancelledLunchMarker);
const cancelledLunchCard = cancelledLiveAdminHtml.slice(cancelledLunchCardStart, cancelledLunchCardEnd + 12);
assert.match(cancelledLunchCard, /Session cancelled by ITC — Organizer away/);
assert.match(cancelledLunchCard,
  new RegExp(`data-action="repost-rsvp"[^>]*data-session="${lunchSession.id}"[^>]*>Reopen event<`));
assert.deepEqual(
  operationalTableRows.operational_sessions.find((row) => row.id === futureLunchBeforeCancellation?.id),
  futureLunchBeforeCancellation,
  "live per-occurrence cancellation must not mutate a future lunch occurrence"
);
const reopenedLiveRsvpRow = await store.repostRsvpEvent(lunchSession.id);
const reopenedLiveRsvp = store.getSession(lunchSession.id);
if (!reopenedLiveRsvpRow || reopenedLiveRsvpRow.id !== lunchSession.id
    || !reopenedLiveRsvp || reopenedLiveRsvp.oneOff || reopenedLiveRsvp.kind !== "rsvp"
    || reopenedLiveRsvp.name !== lunchSession.name || reopenedLiveRsvp.dateISO !== lunchSession.dateISO
    || reopenedLiveRsvp.time !== lunchSession.time || reopenedLiveRsvp.capacity !== null
    || reopenedLiveRsvp.cancelled) {
  throw new Error("live repost should reopen the original RSVP event");
}
console.log("ok  live Admin can repost a cancelled RSVP event in place");

// A live Admin must compose the Supabase UUID directory with device-local
// Payment operations without copying editable identity records into storage.
await views.viewAdmin("payments");
operationalAuthSubOverride = "approved-member";
const memberUuidBooking = await store.reserveSession("approved-member", gatedPaidSession, Date.now());
operationalAuthSubOverride = null;
if (!await store.markBookingPaid(memberUuidBooking.id, "FPS", "LIVE-MEMBER-REF", Date.now())) {
  throw new Error("Live member UUID booking must enter pending Payment Ops");
}
await store.setDuty(authUser.id, gatedPaidSession.dateISO);
await store.updateCollectorPayouts(authUser.id, {
  paymeLink: "payme.hsbc.com.hk/1/live-admin",
  fpsPhone: "+852 6123 4567",
});
let liveOpsHtml = await views.viewAdmin("payments");
for (const marker of ["Micah Member", "LIVE-MEMBER-REF", "Riley", "https://payme.hsbc.com.hk/1/live-admin", "+852 6123 4567"]) {
  if (!liveOpsHtml.includes(marker)) {
    throw new Error(`Live Payment Ops composition missing ${marker}`);
  }
}
const persistedLiveOps = JSON.parse(mem.get("itc.prototype.v1"));
if (persistedLiveOps.users.length !== 0
    || persistedLiveOps.paymentPayouts?.[authUser.id]?.paymeLink !== "https://payme.hsbc.com.hk/1/live-admin"
    || persistedLiveOps.paymentPayouts?.[authUser.id]?.fpsPhone !== "+852 6123 4567") {
  throw new Error("Live Payment Ops must persist UUID-keyed details without a local identity directory");
}
store.load();
liveOpsHtml = await views.viewAdmin("payments");
if (!liveOpsHtml.includes("https://payme.hsbc.com.hk/1/live-admin")
    || !liveOpsHtml.includes("LIVE-MEMBER-REF")
    || liveOpsHtml.includes('name="fpsPhone"')
    || !liveOpsHtml.includes("+852 6123 4567")) {
  throw new Error("Live Payment Ops details must survive a local state reload");
}
operationalTableRows.collector_payout_profiles.push({
  profile_id: "unassigned-super",
  payme_link: "https://payme.hsbc.com.hk/1/unassigned-super",
  fps_phone: "+852 6999 9999",
});
await operations.refreshOperationalState();
assert.ok(operations.livePayoutFor("unassigned-super"),
  "Admin hydration must first populate the unassigned payout cache fixture");

// Exercise the member-facing route after the real auth transition clears the
// in-memory Admin directory. UUID-keyed duty and payout operations must remain
// usable without persisting or reloading an editable identity directory.
const memberPaySession = store.upcomingSessions(28).find((session) =>
  session.kind === "paid"
  && session.id !== gatedPaidSession.id
);
if (!memberPaySession) throw new Error("Live payout transition needs another paid session");
// Reassign the fake auth context so the live RPC captures the member UUID
// (the test asserts the member-facing payout route after sign-out).
Object.assign(authUser, {
  id: "approved-member",
  email: "micah.member@example.com",
  user_metadata: { full_name: "Micah Member", avatar_url: "" },
});
Object.assign(profile, {
  id: "approved-member", email: "micah.member@example.com",
  full_name: "Micah Member", avatar_url: "", role: "member",
});
operationalAuthSubOverride = "approved-member";
const memberPayBooking = await store.reserveSession("approved-member", memberPaySession, Date.now());
operationalAuthSubOverride = null;
await store.setDuty("live-user-1", memberPaySession.dateISO);
const signOutForMember = store.signOutLive();
releaseSignOut({ error: null });
await signOutForMember;
await store.getCurrentUser();
store.load();
const assignedPayoutCallsBeforeMemberHydration = operationalRpcCalls
  .filter((call) => call.name === "get_assigned_collector_payout_profiles").length;
await operations.refreshOperationalState();
const memberDirectPayoutRead = operationalPayoutDirectReads.at(-1);
assert.equal(memberDirectPayoutRead?.profileId, "approved-member");
assert.doesNotMatch(memberDirectPayoutRead?.profileIds.join(",") || "", /live-user-1|unassigned-super/,
  "member direct payout-table hydration must not bypass self/Admin RLS");
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "get_assigned_collector_payout_profiles").length,
  assignedPayoutCallsBeforeMemberHydration + 1,
  "forced member hydration must request assigned collector payouts"
);
assert.equal(operations.livePayoutFor("unassigned-super"), null,
  "forced member hydration must clear an Admin-derived unassigned payout row");
store.currentUser().fullName = 'Micah & "Member" <Runner>';
store.getBooking(memberPayBooking.id).snapshot.location = 'BFT & "Bay" <Deck>';
const memberPayHtml = views.viewPay(memberPayBooking.id);
for (const marker of ["Riley", "https://payme.hsbc.com.hk/1/live-admin", "+852 6123 4567", 'data-action="copy-fps"']) {
  if (typeof memberPayHtml !== "string" || !memberPayHtml.includes(marker)) {
    throw new Error(`Member payout route after auth transition missing ${marker}`);
  }
}
const renderedPaymentNote = `${memberPayBooking.snapshot.name} · ${data.fmtDate(memberPayBooking.snapshot.dateISO)} · BFT & "Bay" <Deck> · Micah & "Member" <Runner>`;
const escapedRenderedPaymentNote = `${memberPayBooking.snapshot.name} · ${data.fmtDate(memberPayBooking.snapshot.dateISO)} · BFT &amp; &quot;Bay&quot; &lt;Deck&gt; · Micah &amp; &quot;Member&quot; &lt;Runner&gt;`;
const renderedPaymentNoteControl = [...memberPayHtml.matchAll(/<button\b[^>]*>/g)]
  .map((match) => match[0])
  .find((tag) => /\bdata-action="copy-payment-note"/.test(tag));
const renderedPaymentNoteAttribute = renderedPaymentNoteControl
  ?.match(/\bdata-note="([^"]*)"/)?.[1];
const renderedPaymentNotePayload = String(renderedPaymentNoteAttribute || "")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");
assert.ok(memberPayHtml.includes(`<strong>${escapedRenderedPaymentNote}</strong>`),
  "member payment view must escape visible HTML-sensitive note text");
assert.equal(renderedPaymentNoteAttribute, escapedRenderedPaymentNote,
  "member payment view must escape its data-note attribute");
assert.equal(renderedPaymentNotePayload, renderedPaymentNote,
  "the rendered data-note must decode to the exact delegated clipboard payload");
if (JSON.parse(mem.get("itc.prototype.v1")).users.length !== 0) {
  throw new Error("Member payout resolution must not persist a duplicate identity directory");
}
Object.assign(authUser, {
  id: "live-user-1", email: "runner@example.com",
  user_metadata: { full_name: "Riley Runner", avatar_url: "https://example.com/avatar.jpg" },
});
Object.assign(profile, {
  id: "live-user-1", email: "runner@example.com", full_name: "Riley Runner",
  avatar_url: "https://example.com/avatar.jpg", role: "super_admin",
});
await store.getCurrentUser();
await store.listPaymentUsers();
await operations.refreshOperationalState();
assert.ok(store.getBooking(uuidBooking.id),
  "restoring the Admin auth fixture must rehydrate its existing paid booking");
console.log("ok  live member payout survives Admin sign-out, member sign-in, and local reload");
console.log("ok  live Admin composes Supabase members with UUID-keyed local Payment Ops");

const detailsSummary = await views.viewAccount("details");
for (const label of [
  "Full name",
  "Preferred name",
  "Email",
  "Member since",
  "Mobile / WhatsApp number",
  "Age status",
  "Emergency contact name",
  "Emergency contact relationship",
  "Emergency contact phone",
  "How you heard about ITC",
]) {
  if (!detailsSummary.includes(label)) throw new Error(`Live details summary missing ${label}`);
}
if (!detailsSummary.includes("18 or over")) {
  throw new Error("Live details summary should show adult age status");
}
if (!detailsSummary.includes('href="#/account/details/edit"')) {
  throw new Error("Live details summary should link to the edit route");
}
if (detailsSummary.includes('data-form="membership-details"') || detailsSummary.includes("Date of birth")) {
  throw new Error("Live details summary should be a card, not the edit form or DOB UI");
}
const detailsEdit = await views.viewAccount("details", "edit");
if (!detailsEdit.includes('data-form="membership-details"')) {
  throw new Error("Live details edit route should render the membership-details form");
}
if (!detailsEdit.includes("Save changes")) {
  throw new Error("Live details edit route should render the save action");
}
if (!detailsEdit.includes("Riley Runner") || !detailsEdit.includes("runner@example.com")) {
  throw new Error("Live details edit route should show read-only identity rows");
}
if (!detailsEdit.includes('value="+852 6123 4567"')) {
  throw new Error("Live details edit route should prefill the mobile number");
}
if (!/name="age_over_18" value="yes"[^>]*checked/.test(detailsEdit)) {
  throw new Error("Live details edit route should prefill the adult age radio");
}
if (!detailsEdit.includes("data-minor-only") || !detailsEdit.includes("hidden")) {
  throw new Error("Live details edit route should keep the guardian block conditional");
}
if (!detailsEdit.includes('value="Taylor Coach"') || !detailsEdit.includes('value="Coach"') || !detailsEdit.includes('value="+852 6777 8888"')) {
  throw new Error("Live details edit route should prefill emergency contact fields");
}
if (!detailsEdit.includes('name="emergency_relationship"')) {
  throw new Error("Live details edit route should include emergency_relationship");
}
if (detailsEdit.includes('name="photo_consent"')) {
  throw new Error("Live details edit route should exclude photo consent controls");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  preferred_name: null,
});
const nullPreferredSummary = await views.viewAccount("details");
if (!nullPreferredSummary.includes("Preferred name</span><strong>Not provided</strong>")) {
  throw new Error("Null preferred_name should render as Not provided");
}
const nullPreferredEdit = await views.viewAccount("details", "edit");
if (!nullPreferredEdit.includes('name="preferred_name" value=""')) {
  throw new Error("Null preferred_name should stay blank in the edit form");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  preferred_name: "Riley",
});
const privacySummary = await views.viewAccount("privacy");
for (const label of [
  "WhatsApp session reminders",
  "HYROX payment reminders",
  "Email receipts",
  "Community news",
]) {
  if (!privacySummary.includes(label)) throw new Error(`Live notifications summary missing ${label}`);
}
if (privacySummary.includes("Photo/video consent") || privacySummary.includes("Privacy policy accepted")) {
  throw new Error("Live notifications summary should not include agreements");
}
if (!privacySummary.includes('>Off<') || (privacySummary.match(/>On</g) || []).length < 2) {
  throw new Error("Live notifications summary should show the expected On/Off values");
}
if (!privacySummary.includes('href="#/account/notifications/edit"')) {
  throw new Error("Live notifications summary should link to the edit route");
}
if (privacySummary.includes('data-form="privacy-preferences"')) {
  throw new Error("Live notifications summary should be a card, not the edit form");
}
const agreementsSummary = await views.viewAccount("agreements");
if (!agreementsSummary.includes("I consent to photos/videos of me being used on ITC channels. *")) {
  throw new Error("Live agreements should show required photo consent copy");
}
if (!agreementsSummary.includes("Please contact ITC Committee if you have any questions/concerns about this.")) {
  throw new Error("Live agreements should show the ITC Committee contact line");
}
if (!agreementsSummary.includes("Privacy policy accepted") || !agreementsSummary.includes(confirmedDay)) {
  throw new Error("Live agreements should show the accepted privacy date");
}
if (!agreementsSummary.includes("View Privacy Policy") || !agreementsSummary.includes("View Community Guidelines") || !agreementsSummary.includes("View Indemnity")) {
  throw new Error("Live agreements should let members open accepted documents");
}
if (!/name="photo_consent"[^>]*checked/.test(agreementsSummary) || !/name="photo_consent"[^>]*required/.test(agreementsSummary)) {
  throw new Error("Live agreements should prefill required checked photo consent");
}
const privacyEdit = await views.viewAccount("privacy", "edit");
if (!privacyEdit.includes('data-form="privacy-preferences"')) {
  throw new Error("Live notifications edit route should render the privacy-preferences form");
}
if (!privacyEdit.includes('href="#/account/notifications"')) {
  throw new Error("Live notifications edit route should link back to #/account/notifications");
}
if (privacyEdit.includes("Privacy policy accepted") || privacyEdit.includes('name="photo_consent"')) {
  throw new Error("Live notifications edit should not include agreements or photo consent");
}
for (const name of ["whatsapp_reminders", "hyrox_payment_reminders", "email_receipts", "community_news", "web_push_ops"]) {
  if (!privacyEdit.includes(`name="${name}"`)) {
    throw new Error(`Live notifications edit route missing ${name}`);
  }
}
if (/name="whatsapp_reminders"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should leave unchecked WhatsApp reminders off");
}
if (!/name="email_receipts"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should prefill checked email receipts");
}
if (!/name="community_news"[^>]*checked/.test(privacyEdit)) {
  throw new Error("Live privacy edit route should prefill checked community news");
}
if (!privacyEdit.includes("Save changes")) {
  throw new Error("Live privacy edit route should render the save action");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  whatsapp_reminders: undefined,
  email_receipts: undefined,
  community_news: undefined,
});
const missingPreferenceSummary = await views.viewAccount("privacy");
if ((missingPreferenceSummary.match(/>Off</g) || []).length < 3) {
  throw new Error("Live privacy summary should default omitted preference properties to Off");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  whatsapp_reminders: false,
  email_receipts: true,
  community_news: true,
});
await store.updateMyMembershipDetails({
  mobile: "+852 9000 0000",
  age_over_18: "yes",
  emergency_name: "Alex Runner",
  emergency_relationship: "Coach",
  emergency_phone: "+852 9111 1111",
  heard_source: "friend",
  heard_detail: "Run club",
  preferred_name: "Riley",
});
const membershipPatch = applicationUpdates.at(-1);
if (!membershipPatch) throw new Error("membership update missing");
const membershipKeys = Object.keys(membershipPatch).sort().join(",");
if (
  membershipKeys !==
  [
    "date_of_birth",
    "emergency_name",
    "emergency_phone",
    "emergency_relationship",
    "guardian_name",
    "guardian_phone",
    "heard_detail",
    "heard_source",
    "is_minor",
    "mobile",
    "preferred_name",
  ].join(",")
) {
  throw new Error(`membership patch leaked fields: ${membershipKeys}`);
}
for (const banned of [
  "photo_consent",
  "whatsapp_reminders",
  "email_receipts",
  "community_news",
  "waiver_accepted_at",
  "privacy_accepted_at",
  "guidelines_accepted_at",
  "submitted_at",
]) {
  if (banned in membershipPatch) throw new Error(`membership patch should exclude ${banned}`);
}
await store.updateMyPrivacyPreferences({
  whatsapp_reminders: true,
  hyrox_payment_reminders: false,
  email_receipts: false,
  community_news: false,
  web_push_ops: true,
});
const privacyPatch = applicationUpdates.at(-1);
if (!privacyPatch) throw new Error("privacy update missing");
const privacyKeys = Object.keys(privacyPatch).sort().join(",");
if (
  privacyKeys !==
  ["community_news", "email_receipts", "hyrox_payment_reminders", "web_push_ops", "whatsapp_reminders"].join(",")
) {
  throw new Error(`privacy patch leaked fields: ${privacyKeys}`);
}
if ("photo_consent" in privacyPatch) throw new Error("notification patch should exclude photo_consent");
for (const banned of [
  "mobile",
  "is_minor",
  "guardian_name",
  "guardian_phone",
  "emergency_name",
  "emergency_phone",
  "emergency_relationship",
  "heard_source",
  "heard_detail",
  "preferred_name",
  "waiver_accepted_at",
  "privacy_accepted_at",
  "guidelines_accepted_at",
  "submitted_at",
]) {
  if (banned in privacyPatch) throw new Error(`privacy patch should exclude ${banned}`);
}
applicationUpdates.length = 0;
const preservedWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(preservedWaiver, "2026-08-05T01:00:00.000Z");
assert.equal(applicationUpdates.length, 0, "current v1 acceptance should remain idempotent");
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  emergency_phone: "",
});
await assert.rejects(
  () => store.acceptMyIndemnity({
    signature: "Riley Runner",
    signedAt: "2026-08-05",
    emergencyRelationship: "Coach",
  }),
  /Enter emergency contact name, relationship and phone/
);
assert.equal(applicationUpdates.length, 0, "missing canonical emergency contact must not write a live waiver update");
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  emergency_phone: "+852 6777 8888",
});
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_signature_text: null,
  waiver_signed_at: null,
  waiver_form_version: null,
  emergency_relationship: null,
});
const legacyAccount = await views.viewAccount();
if (!legacyAccount.includes(`Legacy acceptance recorded on ${confirmedDay}`) || legacyAccount.includes("Indemnity confirmed on")) {
  throw new Error("Legacy live rows must stay stale/re-signable on the Profile summary");
}
const legacyWaiver = await views.viewAccount("indemnity");
for (const marker of [
  "A new version of the Indemnity is available",
  'data-doc-accept="indemnity"',
  'name="signature"',
  'name="signedAt"',
  'name="emergencyRelationship"',
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!legacyWaiver.includes(marker)) {
    throw new Error(`Legacy live re-sign flow missing ${marker}`);
  }
}
const createdWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(createdWaiver, fixedIso);
assert.deepEqual(applicationUpdates.at(-1), {
  waiver_accepted_at: fixedIso,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
  waiver_form_version: "v1",
  emergency_relationship: "Coach",
});

const home = views.viewHome();
if (!home.includes("Good to see you, Riley.")) {
  throw new Error("Home did not greet the signed-in Google user");
}
if (home.includes("Continue with Google")) {
  throw new Error("Home still asked the signed-in Google user to sign in");
}

const refreshedAccount = await views.viewAccount();
if (!refreshedAccount.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedAccount.includes("To be accepted")) {
  throw new Error("Account should rerender from the accepted live waiver timestamp");
}
const refreshedIndemnity = await views.viewAccount("indemnity");
if (!refreshedIndemnity.includes(`Indemnity confirmed on ${confirmedDay}`) || refreshedIndemnity.includes("To be accepted")) {
  throw new Error("Indemnity page should rerender from the accepted live waiver timestamp");
}
applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_accepted_at: null,
  waiver_signature_text: null,
  waiver_signed_at: null,
  waiver_form_version: null,
  emergency_relationship: null,
});
const waiverMissing = await views.viewAccount("indemnity");
if (!waiverMissing.includes("To be accepted")) {
  throw new Error("Indemnity page should prompt when the live waiver is missing");
}
applicationRows.delete(authUser.id);
const missingAccount = await views.viewAccount();
if (missingAccount?.redirect) {
  throw new Error("Approved/admin users missing an application must not redirect from Profile");
}
if (!missingAccount.includes("Application details unavailable")) {
  throw new Error("Profile should clearly say application details are unavailable");
}
if (missingAccount.includes("To be accepted")) {
  throw new Error("Profile must not claim indemnity is merely to-be-accepted without an application");
}
const missingDetails = await views.viewAccount("details");
if (missingDetails?.redirect || !missingDetails.includes("Application details unavailable")) {
  throw new Error("Live account details should show an unavailable card when no application exists");
}
if (missingDetails.includes('data-form="apply"') || missingDetails.includes("Save changes")) {
  throw new Error("Missing application details must not render an edit/application form");
}
const missingIndemnity = await views.viewAccount("indemnity");
if (missingIndemnity?.redirect || !missingIndemnity.includes("Application details unavailable")) {
  throw new Error("Live indemnity should show an unavailable card when no application exists");
}
if (missingIndemnity.includes("To be accepted") || missingIndemnity.includes("Accept &amp; Confirm")) {
  throw new Error("Missing application indemnity must not render an accept form or to-be-accepted claim");
}
const missingPrivacy = await views.viewAccount("privacy");
if (missingPrivacy?.redirect || !missingPrivacy.includes("Application details unavailable")) {
  throw new Error("Live privacy should show an unavailable card when no application exists");
}
for (const [label, html, title, backHref, backLabel] of [
  ["Profile", missingAccount, "Profile", "#/home", "Home"],
  ["Membership Details", missingDetails, "Membership Details", "#/account", "Profile"],
  ["Agreements", missingIndemnity, "Agreements", "#/account", "Profile"],
  ["Notifications", missingPrivacy, "Notifications", "#/account", "Profile"],
]) {
  assert.equal((html.match(/<h1\b/g) || []).length, 1,
    `Missing-application ${label} must render exactly one h1`);
  assert.match(
    html,
    new RegExp(`<a class="back-link" href="${backHref}">← ${backLabel}</a>\\s*<h1\\b[^>]*>${title}</h1>`),
    `Missing-application ${label} must link to ${backLabel} immediately before its h1`
  );
  assert.equal(html.match(/<h1\b[^>]*>([^<]+)<\/h1>/)?.[1], title,
    `Missing-application ${label} must use its exact semantic h1`);
  assert.doesNotMatch(html, /<div class="kicker mt16">Profile ·/,
    `Missing-application ${label} must not repeat Profile in a kicker`);
}
applicationRows.set("live-user-1", structuredClone(originalApplicationForApply));

const domListeners = new Map();
const windowListeners = new Map();
let documentVisibilityState = "visible";
let activeElement = null;
const makeElement = () => {
  const classes = new Set();
  return {
  children: [],
  className: "",
  innerHTML: "",
  textContent: "",
  dataset: {},
  hidden: false,
  attributes: new Map(),
  classList: {
    toggle(name, force) {
      const enabled = force === undefined ? !classes.has(name) : force;
      if (enabled) classes.add(name);
      else classes.delete(name);
      return enabled;
    },
    contains: (name) => classes.has(name),
  },
  appendChild(child) { this.children.push(child); },
  setAttribute(name, value) { this.attributes.set(name, String(value)); },
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  hasAttribute(name) { return this.attributes.has(name); },
  removeAttribute(name) { this.attributes.delete(name); },
  focus(options) {
    activeElement = this;
    this.focusOptions = options;
  },
  remove() {},
  querySelector() { return null; },
  };
};
const routeLoader = makeElement();
routeLoader.hidden = true;
const elements = new Map([
  ["view", makeElement()],
  ["bottom-nav", makeElement()],
  ["top-notifications", makeElement()],
  ["top-avatar", makeElement()],
  ["toast-stack", makeElement()],
  ["route-loader", routeLoader],
]);
globalThis.document = {
  get activeElement() { return activeElement; },
  get visibilityState() { return documentVisibilityState; },
  getElementById: (id) => elements.get(id),
  querySelector: () => null,
  createElement: () => makeElement(),
  addEventListener: (event, callback) => domListeners.set(event, callback),
};
globalThis.HTMLInputElement = class {};
globalThis.HTMLFormElement = class {};
globalThis.FormData = class {
  constructor(form) {
    this.form = form;
    this.values = new Map(Object.entries(form?.fields || {}));
    for (const control of form?.nativeControls || []) {
      if (control.disabled && control.name) this.values.delete(control.name);
    }
  }
  append(name, value) { this.values.set(name, value); }
  get(name) { return this.values.get(name) ?? null; }
  entries() { return this.values.entries(); }
};
globalThis.location = {
  hash: "#/account",
  origin: "https://payment-preview.example",
  pathname: "/feature/payment-system/app/",
};
window.location = globalThis.location;

const directMagicLink = store.signInWithMagicLink("  Runner@Example.com ");
assert.equal(magicLinkCalls, 1);
assert.deepEqual(magicLinkOptions, {
  email: "runner@example.com",
  options: {
    shouldCreateUser: true,
    emailRedirectTo: `${location.origin}/app/`,
  },
});
releaseMagicLink({ data: {}, error: null });
assert.deepEqual(await directMagicLink, { ok: true });

window.addEventListener = (event, callback) => windowListeners.set(event, callback);
window.scrollTo = () => {};
let nextTimerId = 1;
const delayedTimers = new Map();
globalThis.setTimeout = (callback, delay) => {
  if (delay === 0) deferredAuthTasks.push(callback);
  else delayedTimers.set(nextTimerId, { callback, delay });
  return nextTimerId++;
};
globalThis.clearTimeout = (id) => delayedTimers.delete(id);
const advanceTimersBy = (delay) => {
  for (const [id, timer] of [...delayedTimers]) {
    if (timer.delay !== delay) continue;
    delayedTimers.delete(id);
    timer.callback();
  }
};

async function dispatchAuthStateChange(event) {
  authCallbackLocked = true;
  try {
    const callbackResult = authStateChangeHandler(event);
    if (callbackResult !== undefined) {
      throw new Error("onAuthStateChange callback must return undefined synchronously");
    }
  } finally {
    authCallbackLocked = false;
  }
  while (deferredAuthTasks.length) {
    await deferredAuthTasks.shift()();
  }
}

const escapedRejections = [];
const captureRejection = (reason) => escapedRejections.push(reason);
process.on("unhandledRejection", captureRejection);
const originalConsoleError = console.error;
let expectedApplicationErrorLogs = [];
const captureExpectedApplicationErrors = (...args) => expectedApplicationErrorLogs.push(args);
applicationReadError = new Error("Application read failed");
console.error = captureExpectedApplicationErrors;
const app = await import("./js/app.js?application-read-errors");
await app.bootPromise;
await new Promise(setImmediate);
const toastStack = elements.get("toast-stack");
if (escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("Boot should catch one failed application read and show one error toast");
}

escapedRejections.length = 0;
toastStack.children.length = 0;
let hashRejected = false;
try {
  await windowListeners.get("hashchange")();
} catch {
  hashRejected = true;
}
await new Promise(setImmediate);
if (hashRejected || escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("Hash changes should catch failed application reads and show one error toast");
}
console.error = originalConsoleError;
assert.deepEqual(
  expectedApplicationErrorLogs.map(([message, error]) => [message, error?.message]),
  [
    ["Failed to load live application for account", "Application read failed"],
    ["Failed to hydrate live user", "Application read failed"],
    ["Failed to load live application for account", "Application read failed"],
    ["Failed to hydrate live user", "Application read failed"],
  ],
  "expected boot/hash application failures must be explicitly observed without noisy stderr"
);

// Retired deep-link coverage exercises the actual hash router for visitors,
// approved members, and unfinished pending applicants. Preserve all shared
// identity fixtures because later delegated-action tests reuse them.
applicationReadError = null;
const routeIdentityFixture = {
  authUser: structuredClone(authUser),
  profile: structuredClone(profile),
  session: liveSession,
  applications: new Map([...applicationRows].map(([id, row]) => [id, structuredClone(row)])),
  hash: location.hash,
};
const renderHashRoute = async (route) => {
  location.hash = route;
  await windowListeners.get("hashchange")();
  await new Promise(setImmediate);
  return elements.get("view").innerHTML;
};
const configureRouteViewer = async (viewer) => {
  if (viewer === "public") {
    liveSession = null;
    await store.getCurrentUser();
    return;
  }
  const approved = viewer === "approved";
  Object.assign(authUser, approved ? {
    id: "approved-member",
    email: "micah.member@example.com",
    user_metadata: { full_name: "Micah Member", avatar_url: "" },
  } : routeIdentityFixture.authUser);
  Object.assign(profile, approved ? {
    id: "approved-member",
    email: "micah.member@example.com",
    full_name: "Micah Member",
    avatar_url: "",
    role: "member",
  } : { ...routeIdentityFixture.profile, role: "pending" });
  liveSession = { ...routeIdentityFixture.session, user: authUser };
  if (approved) applicationRows.set(authUser.id, {
    profile_id: authUser.id,
    mobile: "+852 6000 0000",
  });
  else applicationRows.delete(authUser.id);
  await store.getCurrentUser();
};
const retiredHashRoutes = [
  `#/activity/${retiredBftSessionId}`,
  "#/hyrox/hyrox-pool-2099-01-03/register",
  `#/booking/${retiredRouteBookingId}`,
  `#/receipt/${retiredRouteReceiptId}`,
];
const retiredRouteRpcCount = operationalRpcCalls.length;
const retiredRouteSessionAvatarCount = avatarResolveCalls
  .filter((call) => new URL(call.url).searchParams.get("scope") === "session").length;
const retiredRouteAttendeeRpcCount = operationalRpcCalls
  .filter((call) => call.name === "get_operational_attendee_names").length;
try {
  for (const viewer of ["public", "pending", "approved"]) {
    await configureRouteViewer(viewer);
    for (const route of retiredHashRoutes) {
      const html = await renderHashRoute(route);
      assert.match(html, /<h2>This session is no longer available\.<\/h2>/,
        `${viewer} ${route} must render the exact neutral retired state`);
      assert.doesNotMatch(html, /404|Island ECC|notification/i,
        `${viewer} ${route} must not reveal, redirect, or notify`);
      assert.equal(location.hash, route, `${viewer} ${route} must keep its original hash`);
      if (viewer === "pending") {
        await app.maybeRedirectToApply();
        assert.equal(location.hash, route,
          `pending onboarding must exempt recognized retired route ${route}`);
      }
    }
  }

  await configureRouteViewer("pending");
  const authRefreshRoute = `#/receipt/${retiredRouteReceiptId}`;
  await renderHashRoute(authRefreshRoute);
  await dispatchAuthStateChange("SIGNED_IN");
  assert.equal(location.hash, authRefreshRoute,
    "SIGNED_IN refresh must preserve a recognized retired route for unfinished pending applicants");
  assert.match(elements.get("view").innerHTML, /<h2>This session is no longer available\.<\/h2>/);
  assert.equal(operationalRpcCalls.length, retiredRouteRpcCount,
    "retired route rendering must not invoke operational RPCs");
  assert.equal(
    operationalRpcCalls.filter((call) => call.name === "get_operational_attendee_names").length,
    retiredRouteAttendeeRpcCount,
    "retired Activity routing must not request attendee names",
  );
  assert.equal(
    avatarResolveCalls.filter((call) => new URL(call.url).searchParams.get("scope") === "session").length,
    retiredRouteSessionAvatarCount,
    "retired Activity routing must not resolve attendee avatars",
  );

  await configureRouteViewer("approved");
  const islandActivityHtml = await renderHashRoute(`#/activity/${islandEccSessionId}`);
  assert.match(islandActivityHtml, /Manage booking/,
    "Island ECC Activity must retain its direct booking control through the router");
  assert.match(islandActivityHtml, /Get directions/,
    "Island ECC Activity must retain directions through the router");
  const islandPayHtml = await renderHashRoute(`#/pay/${memberPayBooking.id}`);
  assert.match(islandPayHtml, /I’ve paid/,
    "Island ECC payment must retain its direct mark-paid control through the router");
  const islandBookingHtml = await renderHashRoute("#/booking/island-ecc-booking");
  assert.match(islandBookingHtml, /View receipt/,
    "Island ECC booking must retain its receipt control through the router");
  assert.match(islandBookingHtml, /Create private invite/,
    "Island ECC booking must retain its replacement control through the router");
  const islandReceiptHtml = await renderHashRoute("#/receipt/island-ecc-receipt");
  assert.match(islandReceiptHtml, /ITC-2026-ECC/,
    "Island ECC receipt must remain normal through the router");
} finally {
  Object.assign(authUser, routeIdentityFixture.authUser);
  Object.assign(profile, routeIdentityFixture.profile);
  liveSession = routeIdentityFixture.session;
  applicationRows.clear();
  routeIdentityFixture.applications.forEach((row, id) => applicationRows.set(id, row));
  location.hash = routeIdentityFixture.hash;
  await store.getCurrentUser();
}
console.log("ok  retired deep links stay neutral across router identities and preserve Island ECC controls");

// Pending-route policy coverage preserves every mutable fixture because later
// tests reuse them.
const redirectFixture = {
  session: liveSession,
  role: profile.role,
  application: structuredClone(applicationRows.get(authUser.id)),
  hadApplication: applicationRows.has(authUser.id),
  hash: location.hash,
};
try {
  profile.role = "pending";
  applicationRows.delete(authUser.id);

  location.hash = "#/community/prayers";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/community/prayers",
    "unfinished pending applicants must remain on the read-only Prayer gate");

  location.hash = "#/home";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/apply",
    "unfinished pending applicants must redirect from ordinary routes");

  location.hash = "#/apply";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/apply",
    "the application route must not redirect to itself");

  applicationRows.set(authUser.id, structuredClone(redirectFixture.application));
  location.hash = "#/home";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/home",
    "submitted pending applicants must remain on their route");

  profile.role = "declined";
  applicationRows.delete(authUser.id);
  location.hash = "#/home";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/home",
    "declined applicants must remain on their route");

  liveSession = null;
  profile.role = "pending";
  location.hash = "#/home";
  await app.maybeRedirectToApply();
  assert.equal(location.hash, "#/home",
    "visitors must remain on their route");
} finally {
  liveSession = redirectFixture.session;
  profile.role = redirectFixture.role;
  if (redirectFixture.hadApplication) {
    applicationRows.set(authUser.id, redirectFixture.application);
  } else {
    applicationRows.delete(authUser.id);
  }
  location.hash = redirectFixture.hash;
  await store.getCurrentUser();
}
console.log("ok  pending onboarding redirect wiring preserves route policy");

// Route feedback announces work immediately, only exposes visible copy after
// the delay, and always clears once the awaited view is complete.
let releaseApplicationRead;
applicationReadGate = new Promise((resolve) => { releaseApplicationRead = resolve; });
const slowRender = windowListeners.get("hashchange")();
const viewEl = elements.get("view");
assert.equal(viewEl.getAttribute("aria-busy"), "true", "async route must announce busy immediately");
assert.equal(routeLoader.hidden, true, "fast routes must not flash loading feedback");
advanceTimersBy(300);
assert.equal(routeLoader.hidden, false, "slow route must expose delayed loading feedback");
releaseApplicationRead();
await slowRender;
applicationReadGate = null;
assert.equal(viewEl.hasAttribute("aria-busy"), false, "route busy state must clear");
assert.equal(routeLoader.hidden, true, "route loading feedback must clear");

// Three overlapping routes prove that stale completion cannot clear current
// feedback and out-of-order completion cannot replace the newest route.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const oldestGate = deferred();
const middleGate = deferred();
const currentGate = deferred();
applicationReadGates.push(oldestGate.promise, middleGate.promise, currentGate.promise);
location.hash = "#/account/notifications";
const oldestRender = windowListeners.get("hashchange")();
location.hash = "#/account/agreements";
const middleRender = windowListeners.get("hashchange")();
location.hash = "#/account/details";
const currentRender = windowListeners.get("hashchange")();
advanceTimersBy(300);
assert.equal(viewEl.getAttribute("aria-busy"), "true");
assert.equal(routeLoader.hidden, false);
middleGate.resolve();
await middleRender;
assert.equal(viewEl.getAttribute("aria-busy"), "true", "stale completion must not clear current busy state");
assert.equal(routeLoader.hidden, false, "stale completion must not hide the current loader");
currentGate.resolve();
await currentRender;
const currentRouteHtml = viewEl.innerHTML;
assert.match(currentRouteHtml, /Membership Details/);
assert.equal(viewEl.hasAttribute("aria-busy"), false);
assert.equal(routeLoader.hidden, true);
oldestGate.resolve();
await oldestRender;
assert.equal(viewEl.innerHTML, currentRouteHtml, "an older route must not commit after the current route");
assert.equal(viewEl.hasAttribute("aria-busy"), false);
assert.equal(routeLoader.hidden, true);

// Signed-in notification chrome appears before its best-effort count query,
// fails silently, and ignores stale generations.
const notificationBell = elements.get("top-notifications");
const countGate = deferred();
notificationReadGate = countGate.promise;
location.hash = "#/home";
const immediateBellRender = windowListeners.get("hashchange")();
await immediateBellRender;
assert.equal(notificationBell.hidden, false, "signed-in bell must be visible without waiting for its count");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.doesNotMatch(notificationBell.innerHTML, /notification-badge/);
countGate.resolve();
await new Promise(setImmediate);
assert.match(notificationBell.innerHTML, /notification-badge[^>]*[\s\S]*>2<\/span>/);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 2 unread");

const cappedRows = Array.from({ length: 118 }, (_, index) => ({
  id: `notification-cap-${index}`,
  kind: "welcome",
  title: "Unread update",
  body: "Unread count cap fixture.",
  created_at: "2026-08-05T06:39:00.000Z",
  read_at: null,
}));
notificationRows.push(...cappedRows);
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 120 unread",
  "the accessible label must retain the full unread count");
assert.match(notificationBell.innerHTML, />99\+<\/span>/, "only the visual badge should cap at 99+");
notificationRows.splice(-cappedRows.length);

const toastsBeforeCountFailure = toastStack.children.length;
notificationReadError = new Error("Notification count unavailable");
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.hidden, false);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.doesNotMatch(notificationBell.innerHTML, /notification-badge/);
assert.equal(toastStack.children.length, toastsBeforeCountFailure, "count failures must not toast");

const staleCountGate = deferred();
notificationReadGate = staleCountGate.promise;
const staleCountRender = windowListeners.get("hashchange")();
await staleCountRender;
notificationRows.push({
  id: "notification-new-unread",
  kind: "welcome",
  title: "New update",
  body: "A newer generation sees this unread row.",
  created_at: "2026-08-05T06:39:00.000Z",
  read_at: null,
});
await windowListeners.get("hashchange")();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 3 unread");
staleCountGate.resolve();
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 3 unread",
  "a stale unread query must not overwrite newer chrome");
notificationRows.pop();

const directRouteGate = deferred();
notificationReadGate = directRouteGate.promise;
const queriesBeforeDirectRoute = notificationQueryCount;
location.hash = "#/notifications";
const directRouteRender = windowListeners.get("hashchange")();
assert.equal(notificationBell.hidden, false,
  "a direct Notifications route must commit signed-in chrome before its query resolves");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications");
assert.equal(notificationBell.getAttribute("aria-current"), "page");
assert.equal(notificationQueryCount, queriesBeforeDirectRoute + 1,
  "the Notifications page and unread badge must share one query");
directRouteGate.resolve();
await directRouteRender;
await new Promise(setImmediate);
assert.equal(notificationQueryCount, queriesBeforeDirectRoute + 1,
  "resolving the direct route must not start a second unread query");
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 2 unread");
assert.doesNotMatch(elements.get("bottom-nav").innerHTML, /aria-current="page"/,
  "Notifications must not activate a bottom navigation item");

// Out-of-order overlapping Notifications renders must leave the route cache
// paired with the newest committed HTML. Filtering that page remains local.
const olderNotificationsGate = deferred();
notificationReadGate = olderNotificationsGate.promise;
const queriesBeforeOverlap = notificationQueryCount;
const olderNotificationsRender = windowListeners.get("hashchange")();
notificationRows.unshift({
  id: "notification-latest-application",
  kind: "admin_application_submitted",
  title: "Latest application",
  body: "This row belongs only to the newest route request.",
  created_at: "2026-08-05T06:39:30.000Z",
  read_at: null,
});
const currentNotificationsGate = deferred();
notificationReadGate = currentNotificationsGate.promise;
const currentNotificationsRender = windowListeners.get("hashchange")();
assert.equal(notificationQueryCount, queriesBeforeOverlap + 2,
  "each overlapping Notifications route should issue exactly one shared query");
currentNotificationsGate.resolve();
await currentNotificationsRender;
olderNotificationsGate.resolve();
await olderNotificationsRender;
notificationRows.shift();
const overlapFilterControl = makeElement();
overlapFilterControl.tagName = "BUTTON";
overlapFilterControl.dataset = { action: "notification-filter", notificationFilter: "application" };
overlapFilterControl.closest = () => overlapFilterControl;
const queriesBeforeOverlapFilter = notificationQueryCount;
await domListeners.get("click")({ target: overlapFilterControl });
assert.equal(notificationQueryCount, queriesBeforeOverlapFilter,
  "filtering after overlapping routes must not fetch again");
assert.match(viewEl.innerHTML, /Latest application/,
  "a stale Notifications completion must not replace the newest route rows");
views.notificationFilters.kind = "all";

// Kind filters are view-local: activating one reuses route rows, rerenders the
// Notifications HTML, and restores keyboard focus to the equivalent new chip.
const filterControl = makeElement();
filterControl.tagName = "BUTTON";
filterControl.dataset = { action: "notification-filter", notificationFilter: "application" };
filterControl.closest = () => filterControl;
const replacementFilterControl = makeElement();
const filterSelector = '[data-action="notification-filter"][data-notification-filter="application"]';
viewEl.querySelector = (selector) => selector === filterSelector ? replacementFilterControl : null;
const queriesBeforeFilter = notificationQueryCount;
await domListeners.get("click")({ target: filterControl });
assert.equal(views.notificationFilters.kind, "application");
assert.equal(notificationQueryCount, queriesBeforeFilter,
  "a local kind filter must not refetch notifications");
assert.match(viewEl.innerHTML, /data-notification-filter="application"[^>]*aria-pressed="true"/);
assert.match(viewEl.innerHTML, /Application &lt;submitted&gt;/);
assert.doesNotMatch(viewEl.innerHTML, /Welcome to ITC|Role changed/);
assert.equal(activeElement, replacementFilterControl,
  "filter rerender must restore focus to the activated chip");
viewEl.querySelector = () => null;
views.notificationFilters.kind = "all";
await domListeners.get("click")({
  target: {
    dataset: { action: "notification-filter", notificationFilter: "all" },
    closest() { return this; },
  },
});

// The live reservation notification must preserve its exact booking-owned pay
// route from rendered HTML through the real click delegate. Reopening the same
// now-read row must keep that route without issuing a second read update.
const exactPaymentDestination = `#/pay/${uuidBooking.id}`;
const bookingReservedNotification = {
  id: "notification-booking-reserved-exact",
  kind: "operational_booking_reserved",
  title: "Booking reserved",
  body: "Complete payment for your reservation.",
  destination: exactPaymentDestination,
  created_at: "2026-08-05T06:39:45.000Z",
  read_at: null,
};
notificationRows.push(bookingReservedNotification);
const renderedNotificationControl = async () => {
  const html = await views.viewNotifications(notificationNow, [bookingReservedNotification]);
  const button = (html.match(/<button class="notification-row[\s\S]*?<\/button>/g) || [])
    .find((row) => row.includes("<strong>Booking reserved</strong>"));
  assert.ok(button, "Booking reserved must render as a notification row");
  const attribute = (name) => button.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  const destination = attribute("data-destination");
  assert.equal(destination, exactPaymentDestination,
    "Booking reserved must render the exact reserved-booking payment route");
  assert.notEqual(destination, "#/account");
  assert.notEqual(destination, "#/account/payments");

  const control = makeElement();
  control.tagName = "BUTTON";
  control.textContent = "Booking reserved Complete payment for your reservation.";
  control.dataset = {
    action: attribute("data-action"),
    notificationId: attribute("data-notification-id"),
    notificationRead: attribute("data-notification-read"),
    destination,
  };
  control.closest = () => control;
  return control;
};

const unreadBookingReservedControl = await renderedNotificationControl();
assert.equal(unreadBookingReservedControl.dataset.notificationRead, "false");
const updatesBeforeBookingReservedOpen = notificationUpdates.length;
await domListeners.get("click")({ target: unreadBookingReservedControl });
assert.equal(notificationUpdates.length, updatesBeforeBookingReservedOpen + 1,
  "opening the unread reservation notification must complete one read update");
assert.equal(notificationUpdates.at(-1)?.id, bookingReservedNotification.id);
assert.ok(bookingReservedNotification.read_at,
  "opening the unread reservation notification must persist its read state");
assert.equal(location.hash, exactPaymentDestination,
  "the unread reservation notification must navigate to its exact payment route");
await windowListeners.get("hashchange")();
assert.ok(viewEl.innerHTML.includes(`data-booking="${uuidBooking.id}"`),
  "the same existing payment view must accept the current member's reserved booking");
for (const marker of [
  "PayMe", "Suggested payment note", 'data-action="copy-payment-note"',
  "Assigned collector / payee", "FPS mobile number", "Exact amount", "Suggested reference",
  'data-action="copy-fps"', 'data-action="copy-reference"',
]) {
  assert.ok(viewEl.innerHTML.includes(marker),
    `notification-routed Payment view missing integrated marker: ${marker}`);
}
assert.doesNotMatch(viewEl.innerHTML, /Booking not found\.|QR|Scan with your banking app|amount is embedded/i);
notificationRows.splice(notificationRows.indexOf(bookingReservedNotification), 1);
location.hash = "#/notifications";
await windowListeners.get("hashchange")();
console.log("ok  exact Booking reserved notification routes to the owned existing payment view");

// Unread row activation is checked, duplicate-safe, and row-safe. It does not
// navigate until one unread row is confirmed updated, then advances the render
// generation so an older same-route count cannot overwrite the new badge.
const sameRouteStaleGate = deferred();
notificationReadGate = sameRouteStaleGate.promise;
const sameRouteStaleRender = windowListeners.get("hashchange")();
const updateGate = deferred();
notificationUpdateGate = updateGate.promise;
const notificationControl = makeElement();
notificationControl.tagName = "BUTTON";
notificationControl.textContent = "Application submitted Review Riley";
notificationControl.dataset = {
  action: "notification-open",
  notificationId: "notification-admin-application",
  notificationRead: "false",
  destination: "#/admin/approvals",
};
notificationControl.closest = () => notificationControl;
const updatesBeforeOpen = notificationUpdates.length;
const notificationHtmlBeforeOpen = viewEl.innerHTML;
let notificationNavigationSnapshot = null;
let observedNotificationHash = location.hash;
Object.defineProperty(location, "hash", {
  configurable: true,
  get: () => observedNotificationHash,
  set: (value) => {
    if (value === "#/admin/approvals" && !notificationNavigationSnapshot) {
      notificationNavigationSnapshot = {
        html: viewEl.innerHTML,
        bellLabel: notificationBell.getAttribute("aria-label"),
      };
    }
    observedNotificationHash = value;
  },
});
const markReadRender = domListeners.get("click")({ target: notificationControl });
const duplicateOpen = domListeners.get("click")({ target: notificationControl });
assert.equal(notificationUpdates.length, updatesBeforeOpen + 1, "double activation must send one update");
assert.equal(location.hash, "#/notifications", "an unread row must wait for update success before navigating");
assert.equal(notificationControl.disabled, true);
assert.equal(notificationControl.getAttribute("aria-busy"), "true");
assert.equal(notificationControl.getAttribute("aria-label"), "Opening…");
assert.equal(notificationControl.classList.contains("is-busy"), true);
assert.equal(notificationControl.textContent, "Application submitted Review Riley",
  "structured notification content must not be replaced by a busy label");
await duplicateOpen;
assert.equal(location.hash, "#/notifications",
  "a duplicate activation must not navigate before the first read update succeeds");
updateGate.resolve();
await markReadRender;
notificationUpdateGate = null;
assert.equal(location.hash, "#/admin/approvals");
assert.notEqual(viewEl.innerHTML, notificationHtmlBeforeOpen,
  "successful mark-read must update the notification window before navigation");
assert.doesNotMatch(viewEl.innerHTML, /Application &lt;submitted&gt;/,
  "the read row must be removed from the notification window immediately");
assert.match(viewEl.innerHTML, /Welcome to ITC/,
  "other unread rows must remain in the notification window");
assert.doesNotMatch(notificationNavigationSnapshot?.html || "", /Application &lt;submitted&gt;/,
  "the row must already be absent when the destination hash is assigned");
assert.equal(notificationNavigationSnapshot?.bellLabel, "Notifications, 1 unread",
  "the unread count must already be updated when navigation starts");
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, /Ready for review/);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 1 unread");
assert.equal(notificationControl.disabled, false);
assert.equal(notificationControl.hasAttribute("aria-busy"), false);
assert.equal(notificationControl.hasAttribute("aria-label"), false);
assert.equal(notificationControl.classList.contains("is-busy"), false);
sameRouteStaleGate.resolve();
await sameRouteStaleRender;
await new Promise(setImmediate);
assert.equal(notificationBell.getAttribute("aria-label"), "Notifications, 1 unread",
  "a stale same-route count must not overwrite the post-mark-read generation");

// Already-read rows skip the write and route immediately to their semantic destination.
location.hash = "#/notifications";
await windowListeners.get("hashchange")();
const alreadyReadControl = makeElement();
alreadyReadControl.tagName = "BUTTON";
alreadyReadControl.textContent = "Role changed";
alreadyReadControl.dataset = {
  action: "notification-open",
  notificationId: "notification-admin-role",
  notificationRead: "true",
  destination: "#/admin/members",
};
alreadyReadControl.closest = () => alreadyReadControl;
const updatesBeforeReadOpen = notificationUpdates.length;
const readOpen = domListeners.get("click")({ target: alreadyReadControl });
assert.equal(location.hash, "#/admin/members", "read rows should navigate without waiting for a write");
await readOpen;
assert.equal(notificationUpdates.length, updatesBeforeReadOpen, "read rows must not update again");
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, /href="#\/admin\/members" class="active"/);

// Destination failures use shared route feedback after mutation handling has
// finished. They must never be misreported as mark-read failures, whether the
// activated row started unread or read.
for (const initiallyRead of [false, true]) {
  location.hash = "#/notifications";
  await windowListeners.get("hashchange")();
  const retainedDestinationHtml = viewEl.innerHTML;
  toastStack.children.length = 0;
  const destinationFailure = new Error(initiallyRead
    ? "Read notification destination unavailable"
    : "Unread notification destination unavailable");
  profileListError = destinationFailure;
  const destinationControl = makeElement();
  destinationControl.tagName = "BUTTON";
  destinationControl.textContent = "Open operational notification";
  destinationControl.dataset = {
    action: "notification-open",
    notificationId: initiallyRead ? "notification-admin-role" : "notification-destination-unread",
    notificationRead: initiallyRead ? "true" : "false",
    destination: "#/admin/members",
  };
  destinationControl.closest = () => destinationControl;
  if (!initiallyRead) {
    notificationRows.push({
      id: "notification-destination-unread",
      kind: "admin_role_promoted",
      title: "Destination test",
      body: "Destination failure fixture.",
      created_at: "2026-08-05T06:39:30.000Z",
      read_at: null,
    });
  }
  const updatesBeforeDestinationFailure = notificationUpdates.length;
  await domListeners.get("click")({ target: destinationControl });
  assert.equal(location.hash, "#/admin/members");
  assert.equal(notificationUpdates.length, updatesBeforeDestinationFailure + (initiallyRead ? 0 : 1));
  await windowListeners.get("hashchange")();
  assert.equal(viewEl.innerHTML, retainedDestinationHtml,
    "A failed destination render must retain the last successful Notifications page");
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [destinationFailure.message]);
  assert.equal(toastStack.children.some((item) => item.textContent === "Failed to mark notification read"), false);
  if (!initiallyRead) {
    assert.ok(notificationRows.find((row) => row.id === "notification-destination-unread")?.read_at,
      "Unread destination failure must not roll back or misreport a successful mark-read");
    notificationRows.splice(notificationRows.findIndex((row) => row.id === "notification-destination-unread"), 1);
  }
  profileListError = null;
}

// Update errors and zero-row conflicts retain the Notifications page, hash,
// and unread count, recover the row, and expose one accessible generic error.
for (const failureMode of ["error", "zero"]) {
  location.hash = "#/notifications";
  await windowListeners.get("hashchange")();
  const retainedNotificationHtml = viewEl.innerHTML;
  const retainedNotificationLabel = notificationBell.getAttribute("aria-label");
  const queriesBeforeFailure = notificationQueryCount;
  toastStack.children.length = 0;
  notificationUpdateError = failureMode === "error" ? new Error("Notification update unavailable") : null;
  notificationUpdateResult = failureMode === "zero" ? "zero" : "row";
  const failedControl = makeElement();
  failedControl.tagName = "BUTTON";
  failedControl.textContent = "Welcome to ITC";
  failedControl.setAttribute("aria-label", "Open welcome notification");
  failedControl.dataset = {
    action: "notification-open",
    notificationId: "notification-welcome",
    notificationRead: "false",
    destination: "#/account",
  };
  failedControl.closest = () => failedControl;
  await domListeners.get("click")({ target: failedControl });
  assert.equal(location.hash, "#/notifications", `${failureMode} must retain the current hash`);
  assert.equal(viewEl.innerHTML, retainedNotificationHtml, `${failureMode} must retain the current page`);
  assert.equal(notificationBell.getAttribute("aria-label"), retainedNotificationLabel,
    `${failureMode} must retain the unread count`);
  assert.equal(notificationQueryCount, queriesBeforeFailure, `${failureMode} must not render a destination`);
  assert.equal(failedControl.disabled, false);
  assert.equal(failedControl.hasAttribute("aria-busy"), false);
  assert.equal(failedControl.getAttribute("aria-label"), "Open welcome notification");
  assert.equal(failedControl.classList.contains("is-busy"), false);
  assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]),
    [["Failed to mark notification read", "alert"]]);
  assert.match(toastStack.children[0].className, /err/);
}
notificationUpdateError = null;
notificationUpdateResult = "row";

// Approval queue failures must be truthful and preserve the last good queue.
applicationReadError = null;
profile.role = "super_admin";
pendingProfiles.find((item) => item.id === "pending-submitted").role = "pending";
location.hash = "#/admin";
toastStack.children.length = 0;
await windowListeners.get("hashchange")();
const retainedQueueHtml = elements.get("view").innerHTML;
assert.equal(document.activeElement, elements.get("view"), "Successful route renders must focus #view");
assert.deepEqual(elements.get("view").focusOptions, { preventScroll: true });
assert.match(retainedQueueHtml, /Submitted Runner/);
assert.match(retainedQueueHtml, /Incomplete Runner/);

for (const [errorType, setError] of [
  ["Profile queue read failed", (error) => { profileListError = error; }],
  ["Application queue read failed", (error) => { applicationListError = error; }],
]) {
  const error = new Error(errorType);
  setError(error);
  toastStack.children.length = 0;
  await assert.rejects(() => store.listApprovalCandidates(), new RegExp(errorType));
  await windowListeners.get("hashchange")();
  assert.equal(elements.get("view").innerHTML, retainedQueueHtml, `${errorType} must retain prior queue UI`);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [errorType]);
  assert.equal(toastStack.children.some((item) => /Approved\.|Declined\./.test(item.textContent)), false);
  setError(null);
}

const click = domListeners.get("click");
const change = domListeners.get("change");

const magicForm = new HTMLFormElement();
magicForm.id = "form-magic-link";
magicForm.dataset = {};
magicForm.fields = { email: "  Member@Example.com " };
magicForm.reportValidity = () => true;
const magicEmail = makeElement();
magicEmail.name = "email";
magicEmail.disabled = false;
const magicSubmit = makeElement();
magicSubmit.textContent = "Email me a sign-in link";
magicSubmit.disabled = false;
const magicFeedback = makeElement();
magicForm.nativeControls = [magicEmail, magicSubmit];
magicForm.querySelector = (selector) => ({
  '[name="email"]': magicEmail,
  '[type="submit"]': magicSubmit,
  "[data-magic-link-feedback]": magicFeedback,
}[selector] || null);

const firstMagicSubmit = domListeners.get("submit")({
  target: magicForm,
  preventDefault() {},
});
assert.equal(magicEmail.disabled, true);
assert.equal(magicSubmit.disabled, true);
assert.equal(magicSubmit.textContent, "Sending…");
const duplicateMagicSubmit = domListeners.get("submit")({
  target: magicForm,
  preventDefault() {},
});
assert.equal(magicLinkCalls, 2, "one direct store test plus one form request");
releaseMagicLink({ data: {}, error: null });
await Promise.all([firstMagicSubmit, duplicateMagicSubmit]);
assert.equal(magicEmail.disabled, false);
assert.equal(magicSubmit.disabled, false);
assert.match(magicFeedback.textContent, /Check your inbox/);
assert.equal(magicFeedback.getAttribute("role"), "status");

const rejectedMagicSubmit = domListeners.get("submit")({
  target: magicForm,
  preventDefault() {},
});
assert.equal(magicLinkCalls, 3);
releaseMagicLink({ data: null, error: new Error("User not found") });
await rejectedMagicSubmit;
assert.equal(magicFeedback.getAttribute("role"), "alert");
assert.equal(
  magicFeedback.textContent,
  "We couldn’t send the link. Wait a moment and try again."
);
assert.doesNotMatch(magicFeedback.textContent, /User not found/);
assert.equal(magicEmail.disabled, false);
assert.equal(magicSubmit.disabled, false);
console.log("ok  delegated magic-link requests dedupe and recover with generic feedback");

// Prayer submission must retain private content on failure and must not report
// success until the authoritative write settles.
const makePrayerForm = (request, anonymousToLeaders = false) => {
  const form = new HTMLFormElement();
  form.id = "form-prayer";
  form.dataset = {};
  form.fields = {
    request,
    ...(anonymousToLeaders ? { anonymousToLeaders: "on" } : {}),
  };
  form.reportValidity = () => true;
  const submit = makeElement();
  submit.tagName = "BUTTON";
  submit.textContent = "Send prayer request";
  submit.disabled = false;
  const error = makeElement();
  form.nativeControls = [submit];
  form.querySelector = (selector) => ({
    '[type="submit"]': submit,
    "#prayer-error": error,
  }[selector] || null);
  return { form, submit, error };
};

location.hash = "#/community/prayers";
toastStack.children.length = 0;
const rejectedPrayer = makePrayerForm("Keep this private prayer", true);
const prayerCallsBeforeRejectedSubmit = prayerRpcCalls.length;
prayerRpcErrors.set("submit_prayer_request", { message: "sensitive prayer write failure" });
await domListeners.get("submit")({ target: rejectedPrayer.form, preventDefault() {} });
prayerRpcErrors.delete("submit_prayer_request");
assert.equal(prayerRpcCalls.length, prayerCallsBeforeRejectedSubmit + 1);
assert.deepEqual(prayerRpcCalls.at(-1), {
  name: "submit_prayer_request",
  args: {
    p_request_text: "Keep this private prayer",
    p_anonymous_to_leaders: true,
  },
});
assert.equal(rejectedPrayer.form.fields.request, "Keep this private prayer");
assert.equal(rejectedPrayer.form.fields.anonymousToLeaders, "on");
assert.equal(location.hash, "#/community/prayers");
assert.equal(toastStack.children.length, 0,
  "a rejected Prayer submit must not show a success toast");
assert.equal(rejectedPrayer.error.children.length, 1);
assert.equal(
  rejectedPrayer.error.children[0].textContent,
  "Prayer request could not be sent. Please try again.",
);
assert.equal(rejectedPrayer.error.children[0].getAttribute("role"), "alert");
assert.equal(rejectedPrayer.submit.disabled, false);
assert.equal(rejectedPrayer.submit.hasAttribute("aria-busy"), false);

const successfulPrayer = makePrayerForm("Wait for this prayer write");
const submitPrayerGate = deferred();
prayerRpcGate = { name: "submit_prayer_request", promise: submitPrayerGate.promise };
let successfulPrayerSettled = false;
const successfulPrayerSubmit = domListeners.get("submit")({
  target: successfulPrayer.form,
  preventDefault() {},
}).then(() => { successfulPrayerSettled = true; });
await new Promise(setImmediate);
assert.equal(successfulPrayerSettled, false);
assert.equal(successfulPrayer.submit.disabled, true);
assert.equal(location.hash, "#/community/prayers");
assert.equal(toastStack.children.length, 0,
  "Prayer success must wait for the authoritative write");
submitPrayerGate.resolve({ data: [structuredClone(prayerMemberRow)], error: null });
await successfulPrayerSubmit;
prayerRpcGate = null;
assert.equal(location.hash, "#/community/prayers",
  "successful Prayer submit must rerender the same route");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Prayer request sent privately",
]);
assert.equal(successfulPrayer.submit.disabled, false);
assert.equal(successfulPrayer.submit.hasAttribute("aria-busy"), false);

const makePrayerAction = (action, textContent) => {
  const control = makeElement();
  control.tagName = "BUTTON";
  control.textContent = textContent;
  control.disabled = false;
  control.dataset = { action, prayer: PRAYER_ID };
  control.closest = () => control;
  return control;
};

toastStack.children.length = 0;
const memberStateCalls = () => prayerRpcCalls.filter(
  (call) => call.name === "set_my_prayer_request_state"
);
const closePrayerControl = makePrayerAction("close-prayer-request", "Close request");
const withdrawPrayerControl = makePrayerAction("withdraw-prayer-request", "Withdraw");
const memberPrayerCard = makeElement();
memberPrayerCard.querySelectorAll = () => [closePrayerControl, withdrawPrayerControl];
closePrayerControl.closest = (selector) => selector === ".prayer-request"
  ? memberPrayerCard
  : closePrayerControl;
withdrawPrayerControl.closest = (selector) => selector === ".prayer-request"
  ? memberPrayerCard
  : withdrawPrayerControl;
window.confirm = () => true;
globalThis.confirm = window.confirm;
const closePrayerGate = deferred();
prayerRpcGate = { name: "set_my_prayer_request_state", promise: closePrayerGate.promise };
const closePrayerCallCount = memberStateCalls().length;
const closePrayerCall = domListeners.get("click")({ target: closePrayerControl, preventDefault() {} });
await new Promise(setImmediate);
const siblingWithdrawCall = domListeners.get("click")({
  target: withdrawPrayerControl,
  preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(memberStateCalls().length, closePrayerCallCount + 1,
  "busy member Prayer requests must suppress sibling Close/Withdraw mutations");
assert.equal(closePrayerControl.disabled, true);
assert.equal(withdrawPrayerControl.disabled, true);
assert.equal(toastStack.children.length, 0,
  "Prayer close success must wait for the authoritative write");
assert.deepEqual(memberStateCalls().at(-1), {
  name: "set_my_prayer_request_state",
  args: { p_request_id: PRAYER_ID, p_action: "close" },
});
closePrayerGate.resolve({ data: [{
  ...structuredClone(prayerMemberRow),
  status: "closed",
  closed_at: "2026-08-05T02:05:00.000Z",
}], error: null });
await Promise.all([closePrayerCall, siblingWithdrawCall]);
prayerRpcGate = null;
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Prayer request closed",
]);
assert.equal(closePrayerControl.disabled, false);
assert.equal(withdrawPrayerControl.disabled, false);
assert.equal(closePrayerControl.hasAttribute("aria-busy"), false);

let prayerWithdrawConfirm = "";
window.confirm = (message) => { prayerWithdrawConfirm = message; return false; };
globalThis.confirm = window.confirm;
const prayerCallsBeforeCancelledWithdraw = prayerRpcCalls.length;
await domListeners.get("click")({ target: withdrawPrayerControl, preventDefault() {} });
assert.equal(
  prayerWithdrawConfirm,
  "Withdraw this request? Its text will be permanently removed.",
);
assert.equal(prayerRpcCalls.length, prayerCallsBeforeCancelledWithdraw,
  "cancelled Prayer withdrawal must not call the RPC");

window.confirm = () => true;
globalThis.confirm = window.confirm;
toastStack.children.length = 0;
await domListeners.get("click")({ target: withdrawPrayerControl, preventDefault() {} });
assert.deepEqual(prayerRpcCalls.at(-2), {
  name: "set_my_prayer_request_state",
  args: { p_request_id: PRAYER_ID, p_action: "withdraw" },
});
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Prayer request withdrawn",
]);

const rejectedCloseControl = makePrayerAction("close-prayer-request", "Close request");
toastStack.children.length = 0;
prayerRpcErrors.set("set_my_prayer_request_state", { message: "sensitive prayer update failure" });
await domListeners.get("click")({ target: rejectedCloseControl, preventDefault() {} });
prayerRpcErrors.delete("set_my_prayer_request_state");
assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]), [[
  "Prayer request could not be updated. Please try again.",
  "alert",
]]);
assert.equal(rejectedCloseControl.disabled, false);
assert.equal(rejectedCloseControl.hasAttribute("aria-busy"), false);

// Admin Prayer status controls must suppress repeated clicks, await the live
// mutation, and pass only the legal next status through the store seam.
Object.assign(authUser, {
  id: "live-user-1",
  email: "runner@example.com",
  user_metadata: { full_name: "Riley Runner", avatar_url: "https://example.com/avatar.jpg" },
});
Object.assign(profile, {
  id: authUser.id,
  email: authUser.email,
  full_name: "Riley Runner",
  role: "super_admin",
});
await store.getCurrentUser();
location.hash = "#/admin/prayers";
const adminStatusCalls = () => prayerRpcCalls.filter(
  (call) => call.name === "set_admin_prayer_request_status"
);

toastStack.children.length = 0;
const markPrayedControl = makePrayerAction("mark-prayer-prayed", "Mark as prayed for");
const siblingCloseControl = makePrayerAction("close-admin-prayer", "Close");
markPrayedControl.dataset.prayer = SECOND_PRAYER_ID;
siblingCloseControl.dataset.prayer = SECOND_PRAYER_ID;
const adminPrayerCard = makeElement();
adminPrayerCard.querySelectorAll = () => [markPrayedControl, siblingCloseControl];
markPrayedControl.closest = (selector) => selector === ".admin-prayer-request"
  ? adminPrayerCard
  : markPrayedControl;
siblingCloseControl.closest = (selector) => selector === ".admin-prayer-request"
  ? adminPrayerCard
  : siblingCloseControl;
const markPrayedGate = deferred();
prayerRpcGate = { name: "set_admin_prayer_request_status", promise: markPrayedGate.promise };
const markCallCount = adminStatusCalls().length;
const markPrayedCall = domListeners.get("click")({
  target: markPrayedControl,
  preventDefault() {},
});
await new Promise(setImmediate);
const siblingCloseCall = domListeners.get("click")({
  target: siblingCloseControl,
  preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(adminStatusCalls().length, markCallCount + 1,
  "busy Admin Prayer requests must suppress sibling status mutations");
assert.equal(markPrayedControl.disabled, true);
assert.equal(siblingCloseControl.disabled, true);
assert.equal(toastStack.children.length, 0,
  "Admin Prayer success must wait for the authoritative status mutation");
assert.deepEqual(adminStatusCalls().at(-1), {
  name: "set_admin_prayer_request_status",
  args: { p_request_id: SECOND_PRAYER_ID, p_status: "prayed_for" },
});
markPrayedGate.resolve({ data: [{
  ...structuredClone(prayerAdminRow),
  status: "prayed_for",
}], error: null });
await Promise.all([markPrayedCall, siblingCloseCall]);
prayerRpcGate = null;
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Prayer request marked as prayed for",
]);
assert.equal(markPrayedControl.disabled, false);
assert.equal(siblingCloseControl.disabled, false);
assert.equal(markPrayedControl.hasAttribute("aria-busy"), false);

toastStack.children.length = 0;
const closeAdminPrayerControl = makePrayerAction("close-admin-prayer", "Close");
closeAdminPrayerControl.dataset.prayer = SECOND_PRAYER_ID;
const closeAdminPrayerGate = deferred();
prayerRpcGate = { name: "set_admin_prayer_request_status", promise: closeAdminPrayerGate.promise };
const closeAdminCallCount = adminStatusCalls().length;
const closeAdminPrayerCall = domListeners.get("click")({
  target: closeAdminPrayerControl,
  preventDefault() {},
});
await new Promise(setImmediate);
const duplicateCloseAdminPrayerCall = domListeners.get("click")({
  target: closeAdminPrayerControl,
  preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(adminStatusCalls().length, closeAdminCallCount + 1,
  "busy close controls must suppress duplicate Admin Prayer mutations");
assert.deepEqual(adminStatusCalls().at(-1), {
  name: "set_admin_prayer_request_status",
  args: { p_request_id: SECOND_PRAYER_ID, p_status: "closed" },
});
assert.equal(toastStack.children.length, 0);
closeAdminPrayerGate.resolve({ data: [{
  ...structuredClone(prayerAdminRow),
  status: "closed",
  closed_at: "2026-08-05T02:10:00.000Z",
}], error: null });
await Promise.all([closeAdminPrayerCall, duplicateCloseAdminPrayerCall]);
prayerRpcGate = null;
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Prayer request closed",
]);

const rejectedAdminPrayerControl = makePrayerAction("close-admin-prayer", "Close");
rejectedAdminPrayerControl.dataset.prayer = SECOND_PRAYER_ID;
toastStack.children.length = 0;
prayerRpcErrors.set("set_admin_prayer_request_status", { message: "sensitive Admin status failure" });
await domListeners.get("click")({ target: rejectedAdminPrayerControl, preventDefault() {} });
prayerRpcErrors.delete("set_admin_prayer_request_status");
assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]), [[
  "Prayer request status could not be updated. Please try again.",
  "alert",
]]);
assert.equal(rejectedAdminPrayerControl.disabled, false);
assert.equal(rejectedAdminPrayerControl.hasAttribute("aria-busy"), false);
console.log("ok  delegated Prayer submit and Admin/member actions await writes and fail safely");

// Assigned payout rows for another collector are RLS-suppressed from an
// ordinary member's Realtime stream. Entering/restoring Payment must therefore
// force the narrow assigned-payout hydration, and stale completions must not
// replace a newer route.
Object.assign(authUser, {
  id: "approved-member",
  email: "micah.member@example.com",
  user_metadata: { full_name: "Micah Member", avatar_url: "" },
});
Object.assign(profile, {
  id: "approved-member", email: "micah.member@example.com",
  full_name: "Micah Member", avatar_url: "", role: "member",
});
await store.getCurrentUser();
const assignedCollectorPayout = operationalTableRows.collector_payout_profiles
  .find((row) => row.profile_id === "live-user-1");
Object.assign(assignedCollectorPayout, {
  payme_link: "https://payme.hsbc.com.hk/1/route-version-a",
  fps_phone: "+852 6111 0001",
});
await operations.refreshOperationalState();
Object.assign(assignedCollectorPayout, {
  payme_link: "https://payme.hsbc.com.hk/1/route-version-b",
  fps_phone: "+852 6111 0002",
});
const assignedCallsBeforePayRoute = operationalRpcCalls
  .filter((call) => call.name === "get_assigned_collector_payout_profiles").length;
location.hash = `#/pay/${memberPayBooking.id}`;
await windowListeners.get("hashchange")();
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "get_assigned_collector_payout_profiles").length,
  assignedCallsBeforePayRoute + 1,
  "entering an approved live Payment route must force assigned-payout hydration"
);
assert.match(viewEl.innerHTML, /route-version-b/);
assert.doesNotMatch(viewEl.innerHTML, /route-version-a/);
assert.doesNotMatch(
  operationalPayoutDirectReads.at(-1)?.profileIds.join(",") || "",
  /live-user-1|unassigned-super/,
  "Payment refresh must not bypass foreign payout-table RLS"
);
assert.equal(operations.livePayoutFor("unassigned-super"), null,
  "Payment refresh must not retain an unassigned payout row");
assert.equal(JSON.parse(mem.get("itc.prototype.v1")).users.length, 0,
  "Payment refresh must not persist collector identity rows locally");

Object.assign(assignedCollectorPayout, {
  payme_link: "https://payme.hsbc.com.hk/1/route-version-c",
  fps_phone: "+852 6111 0003",
});
documentVisibilityState = "visible";
await domListeners.get("visibilitychange")();
assert.match(viewEl.innerHTML, /route-version-c/,
  "restoring a visible Payment route must reconcile a suppressed payout update");
assert.doesNotMatch(viewEl.innerHTML, /route-version-b/);

Object.assign(assignedCollectorPayout, {
  payme_link: "https://payme.hsbc.com.hk/1/route-version-d",
  fps_phone: "+852 6111 0004",
});
const payoutRouteGate = deferred();
const payoutRouteBaseHandler = operationalRpcHandler;
operationalRpcHandler = (name, args) => {
  if (name === "get_assigned_collector_payout_profiles") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return payoutRouteGate.promise;
  }
  return payoutRouteBaseHandler(name, args);
};
location.hash = `#/pay/${memberPayBooking.id}`;
const stalePayoutRoute = windowListeners.get("hashchange")();
await new Promise(setImmediate);
location.hash = "#/home";
await windowListeners.get("hashchange")();
const homeAfterStalePayoutRoute = viewEl.innerHTML;
assert.match(homeAfterStalePayoutRoute, /Good to see you, Micah\./);
payoutRouteGate.resolve({ data: [structuredClone(assignedCollectorPayout)], error: null });
await stalePayoutRoute;
assert.equal(viewEl.innerHTML, homeAfterStalePayoutRoute,
  "a delayed Payment hydration must not overwrite a newer route generation");
operationalRpcHandler = payoutRouteBaseHandler;
Object.assign(authUser, {
  id: "live-user-1", email: "runner@example.com",
  user_metadata: { full_name: "Riley Runner", avatar_url: "https://example.com/avatar.jpg" },
});
Object.assign(profile, {
  id: "live-user-1", email: "runner@example.com", full_name: "Riley Runner",
  avatar_url: "https://example.com/avatar.jpg", role: "super_admin",
});
await store.getCurrentUser();
await store.listPaymentUsers();
await operations.refreshOperationalState();
console.log("ok  Payment route and visibility refresh RLS-suppressed assigned payouts safely");

// Reserve and mark-paid form delegation must remain pending with the live RPC,
// capture values before controls are disabled, suppress duplicates, and expose
// success/navigation only after authoritative settlement.
const routingSessions = store.upcomingSessions(28).filter((session) =>
  session.kind === "paid" && !session.cancelled
  && !store.userReservationFor(authUser.id, session.id)
  && !store.userBookingFor(authUser.id, session.id)
);
if (routingSessions.length < 2) throw new Error("Payment routing regression needs two sessions");
const delegatedBaseOperationalRpcHandler = operationalRpcHandler;
const operationControl = (tagName, name = "", textContent = "") => {
  const control = makeElement();
  control.tagName = tagName;
  control.name = name;
  control.textContent = textContent;
  control.disabled = false;
  return control;
};
const equipOperationForm = (form, fields = {}) => {
  const inputs = Object.keys(fields).map((name) => operationControl("INPUT", name));
  const submit = operationControl("BUTTON", "", "Submit");
  submit.type = "submit";
  form.fields = { ...fields };
  form.nativeControls = [...inputs, submit];
  form.querySelector = (selector) => selector === '[type="submit"]' ? submit : null;
  form.querySelectorAll = (selector) => selector === "input, button" ? [...inputs, submit] : [];
  return { inputs, submit, controls: [...inputs, submit] };
};
const operationalBookingRow = (id, session, overrides = {}) => ({
  id,
  profile_id: authUser.id,
  session_id: session.id,
  status: "reserved",
  reserved_at: fixedIso,
  pay_deadline_at: fixedIso,
  payment_marked_at: null,
  payment_method: null,
  payment_reference: null,
  paid_at: null,
  confirmed_by: null,
  deferred_from_booking_id: null,
  deferred_to_booking_id: null,
  snapshot: {
    name: session.name,
    session_date: session.dateISO,
    start_time: `${session.time}:00`,
    venue: session.location,
    price_hkd: session.price,
  },
  created_at: fixedIso,
  updated_at: fixedIso,
  ...overrides,
});

const reserveForm = new HTMLFormElement();
reserveForm.id = "form-reserve";
reserveForm.dataset = { session: routingSessions[0].id };
const reserveControls = equipOperationForm(reserveForm);
const reserveGate = deferred();
let reserveRpcArgs = null;
operationalRpcHandler = (name, args) => {
  if (name === "reserve_operational_session") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    reserveRpcArgs = structuredClone(args);
    return reserveGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = `#/checkout/${routingSessions[0].id}`;
toastStack.children.length = 0;
const reserveRpcCallCountBefore = operationalRpcCalls.filter((call) =>
  call.name === "reserve_operational_session"
    && call.args.p_session_id === routingSessions[0].id).length;
let reserveSettled = false;
const reserveSubmit = domListeners.get("submit")({ target: reserveForm, preventDefault() {} })
  .then(() => { reserveSettled = true; });
const duplicateReserveSubmit = domListeners.get("submit")({ target: reserveForm, preventDefault() {} });
await new Promise(setImmediate);
assert.deepEqual(reserveRpcArgs, { p_session_id: routingSessions[0].id });
assert.equal(reserveSettled, false, "reserve form must remain pending with the live RPC");
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "reserve_operational_session"
    && call.args.p_session_id === routingSessions[0].id).length - reserveRpcCallCountBefore,
  1,
  "duplicate reserve submit must issue one RPC"
);
assert.equal(location.hash, `#/checkout/${routingSessions[0].id}`);
assert.equal(toastStack.children.length, 0, "reserve success must wait for settlement");
assert.equal(reserveControls.submit.disabled, true);
assert.equal(reserveControls.submit.getAttribute("aria-busy"), "true");
const routedDeferServerRow = operationalBookingRow("booking-form-reserve", routingSessions[0]);
operationalTableRows.operational_bookings.push(routedDeferServerRow);
reserveGate.resolve({ data: structuredClone(routedDeferServerRow), error: null });
await Promise.all([reserveSubmit, duplicateReserveSubmit]);
const routedDeferBooking = store.getBooking(routedDeferServerRow.id);
assert.ok(routedDeferBooking);
assert.equal(location.hash, `#/pay/${routedDeferBooking.id}`);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Spot reserved — pay before the deadline",
]);
assert.equal(reserveControls.submit.disabled, false);
assert.equal(reserveControls.submit.hasAttribute("aria-busy"), false);

const rejectedReserveForm = new HTMLFormElement();
rejectedReserveForm.id = "form-reserve";
rejectedReserveForm.dataset = { session: routingSessions[1].id };
const rejectedReserveControls = equipOperationForm(rejectedReserveForm);
const rejectedReserveGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "reserve_operational_session") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return rejectedReserveGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = `#/checkout/${routingSessions[1].id}`;
toastStack.children.length = 0;
const rejectedReserveSubmit = domListeners.get("submit")({
  target: rejectedReserveForm, preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(rejectedReserveControls.submit.disabled, true);
rejectedReserveGate.resolve({ data: null, error: { message: "Reservation service unavailable" } });
await rejectedReserveSubmit;
assert.equal(location.hash, `#/checkout/${routingSessions[1].id}`);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Reservation service unavailable",
]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
assert.equal(rejectedReserveControls.submit.disabled, false);
assert.equal(rejectedReserveControls.submit.hasAttribute("aria-busy"), false);

const markPaidForm = new HTMLFormElement();
markPaidForm.id = "form-mark-paid";
markPaidForm.dataset = { booking: routedDeferBooking.id };
const markPaidControls = equipOperationForm(markPaidForm, { method: "FPS", ref: "FORM-PAID-REF" });
const markPaidGate = deferred();
let markPaidRpcArgs = null;
operationalRpcHandler = (name, args) => {
  if (name === "mark_operational_payment") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    markPaidRpcArgs = structuredClone(args);
    return markPaidGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = `#/pay/${routedDeferBooking.id}`;
toastStack.children.length = 0;
let markPaidSettled = false;
const markPaidSubmit = domListeners.get("submit")({ target: markPaidForm, preventDefault() {} })
  .then(() => { markPaidSettled = true; });
const duplicateMarkPaidSubmit = domListeners.get("submit")({ target: markPaidForm, preventDefault() {} });
await new Promise(setImmediate);
assert.deepEqual(markPaidRpcArgs, {
  p_booking_id: routedDeferBooking.id,
  p_method: "fps",
  p_reference: "FORM-PAID-REF",
}, "mark-paid must capture FormData before disabling its fields");
assert.equal(markPaidSettled, false, "mark-paid form must remain pending with the live RPC");
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "mark_operational_payment"
    && call.args.p_booking_id === routedDeferBooking.id).length,
  1,
  "duplicate mark-paid submit must issue one RPC"
);
assert.equal(location.hash, `#/pay/${routedDeferBooking.id}`);
assert.equal(toastStack.children.length, 0, "mark-paid success must wait for settlement");
for (const control of markPaidControls.controls) assert.equal(control.disabled, true);
assert.equal(markPaidControls.submit.getAttribute("aria-busy"), "true");
Object.assign(routedDeferServerRow, {
  payment_marked_at: fixedIso,
  payment_method: "fps",
  payment_reference: "FORM-PAID-REF",
});
markPaidGate.resolve({ data: structuredClone(routedDeferServerRow), error: null });
await Promise.all([markPaidSubmit, duplicateMarkPaidSubmit]);
assert.equal(location.hash, `#/booking/${routedDeferBooking.id}`);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Payment marked — awaiting collector confirmation",
]);
for (const control of markPaidControls.controls) assert.equal(control.disabled, false);
assert.equal(markPaidControls.submit.hasAttribute("aria-busy"), false);

operationalRpcHandler = delegatedBaseOperationalRpcHandler;
const routedReleaseBooking = await store.reserveSession(authUser.id, routingSessions[1], Date.now());
const rejectedMarkPaidForm = new HTMLFormElement();
rejectedMarkPaidForm.id = "form-mark-paid";
rejectedMarkPaidForm.dataset = { booking: routedReleaseBooking.id };
const rejectedMarkPaidControls = equipOperationForm(rejectedMarkPaidForm, {
  method: "PayMe", ref: "REJECTED-REF",
});
const rejectedMarkPaidGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "mark_operational_payment") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return rejectedMarkPaidGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = `#/pay/${routedReleaseBooking.id}`;
toastStack.children.length = 0;
const rejectedMarkPaidSubmit = domListeners.get("submit")({
  target: rejectedMarkPaidForm, preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(rejectedMarkPaidControls.submit.disabled, true);
rejectedMarkPaidGate.reject(new Error("Payment transport unavailable"));
await rejectedMarkPaidSubmit;
await new Promise(setImmediate);
assert.equal(location.hash, `#/pay/${routedReleaseBooking.id}`);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Payment transport unavailable",
]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
assert.equal(rejectedMarkPaidControls.submit.disabled, false);
assert.equal(rejectedMarkPaidControls.submit.hasAttribute("aria-busy"), false);
assert.equal(escapedRejections.length, 0, "mark-paid rejection must not escape its delegated handler");
console.log("ok  live reserve and mark-paid forms await, guard duplicates, and catch failures");

// Adjacent operations all return Promises in live mode. Each delegated seam
// must remain busy and duplicate-safe until its exact RPC settles.
const delayedClickMutation = async ({
  action, dataset, rpcName, expectedArgs, result = null, beforeResolve = () => {}, successToast,
  controlLabel = "Action", pendingLabel = null, expectedRoute = null,
}) => {
  const gate = deferred();
  operationalRpcHandler = (name, args) => {
    if (name === rpcName) {
      operationalRpcCalls.push({ name, args: structuredClone(args) });
      return gate.promise;
    }
    return delegatedBaseOperationalRpcHandler(name, args);
  };
  const control = operationControl("BUTTON", "", controlLabel);
  control.dataset = { action, ...dataset };
  control.closest = () => control;
  toastStack.children.length = 0;
  const callsBefore = operationalRpcCalls.filter((call) => call.name === rpcName).length;
  let settled = false;
  const first = click({ target: control, preventDefault() {} }).then(() => { settled = true; });
  const duplicate = click({ target: control, preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(settled, false, `${action} must wait for ${rpcName}`);
  assert.equal(operationalRpcCalls.filter((call) => call.name === rpcName).length,
    callsBefore + 1, `${action} duplicate must issue one ${rpcName} RPC`);
  assert.deepEqual(operationalRpcCalls.filter((call) => call.name === rpcName).at(-1)?.args,
    expectedArgs, `${action} must send the normalized RPC payload`);
  assert.equal(control.disabled, true, `${action} must disable its control while pending`);
  assert.equal(control.getAttribute("aria-busy"), "true");
  if (pendingLabel) assert.equal(control.textContent, pendingLabel);
  if (expectedRoute) assert.equal(location.hash, expectedRoute,
    `${action} must preserve the current route while pending`);
  assert.equal(toastStack.children.length, 0, `${action} success must wait for settlement`);
  beforeResolve();
  gate.resolve({ data: structuredClone(result), error: null });
  await Promise.all([first, duplicate]);
  assert.equal(control.disabled, false);
  assert.equal(control.hasAttribute("aria-busy"), false);
  if (expectedRoute) assert.equal(location.hash, expectedRoute,
    `${action} must preserve the current route after success`);
  assert.ok(toastStack.children.some((item) => item.textContent === successToast),
    `${action} must report success after settlement`);
};

const attendanceActionSessionRow = {
  id: "attendance-action-session",
  activity_id: "hyrox-quarry-bay",
  session_date: "2026-08-05",
  start_time: "10:10:00",
  duration_minutes: 60,
  venue: "10/F, Island ECC, Quarry Bay",
  capacity: 30,
  price_hkd: 180,
  is_open: true,
  venue_tbc: false,
  notice: null,
  cancelled_at: null,
  cancelled_by: null,
  cancelled_source: null,
  cancel_reason: null,
  gym_confirmed_at: null,
  gym_confirmed_by: null,
  gym_note: null,
  created_at: fixedIso,
  updated_at: fixedIso,
};
const attendanceActionBookingRow = {
  id: "attendance-action-booking",
  profile_id: "approved-member",
  session_id: attendanceActionSessionRow.id,
  status: "confirmed",
  reserved_at: fixedIso,
  pay_deadline_at: fixedIso,
  payment_marked_at: fixedIso,
  payment_method: "payme",
  payment_reference: "ATTEND-ACTION",
  paid_at: fixedIso,
  confirmed_by: authUser.id,
  attended_at: null,
  attended_by: null,
  deferred_from_booking_id: null,
  deferred_to_booking_id: null,
  snapshot: {
    name: "ITC HYROX", session_date: "2026-08-05", start_time: "10:10:00",
    venue: "10/F, Island ECC, Quarry Bay", price_hkd: 180,
  },
  created_at: fixedIso,
  updated_at: fixedIso,
};
operationalTableRows.operational_sessions.push(attendanceActionSessionRow);
operationalTableRows.operational_bookings.push(attendanceActionBookingRow);
await operations.refreshOperationalState();
location.hash = "#/admin/payments";
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML,
  /data-action="attendance-toggle"[^>]*data-booking="attendance-action-booking"[^>]*data-arrived="1"/);

await delayedClickMutation({
  action: "attendance-toggle",
  dataset: { booking: attendanceActionBookingRow.id, arrived: "1" },
  rpcName: "set_operational_attendance",
  expectedArgs: { p_booking_id: attendanceActionBookingRow.id, p_arrived: true },
  result: attendanceActionBookingRow,
  beforeResolve: () => Object.assign(attendanceActionBookingRow, {
    status: "attended", attended_at: fixedIso, attended_by: authUser.id,
  }),
  successToast: "Marked Arrived",
});
assert.equal(location.hash, "#/admin/payments");
assert.equal(store.getBooking(attendanceActionBookingRow.id)?.status, "attended");
assert.equal(store.activeBookingsForSession(attendanceActionSessionRow.id).some((booking) => booking.id === attendanceActionBookingRow.id), true,
  "live Arrived bookings must remain active attendees");
assert.equal(store.heldBookingsForSession(attendanceActionSessionRow.id).some((booking) => booking.id === attendanceActionBookingRow.id), true,
  "live Arrived bookings must remain held for capacity");
assert.equal(store.userBookingFor("approved-member", attendanceActionSessionRow.id)?.id, attendanceActionBookingRow.id,
  "live Arrived bookings must remain discoverable as the member's paid booking");
assert.match(viewEl.innerHTML,
  /data-action="attendance-toggle"[^>]*data-booking="attendance-action-booking"[^>]*data-arrived="0"/);

await delayedClickMutation({
  action: "attendance-toggle",
  dataset: { booking: attendanceActionBookingRow.id, arrived: "0" },
  rpcName: "set_operational_attendance",
  expectedArgs: { p_booking_id: attendanceActionBookingRow.id, p_arrived: false },
  result: attendanceActionBookingRow,
  beforeResolve: () => Object.assign(attendanceActionBookingRow, {
    status: "confirmed", attended_at: null, attended_by: null,
  }),
  successToast: "Attendance reset to Expected",
});
assert.equal(location.hash, "#/admin/payments");
assert.equal(store.getBooking(attendanceActionBookingRow.id)?.status, "confirmed");

operationalRpcHandler = (name, args) => {
  if (name === "set_operational_attendance") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return Promise.resolve({ data: null, error: { message: "Attendance is outside the check-in window." } });
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
const rejectedAttendanceControl = operationControl("BUTTON", "", "Mark Arrived");
rejectedAttendanceControl.dataset = {
  action: "attendance-toggle", booking: attendanceActionBookingRow.id, arrived: "1",
};
rejectedAttendanceControl.closest = () => rejectedAttendanceControl;
Object.assign(attendanceActionBookingRow, {
  status: "attended", attended_at: fixedIso, attended_by: authUser.id,
});
toastStack.children.length = 0;
await click({ target: rejectedAttendanceControl, preventDefault() {} });
assert.equal(location.hash, "#/admin/payments");
assert.equal(store.getBooking(attendanceActionBookingRow.id)?.status, "attended",
  "failed attendance mutations must refresh a concurrent authoritative server row");
assert.match(viewEl.innerHTML,
  /data-action="attendance-toggle"[^>]*data-booking="attendance-action-booking"[^>]*data-arrived="0"/);
assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]), [
  ["Attendance is outside the check-in window.", "alert"],
]);
operationalRpcHandler = delegatedBaseOperationalRpcHandler;
console.log("ok  delegated attendance controls await, dedupe, rerender, undo, and recover errors");

const waitlistRow = {
  id: "queue-waitlist-async", session_id: routingSessions[1].id, profile_id: authUser.id,
  kind: "waitlist", status: "active", joined_at: fixedIso, resolved_at: null,
};
await delayedClickMutation({
  action: "join-waitlist",
  dataset: { session: routingSessions[1].id },
  rpcName: "join_operational_queue",
  expectedArgs: { p_session_id: routingSessions[1].id, p_kind: "waitlist" },
  result: waitlistRow,
  beforeResolve: () => operationalTableRows.operational_queue_entries.push(waitlistRow),
  successToast: "You're #1 on the waitlist",
});
await delayedClickMutation({
  action: "leave-waitlist",
  dataset: { session: routingSessions[1].id },
  rpcName: "leave_operational_queue",
  expectedArgs: { p_entry_id: waitlistRow.id },
  result: { ...waitlistRow, status: "left", resolved_at: fixedIso },
  beforeResolve: () => Object.assign(waitlistRow, { status: "left", resolved_at: fixedIso }),
  successToast: "Left the waitlist",
});
const dutyWeek = routingSessions[0].dateISO;
const dutyRow = {
  week_start: dutyWeek, collector_profile_id: authUser.id,
  assigned_by: authUser.id, assigned_at: fixedIso,
};
await delayedClickMutation({
  action: "duty-claim",
  dataset: { week: dutyWeek },
  rpcName: "set_collector_assignment",
  expectedArgs: { p_week_start: dutyWeek, p_profile_id: authUser.id },
  result: dutyRow,
  beforeResolve: () => {
    const index = operationalTableRows.collector_assignments
      .findIndex((row) => row.week_start === dutyWeek);
    if (index >= 0) operationalTableRows.collector_assignments[index] = dutyRow;
    else operationalTableRows.collector_assignments.push(dutyRow);
  },
  successToast: "You're on duty this week",
});
const confirmedServerRow = { ...routedDeferServerRow, status: "confirmed", paid_at: fixedIso, confirmed_by: authUser.id };
await delayedClickMutation({
  action: "confirm-payment",
  dataset: { booking: routedDeferBooking.id },
  rpcName: "approve_operational_payment",
  expectedArgs: { p_booking_id: routedDeferBooking.id },
  result: confirmedServerRow,
  beforeResolve: () => Object.assign(routedDeferServerRow, confirmedServerRow),
  successToast: "Payment confirmed — member notified",
});
// A successful create remains actionable and non-duplicable while its
// post-RPC relationship enrichment is reconciling.
const reconcilingReplacementRow = {
  requestId: "reconciling-create-request",
  bookingId: routedDeferBooking.id,
  status: "pending",
  originalDisplayName: "Riley Runner",
  replacementDisplayName: null,
  sessionId: "post-success-ecc-replacement-session",
  snapshot: {
    name: "ITC HYROX",
    kind: "paid",
    dateISO: routingSessions[0].dateISO,
    time: routingSessions[0].time,
  },
  createdAt: fixedIso,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};
const previousSameBookingReplacement = {
  ...reconcilingReplacementRow,
  requestId: "previous-same-booking-request",
  sessionId: routedDeferBooking.sessionId,
  status: "rejected",
  createdAt: "2025-01-01T00:00:00.000Z",
};
operationalRpcHandler = (name, args) => name === "list_operational_replacement_requests"
  ? Promise.resolve({ data: [structuredClone(previousSameBookingReplacement)], error: null })
  : delegatedBaseOperationalRpcHandler(name, args);
await operations.liveListReplacementRequests();
operationalSessionRelationshipReadErrors.set(
  reconcilingReplacementRow.sessionId,
  { message: "post-create relationship temporarily unavailable" },
);
let reconcilingCreateCalls = 0;
let reconciliationListCalls = 0;
let reconciliationListFails = true;
const recoveryActor = store.currentUser();
const recoveryRole = recoveryActor.role;
recoveryActor.role = "member";
assert.equal(recoveryActor.id, routedDeferBooking.userId, "recovery is by the ordinary booking owner");
let recoveryTokenHash;
let forbiddenMemberListCalls = 0;
operationalRpcHandler = (name, args) => {
  if (name === "list_operational_replacement_requests") {
    forbiddenMemberListCalls += 1;
    return Promise.resolve({ data: null, error: { code: "42501", message: "Admin access required." } });
  }
  if (name === "get_operational_replacement_invite") {
    assert.equal(args.p_token_hash, recoveryTokenHash, "member read requires the private invite hash");
    reconciliationListCalls += 1;
    return Promise.resolve(reconciliationListFails
      ? { data: null, error: { message: "Replacement invite temporarily unavailable" } }
      : { data: structuredClone(reconcilingReplacementRow), error: null });
  }
  if (name === "create_operational_replacement_request") {
    recoveryTokenHash = args.p_token_hash;
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    reconcilingCreateCalls += 1;
    return Promise.resolve({ data: structuredClone(reconcilingReplacementRow), error: null });
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = `#/booking/${routedDeferBooking.id}`;
toastStack.children.length = 0;
const replacementCreateControl = operationControl("BUTTON", "", "Create private invite");
replacementCreateControl.dataset = {
  action: "replacement-create",
  booking: routedDeferBooking.id,
};
replacementCreateControl.closest = () => replacementCreateControl;
const reconcilingCreate = click({ target: replacementCreateControl });
const duplicateReconcilingCreate = click({ target: replacementCreateControl });
await Promise.all([reconcilingCreate, duplicateReconcilingCreate]);
assert.equal(reconcilingCreateCalls, 1,
  "created-but-reconciling replacement state must suppress duplicate creation");
assert.equal(forbiddenMemberListCalls, 0, "member recovery must never call the Admin-only list RPC");
assert.equal(reconciliationListCalls, 1,
  "cache-pending create must attempt exactly one token-authorized reconciliation");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Private replacement invite created — details unavailable; retry refresh",
]);
assert.equal(
  operations.liveReplacementRequestForBooking(routedDeferBooking.id)?.requestId,
  previousSameBookingReplacement.requestId,
  "unresolved create must retain older same-booking cache history",
);
const reconcilingReplacement = store.replacementRequestForBooking(routedDeferBooking.id);
assert.equal(reconcilingReplacement.status, "pending");
assert.equal(reconcilingReplacement.cachePending, true);
assert.ok(store.replacementInviteTokenForBooking(routedDeferBooking.id),
  "created-but-reconciling state must retain its private token in memory");
assert.match(viewEl.innerHTML, /Invite created — details unavailable/);
assert.match(viewEl.innerHTML, /data-action="replacement-refresh"/);
assert.doesNotMatch(viewEl.innerHTML, /Share via WhatsApp|details are refreshing/);
assert.doesNotMatch(viewEl.innerHTML, /Create private invite/,
  "created-but-unavailable view must not invite a duplicate create");
const pendingInviteToken = store.replacementInviteTokenForBooking(routedDeferBooking.id);
await assert.rejects(store.createReplacementRequest(routedDeferBooking.id), /already active/);
assert.equal(reconcilingCreateCalls, 1, "pending Store guard must reject a stale create control");
const replacementRefreshControl = operationControl("BUTTON", "", "Retry refresh");
replacementRefreshControl.dataset = {
  action: "replacement-refresh", booking: routedDeferBooking.id,
};
replacementRefreshControl.closest = () => replacementRefreshControl;
await Promise.all([
  click({ target: replacementRefreshControl }),
  click({ target: replacementRefreshControl }),
]);
assert.equal(reconciliationListCalls, 2, "each retry must make only one token-authorized invite call");
assert.equal(store.replacementRequestForBooking(routedDeferBooking.id).cachePending, true);
assert.match(viewEl.innerHTML, /Invite created — details unavailable/);
assert.match(viewEl.innerHTML, /Retry refresh/);
assert.equal(reconcilingCreateCalls, 1, "failed retry must never create another invite");
reconciliationListFails = false;
operationalSessionRelationshipReadErrors.set(reconcilingReplacementRow.sessionId,
  { message: "Invite enrichment temporarily unavailable" });
await click({ target: replacementRefreshControl });
assert.equal(reconciliationListCalls, 3);
assert.equal(store.replacementRequestForBooking(routedDeferBooking.id).cachePending, true,
  "invite enrichment failure must also retain duplicate suppression and explicit retry");
assert.match(viewEl.innerHTML, /Invite created — details unavailable/);
operationalSessionRelationshipReadErrors.delete(reconcilingReplacementRow.sessionId);
await click({ target: replacementRefreshControl });
assert.equal(reconciliationListCalls, 4);
const authoritativeReplacement = store.replacementRequestForBooking(routedDeferBooking.id);
assert.equal(authoritativeReplacement.requestId, reconcilingReplacementRow.requestId);
assert.equal(authoritativeReplacement.cachePending, undefined, "successful member invite lookup clears pending overlay");
assert.equal(authoritativeReplacement.sessionId, reconcilingReplacementRow.sessionId);
assert.match(viewEl.innerHTML, /Share via WhatsApp/);
assert.match(viewEl.innerHTML, /Share this single-use invite before/);
assert.doesNotMatch(viewEl.innerHTML, /details unavailable|replacement-refresh|Create private invite/);
assert.equal(store.replacementInviteTokenForBooking(routedDeferBooking.id), pendingInviteToken);
assert.equal(reconcilingCreateCalls, 1, "successful retry is read-only too");
assert.ok([...mem.values()].every((value) => !value.includes(pendingInviteToken)),
  "reconciliation must never persist the private invite token");
// Removing the authoritative row must not resurrect a supposedly cleared overlay.
recoveryActor.role = recoveryRole;
operationalRpcHandler = (name, args) => name === "list_operational_replacement_requests"
  ? Promise.resolve({ data: [], error: null })
  : delegatedBaseOperationalRpcHandler(name, args);
await operations.liveListReplacementRequests();
assert.equal(store.replacementRequestForBooking(routedDeferBooking.id), null);
// Also recover within create's single automatic invite lookup, without a retry click.
operationalSessionRelationshipReadErrors.set(reconcilingReplacementRow.sessionId,
  { message: "Initial create enrichment failed again" });
let automaticReconciliationCalls = 0;
recoveryActor.role = "member";
operationalRpcHandler = (name, args) => {
  if (name === "create_operational_replacement_request") {
    recoveryTokenHash = args.p_token_hash;
    return Promise.resolve({ data: structuredClone(reconcilingReplacementRow), error: null });
  }
  if (name === "list_operational_replacement_requests") {
    throw new Error("Admin access required.");
  }
  if (name === "get_operational_replacement_invite") {
    assert.equal(args.p_token_hash, recoveryTokenHash);
    automaticReconciliationCalls += 1;
    operationalSessionRelationshipReadErrors.delete(reconcilingReplacementRow.sessionId);
    return Promise.resolve({ data: structuredClone(reconcilingReplacementRow), error: null });
  }
  if (name === "cancel_operational_replacement_request") {
    assert.equal(recoveryActor.role, "member");
    assert.equal(args.p_request_id, reconcilingReplacementRow.requestId);
    return Promise.resolve({ data: { ...reconcilingReplacementRow, status: "cancelled" }, error: null });
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
await click({ target: replacementCreateControl });
assert.equal(automaticReconciliationCalls, 1);
assert.equal(store.replacementRequestForBooking(routedDeferBooking.id).cachePending, undefined);
assert.match(viewEl.innerHTML, /Share this single-use invite before/);
assert.match(viewEl.innerHTML, /Share via WhatsApp/);
assert.doesNotMatch(viewEl.innerHTML, /replacement-refresh|Create private invite/);
assert.ok([...mem.values()].every((value) =>
  !value.includes(store.replacementInviteTokenForBooking(routedDeferBooking.id))));
assert.match(viewEl.innerHTML, /replacement-cancel/, "recovered invite exposes cancellation");
await store.cancelReplacement(reconcilingReplacementRow.requestId);
assert.equal(store.replacementRequestForBooking(routedDeferBooking.id).status, "cancelled");
operationalRpcHandler = delegatedBaseOperationalRpcHandler;

recoveryActor.role = recoveryRole;
const paidControlServerRow = operationalTableRows.operational_sessions
  .find((row) => row.id === routingSessions[0].id);
const reopenControlServerRow = operationalTableRows.operational_sessions
  .find((row) => row.id === authoritativeFreeSessionIds[0]);
Object.assign(reopenControlServerRow, {
  cancelled_at: fixedIso, cancelled_by: authUser.id,
  cancelled_source: "admin", cancel_reason: "Weather warning",
});
await operations.refreshOperationalState();
window.confirm = () => true;
globalThis.confirm = window.confirm;
location.hash = "#/admin/activities";
await delayedClickMutation({
  action: "repost-rsvp",
  dataset: { session: reopenControlServerRow.id },
  rpcName: "reopen_operational_rsvp",
  expectedArgs: { p_session_id: reopenControlServerRow.id },
  result: {
    ...reopenControlServerRow, cancelled_at: null, cancelled_by: null,
    cancelled_source: null, cancel_reason: null,
  },
  beforeResolve: () => Object.assign(reopenControlServerRow, {
    cancelled_at: null, cancelled_by: null, cancelled_source: null, cancel_reason: null,
  }),
  successToast: "Event reopened",
  controlLabel: "Reopen event",
  pendingLabel: "Reopening…",
  expectedRoute: "#/admin/activities",
});
await delayedClickMutation({
  action: "venue-tbc-toggle",
  dataset: { session: routingSessions[0].id, on: "1" },
  rpcName: "set_operational_venue_tbc",
  expectedArgs: { p_session_id: routingSessions[0].id, p_enabled: true },
  result: { ...paidControlServerRow, venue_tbc: true },
  beforeResolve: () => { paidControlServerRow.venue_tbc = true; },
  successToast: "Venue marked TBC",
});

const dutySetGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "set_collector_assignment") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return dutySetGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
const dutySetControl = operationControl("SELECT");
dutySetControl.value = "approved-admin";
dutySetControl.dataset = { change: "duty-set", week: dutyWeek };
dutySetControl.closest = () => dutySetControl;
toastStack.children.length = 0;
const dutySetChange = change({ target: dutySetControl });
const duplicateDutySetChange = change({ target: dutySetControl });
await new Promise(setImmediate);
assert.equal(dutySetControl.disabled, true);
assert.equal(dutySetControl.getAttribute("aria-busy"), "true");
assert.equal(operationalRpcCalls.filter((call) => call.name === "set_collector_assignment"
  && call.args.p_profile_id === "approved-admin").length, 1);
assert.equal(toastStack.children.length, 0);
const handedDutyRow = { ...dutyRow, collector_profile_id: "approved-admin" };
const dutyIndex = operationalTableRows.collector_assignments.findIndex((row) => row.week_start === dutyWeek);
operationalTableRows.collector_assignments[dutyIndex] = handedDutyRow;
dutySetGate.resolve({ data: handedDutyRow, error: null });
await Promise.all([dutySetChange, duplicateDutySetChange]);
assert.equal(dutySetControl.disabled, false);
assert.equal(dutySetControl.hasAttribute("aria-busy"), false);
assert.ok(toastStack.children.some((item) => item.textContent === "Duty handed over"));

const delayedFormMutation = async ({
  formAction, session, fields, rpcName, expectedArgs, result, beforeResolve, successToast,
}) => {
  const form = new HTMLFormElement();
  form.id = formAction;
  form.dataset = { session };
  form.reportValidity = () => true;
  const equipped = equipOperationForm(form, fields);
  const gate = deferred();
  operationalRpcHandler = (name, args) => {
    if (name === rpcName) {
      operationalRpcCalls.push({ name, args: structuredClone(args) });
      return gate.promise;
    }
    return delegatedBaseOperationalRpcHandler(name, args);
  };
  toastStack.children.length = 0;
  const callsBefore = operationalRpcCalls.filter((call) => call.name === rpcName).length;
  let settled = false;
  const first = domListeners.get("submit")({ target: form, preventDefault() {} })
    .then(() => { settled = true; });
  const duplicate = domListeners.get("submit")({ target: form, preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(settled, false, `${formAction} must wait for ${rpcName}`);
  assert.equal(operationalRpcCalls.filter((call) => call.name === rpcName).length, callsBefore + 1);
  assert.deepEqual(operationalRpcCalls.filter((call) => call.name === rpcName).at(-1)?.args,
    expectedArgs, `${formAction} must capture its form values before disabling`);
  for (const control of equipped.controls) assert.equal(control.disabled, true);
  assert.equal(equipped.submit.getAttribute("aria-busy"), "true");
  assert.equal(toastStack.children.length, 0);
  beforeResolve();
  gate.resolve({ data: structuredClone(result), error: null });
  await Promise.all([first, duplicate]);
  for (const control of equipped.controls) assert.equal(control.disabled, false);
  assert.equal(equipped.submit.hasAttribute("aria-busy"), false);
  assert.ok(toastStack.children.some((item) => item.textContent === successToast));
};
window.confirm = () => true;
globalThis.confirm = window.confirm;
await delayedFormMutation({
  formAction: "form-session-time",
  session: routingSessions[0].id,
  fields: { time: "12:30" },
  rpcName: "set_operational_session_time",
  expectedArgs: { p_session_id: routingSessions[0].id, p_time: "12:30" },
  result: { ...paidControlServerRow, start_time: "12:30:00" },
  beforeResolve: () => { paidControlServerRow.start_time = "12:30:00"; },
  successToast: "Session time updated",
});
await delayedFormMutation({
  formAction: "form-session-notice",
  session: routingSessions[0].id,
  fields: { notice: "Bring a towel" },
  rpcName: "set_operational_notice",
  expectedArgs: { p_session_id: routingSessions[0].id, p_notice: "Bring a towel" },
  result: { ...paidControlServerRow, notice: "Bring a towel" },
  beforeResolve: () => { paidControlServerRow.notice = "Bring a towel"; },
  successToast: "Session note posted",
});
await delayedFormMutation({
  formAction: "form-cancel-week",
  session: routingSessions[1].id,
  fields: { reason: "Storm warning" },
  rpcName: "cancel_operational_session",
  expectedArgs: { p_session_id: routingSessions[1].id, p_reason: "Storm warning" },
  result: {
    ...operationalTableRows.operational_sessions.find((row) => row.id === routingSessions[1].id),
    cancelled_at: fixedIso, cancelled_source: "admin", cancel_reason: "Storm warning",
  },
  beforeResolve: () => Object.assign(
    operationalTableRows.operational_sessions.find((row) => row.id === routingSessions[1].id),
    { cancelled_at: fixedIso, cancelled_source: "admin", cancel_reason: "Storm warning" }
  ),
  successToast: "Session cancelled — members notified",
});

const rejectedCancellationForm = new HTMLFormElement();
rejectedCancellationForm.id = "form-cancel-week";
rejectedCancellationForm.dataset = { session: authoritativeFreeSessionIds[1] };
rejectedCancellationForm.reportValidity = () => true;
const rejectedCancellationControls = equipOperationForm(rejectedCancellationForm, {
  reason: "Keep this exact reason",
});
const rejectedCancellationGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "cancel_operational_session") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return rejectedCancellationGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
location.hash = "#/admin/activities";
toastStack.children.length = 0;
const rejectedCancellation = domListeners.get("submit")({
  target: rejectedCancellationForm, preventDefault() {},
});
await new Promise(setImmediate);
assert.equal(rejectedCancellationControls.submit.getAttribute("aria-busy"), "true");
assert.ok(rejectedCancellationControls.controls.every((control) => control.disabled));
rejectedCancellationGate.reject(new Error("Cancellation transport unavailable"));
await rejectedCancellation;
assert.equal(rejectedCancellationForm.fields.reason, "Keep this exact reason",
  "a failed cancellation must preserve the entered reason");
assert.equal(location.hash, "#/admin/activities",
  "a failed cancellation must preserve the current Admin route");
assert.equal(rejectedCancellationControls.submit.hasAttribute("aria-busy"), false);
assert.ok(rejectedCancellationControls.controls.every((control) => !control.disabled));
assert.ok(toastStack.children.some((item) => item.textContent === "Cancellation transport unavailable"));

assert.equal(escapedRejections.length, 0);
console.log("ok  adjacent live queue, duty, confirmation, session, and cancellation controls await RPCs");

// Unpaid booking cancellation is authoritative in live mode: the cache and
// backend stay reserved while pending, success survives forced hydration, and
// rejection remains reserved without fake JavaScript waitlist promotion.
operationalRpcHandler = delegatedBaseOperationalRpcHandler;
let releaseConfirmation = null;
window.confirm = (message) => {
  releaseConfirmation = message;
  return true;
};
globalThis.confirm = window.confirm;
const releaseGate = deferred();
let releaseRpcArgs = null;
operationalRpcHandler = (name, args) => {
  if (name === "release_operational_reservation") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    releaseRpcArgs = structuredClone(args);
    return releaseGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
const releaseControl = operationControl("BUTTON", "", "Cancel booking");
releaseControl.dataset = { action: "release-reservation", booking: routedReleaseBooking.id };
releaseControl.closest = () => releaseControl;
toastStack.children.length = 0;
let releaseSettled = false;
const releaseClick = click({ target: releaseControl, preventDefault() {} })
  .then(() => { releaseSettled = true; });
const duplicateReleaseClick = click({ target: releaseControl, preventDefault() {} });
await new Promise(setImmediate);
assert.deepEqual(releaseRpcArgs, { p_booking_id: routedReleaseBooking.id });
assert.equal(releaseConfirmation, "Cancel this unpaid booking? Your spot will be released.");
assert.equal(releaseSettled, false);
assert.equal(operationalRpcCalls.filter((call) => call.name === "release_operational_reservation"
  && call.args.p_booking_id === routedReleaseBooking.id).length, 1);
assert.equal(store.getBooking(routedReleaseBooking.id).status, "reserved");
assert.equal(operationalTableRows.operational_bookings
  .find((row) => row.id === routedReleaseBooking.id)?.status, "reserved");
assert.equal(releaseControl.disabled, true);
assert.equal(releaseControl.getAttribute("aria-busy"), "true");
assert.equal(releaseControl.textContent, "Cancelling…");
assert.equal(toastStack.children.length, 0);
const releaseServerRow = operationalTableRows.operational_bookings
  .find((row) => row.id === routedReleaseBooking.id);
releaseServerRow.status = "cancelled";
releaseGate.resolve({ data: structuredClone(releaseServerRow), error: null });
await Promise.all([releaseClick, duplicateReleaseClick]);
assert.equal(store.getBooking(routedReleaseBooking.id).status, "cancelled");
await operations.refreshOperationalState();
assert.equal(store.getBooking(routedReleaseBooking.id).status, "cancelled",
  "released live reservation must remain cancelled after forced hydration");
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Booking cancelled"]);
assert.equal(releaseControl.disabled, false);
assert.equal(releaseControl.hasAttribute("aria-busy"), false);
assert.equal(releaseControl.textContent, "Cancel booking");

operationalRpcHandler = delegatedBaseOperationalRpcHandler;
const rejectedReleaseBooking = await store.reserveSession(authUser.id, routingSessions[1], Date.now());
const rejectedReleaseGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "release_operational_reservation") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return rejectedReleaseGate.promise;
  }
  return delegatedBaseOperationalRpcHandler(name, args);
};
const rejectedReleaseControl = operationControl("BUTTON", "", "Cancel booking");
rejectedReleaseControl.dataset = { action: "release-reservation", booking: rejectedReleaseBooking.id };
rejectedReleaseControl.closest = () => rejectedReleaseControl;
toastStack.children.length = 0;
const rejectedReleaseClick = click({ target: rejectedReleaseControl, preventDefault() {} });
await new Promise(setImmediate);
rejectedReleaseGate.resolve({ data: null, error: { message: "Release service unavailable" } });
await rejectedReleaseClick;
assert.equal(store.getBooking(rejectedReleaseBooking.id).status, "reserved");
await operations.refreshOperationalState();
assert.equal(store.getBooking(rejectedReleaseBooking.id).status, "reserved");
assert.equal(operationalTableRows.operational_bookings
  .find((row) => row.id === rejectedReleaseBooking.id)?.status, "reserved");
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Release service unavailable"]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
assert.equal(rejectedReleaseControl.disabled, false);
assert.equal(rejectedReleaseControl.hasAttribute("aria-busy"), false);
console.log("ok  delegated release persists authoritatively and restores failure state");

operationalRpcHandler = delegatedBaseOperationalRpcHandler;
const routedDeferTargets = store.deferTargetsFor(routedDeferBooking);
const routedDeferSource = store.getSession(routedDeferBooking.sessionId);
if (!routedDeferTargets.length) throw new Error("Payment routing regression needs a defer target");
assert.equal(routedDeferTargets.every((session) =>
  session.activityId === routedDeferSource.activityId), true,
"live defer choices must match the confirmed booking activity");
const routedDeferTarget = routedDeferTargets[0];
const deferControl = makeElement();
deferControl.dataset = { action: "defer-to", booking: routedDeferBooking.id, session: routedDeferTarget.id };
deferControl.closest = () => deferControl;
releaseConfirmation = null;
toastStack.children.length = 0;
await click({ target: deferControl, preventDefault() {} });
assert.equal(releaseConfirmation,
  "Defer to this session? Your current spot will be released and your payment will carry over.");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Booking moved — previous spot released and payment carried over",
]);
const routedMovedBooking = store.bookingsForUser(authUser.id).find((booking) =>
  booking.deferredFrom === routedDeferBooking.id
);
if (!routedMovedBooking) throw new Error("defer-to must create the moved booking");
assert.equal(location.hash, `#/booking/${routedMovedBooking.id}`);
const copiedValues = [];
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value) => { copiedValues.push(value); } },
});
for (const [action, copyValue, copyKind, expectedToast] of [
  ["copy-fps", "+852 6123 4567", "number", "FPS number copied"],
  ["copy-fps", "1234567", "id", "FPS ID copied"],
  ["copy-reference", "ITC-A1B2C3", "reference", "Payment reference copied"],
  ["copy-reference", "GIVE-TEST", "giving-reference", "Giving reference copied"],
]) {
  toastStack.children.length = 0;
  const control = makeElement();
  control.dataset = { action, copyValue, copyKind };
  control.closest = () => control;
  await click({ target: control, preventDefault() {} });
  assert.equal(copiedValues.at(-1), copyValue);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [expectedToast]);
  assert.equal(toastStack.children[0].getAttribute("role"), "status");
}
for (const clipboard of [
  undefined,
  { writeText: async () => { throw new Error("permission denied"); } },
]) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
  toastStack.children.length = 0;
  const control = makeElement();
  control.dataset = { action: "copy-reference", copyValue: "ITC-A1B2C3", copyKind: "reference" };
  control.closest = () => control;
  await click({ target: control, preventDefault() {} });
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [
    "Copy unavailable — select and copy the value manually",
  ]);
  assert.equal(toastStack.children[0].getAttribute("role"), "alert");
}
let emptyCopyCalls = 0;
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async () => { emptyCopyCalls++; } },
});
toastStack.children.length = 0;
const emptyCopyControl = makeElement();
emptyCopyControl.dataset = { action: "copy-fps", copyValue: "", copyKind: "number" };
emptyCopyControl.closest = () => emptyCopyControl;
await click({ target: emptyCopyControl, preventDefault() {} });
assert.equal(emptyCopyCalls, 0);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Copy unavailable — select and copy the value manually",
]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value) => { copiedValues.push(value); } },
});
const paymentNoteControl = makeElement();
paymentNoteControl.dataset = { action: "copy-payment-note", note: renderedPaymentNotePayload };
paymentNoteControl.closest = () => paymentNoteControl;
await click({ target: paymentNoteControl, preventDefault() {} });
assert.equal(copiedValues.at(-1), renderedPaymentNote,
  "delegated copy must receive the exact payload rendered by viewPay");
for (const clipboard of [
  undefined,
  { writeText: async () => { throw new Error("Clipboard permission denied"); } },
]) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
  toastStack.children.length = 0;
  await assert.doesNotReject(() => click({ target: paymentNoteControl, preventDefault() {} }),
    "missing or rejected clipboard access must be handled by delegated payment-note copying");
  assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]), [
    ["Unable to copy payment note", "alert"],
  ]);
}
let blankPaymentNoteCopyCalls = 0;
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async () => { blankPaymentNoteCopyCalls++; } },
});
toastStack.children.length = 0;
paymentNoteControl.dataset.note = "   ";
await click({ target: paymentNoteControl, preventDefault() {} });
assert.equal(blankPaymentNoteCopyCalls, 0);
assert.deepEqual(toastStack.children.map((item) => [item.textContent, item.getAttribute("role")]), [
  ["Unable to copy payment note", "alert"],
]);
console.log("ok  delegated release, deferral, safe FPS/reference copy, and payment-note copy controls execute prototype behavior");

// Gym finalization must travel through the delegated submit seam, persist the
// authorized Admin mutation, and rerender the confirmed state.
const gymSession = routingSessions[0];
location.hash = "#/admin/ops";
await windowListeners.get("hashchange")();
assert.match(viewEl.innerHTML, new RegExp(`form-gym-note[^>]*data-session="${gymSession.id}"|data-session="${gymSession.id}"[^>]*form-gym-note`));
const gymForm = new HTMLFormElement();
gymForm.id = "form-gym-note";
gymForm.dataset = { session: gymSession.id };
gymForm.fields = { note: "Confirmed 18 with Island ECC" };
gymForm.reportValidity = () => true;
await domListeners.get("submit")({ target: gymForm, preventDefault() {} });
await new Promise(setImmediate);
const confirmedGymSession = store.getSession(gymSession.id);
assert.ok(confirmedGymSession.gymConfirmedAt, "delegated gym submit must persist confirmation");
assert.equal(confirmedGymSession.gymNote, "Confirmed 18 with Island ECC");
assert.match(viewEl.innerHTML, /Confirmed with Island ECC/);
assert.match(viewEl.innerHTML, /Confirmed 18 with Island ECC/);
console.log("ok  delegated gym confirmation persists and rerenders confirmed state");

const swimmingSession = store.upcomingSessions(21)
  .find((session) => session.activityId === "water" && !data.sessionStarted(session));
assert.ok(swimmingSession, "live smoke needs an upcoming Swimming session");

const weeklyVenueForm = new HTMLFormElement();
weeklyVenueForm.id = "";
weeklyVenueForm.dataset = {
  action: "form-week-venue",
  session: swimmingSession.id,
};
weeklyVenueForm.fields = {
  location: "  Victoria Park Swimming Pool  ",
  mapsQuery: "",
};
const weeklySubmit = makeElement();
weeklySubmit.type = "submit";
weeklySubmit.closest = () => weeklyVenueForm;
weeklyVenueForm.querySelector = (selector) => selector === '[type="submit"]' ? weeklySubmit : null;
weeklyVenueForm.querySelectorAll = () => [weeklySubmit];

// A click on the nested submit control must be left to the browser so it can
// emit the form's submit event. The form's own data-action must not make the
// generic click delegate cancel that default behavior first.
let weeklyClickPrevented = false;
await click({
  target: weeklySubmit,
  preventDefault() { weeklyClickPrevented = true; },
});
assert.equal(weeklyClickPrevented, false,
  "weekly venue submit click must not be cancelled by the click delegate");

await domListeners.get("submit")({ target: weeklyVenueForm, preventDefault() {} });
await new Promise(setImmediate);
const weeklyVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.equal(weeklyVenueCall.args.p_session_id, swimmingSession.id);
assert.equal(weeklyVenueCall.args.p_location, "Victoria Park Swimming Pool");
assert.equal(weeklyVenueCall.args.p_maps_query, "Victoria Park Swimming Pool");
const savedSwimming = store.getSession(swimmingSession.id);
assert.equal(savedSwimming.location, "Victoria Park Swimming Pool");
assert.equal(savedSwimming.mapsQuery, "Victoria Park Swimming Pool");
console.log("ok  delegated weekly venue submit copies location into blank map queries");

const wntVenueForm = new HTMLFormElement();
wntVenueForm.id = "";
wntVenueForm.dataset = {
  action: "form-week-venue",
  session: "wnt-2026-08-26",
};
wntVenueForm.fields = {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: "22.2827",
  meetingLng: "114.1661",
};
const wntVenueSubmit = makeElement();
wntVenueSubmit.type = "submit";
wntVenueForm.querySelector = (selector) => selector === '[type="submit"]' ? wntVenueSubmit : null;
wntVenueForm.querySelectorAll = () => [wntVenueSubmit];
await domListeners.get("submit")({ target: wntVenueForm, preventDefault() {} });
await new Promise(setImmediate);
const wntVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.deepEqual({
  p_session_id: wntVenueCall.args.p_session_id,
  p_location: wntVenueCall.args.p_location,
  p_maps_query: wntVenueCall.args.p_maps_query,
  p_meeting_lat: wntVenueCall.args.p_meeting_lat,
  p_meeting_lng: wntVenueCall.args.p_meeting_lng,
}, {
  p_session_id: "wnt-2026-08-26",
  p_location: "Tamar Park",
  p_maps_query: "Tamar Park",
  p_meeting_lat: 22.2827,
  p_meeting_lng: 114.1661,
});
const savedWntPoint = store.getSession("wnt-2026-08-26");
assert.equal(savedWntPoint.meetingLat, 22.2827);
assert.equal(savedWntPoint.meetingLng, 114.1661);
console.log("ok  delegated WNT venue submit persists exact meeting coordinates");

const weeklyVenueFailureForm = new HTMLFormElement();
weeklyVenueFailureForm.id = "";
weeklyVenueFailureForm.dataset = {
  action: "form-week-venue",
  session: "wnt-2026-08-26",
};
weeklyVenueFailureForm.fields = {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: "22.2829",
  meetingLng: "114.1663",
};
const weeklyVenueFailureSubmit = makeElement();
weeklyVenueFailureSubmit.type = "submit";
weeklyVenueFailureForm.querySelector = (selector) => selector === '[type="submit"]' ? weeklyVenueFailureSubmit : null;
weeklyVenueFailureForm.querySelectorAll = () => [weeklyVenueFailureSubmit];
const htmlBeforeVenueFailure = viewEl.innerHTML;
const baseOperationalRpcHandler = operationalRpcHandler;
let rejectNextVenueSave = true;
operationalRpcHandler = (name, args) => {
  if (rejectNextVenueSave && name === "set_session_venue") {
    rejectNextVenueSave = false;
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return Promise.resolve({ data: null, error: { message: "Venue override setup unavailable" } });
  }
  return baseOperationalRpcHandler(name, args);
};
await domListeners.get("submit")({ target: weeklyVenueFailureForm, preventDefault() {} });
await new Promise(setImmediate);
assert.equal(viewEl.innerHTML, htmlBeforeVenueFailure);
assert.equal(weeklyVenueFailureForm.fields.location, "Tamar Park");
assert.equal(weeklyVenueFailureForm.fields.meetingLat, "22.2829");
assert.equal(weeklyVenueFailureForm.fields.meetingLng, "114.1663");
assert.equal(weeklyVenueFailureSubmit.disabled, false);
assert.ok(toastStack.children.some((item) =>
  item.textContent === "Venue override setup unavailable"
));
console.log("ok  failed weekly venue submit preserves form state without rerendering");

operationalRpcHandler = baseOperationalRpcHandler;
applicationRows.set(authUser.id, {
  profile_id: authUser.id,
  mobile: "+852 6123 4567",
});
const renderedPayoutFormHtml = await views.viewAdmin("payments");
assert.match(renderedPayoutFormHtml,
  /<form id="form-payouts"[^>]*data-fps-phone="\+852 6123 4567"/,
  "the payout form must carry the Membership Details phone it rendered");
applicationRows.delete(authUser.id);
await store.updateCollectorPayouts(authUser.id, {
  paymeLink: "payme.hsbc.com.hk/1/prior-live",
  fpsPhone: "+852 6000 0000",
});
const priorPayout = structuredClone(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id]
);
assert.deepEqual(priorPayout, {
  paymeLink: "https://payme.hsbc.com.hk/1/prior-live",
  fpsPhone: "+852 6000 0000",
});

function equipPayoutForm(form) {
  const input = makeElement();
  input.tagName = "INPUT";
  input.name = "paymeLink";
  input.disabled = false;
  const submit = makeElement();
  submit.tagName = "BUTTON";
  submit.type = "submit";
  submit.textContent = "Save payout details";
  submit.disabled = false;
  form.nativeControls = [input, submit];
  form.querySelector = (selector) => selector === '[type="submit"]' ? submit : null;
  form.querySelectorAll = (selector) => selector === "input, button" ? [input, submit] : [];
  return { input, submit };
}

const rejectedPayoutForm = new HTMLFormElement();
rejectedPayoutForm.id = "";
rejectedPayoutForm.dataset = {
  action: "form-payouts",
  fpsPhone: "+852 6123 4567",
};
rejectedPayoutForm.fields = { paymeLink: "payme.hsbc.com.hk/1/rejected-live" };
const rejectedPayoutControls = equipPayoutForm(rejectedPayoutForm);
const htmlBeforePayoutFailure = viewEl.innerHTML;
const payoutRpcGate = deferred();
let payoutRpcArgs = null;
operationalRpcHandler = (name, args) => {
  if (name === "update_collector_payout_profile") {
    payoutRpcArgs = structuredClone(args);
    return payoutRpcGate.promise;
  }
  return baseOperationalRpcHandler(name, args);
};
toastStack.children.length = 0;
let payoutSubmitSettled = false;
const payoutSubmit = domListeners.get("submit")({
  target: rejectedPayoutForm,
  preventDefault() {},
}).then(() => { payoutSubmitSettled = true; });
await new Promise(setImmediate);
assert.deepEqual(payoutRpcArgs, {
  p_profile_id: authUser.id,
  p_payme_link: "https://payme.hsbc.com.hk/1/rejected-live",
  p_fps_phone: "+852 6123 4567",
});
assert.deepEqual(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id],
  priorPayout,
  "live payout cache must keep its prior value while the RPC is pending"
);
assert.equal(payoutSubmitSettled, false, "payout submit must remain pending with the live RPC");
for (const control of Object.values(rejectedPayoutControls)) {
  assert.equal(control.disabled, true, "every payout form control must be disabled while saving");
}
assert.equal(rejectedPayoutControls.submit.getAttribute("aria-busy"), "true");
assert.equal(rejectedPayoutControls.submit.textContent, "Saving…");
assert.equal(viewEl.innerHTML, htmlBeforePayoutFailure);
assert.equal(rejectedPayoutForm.fields.paymeLink, "payme.hsbc.com.hk/1/rejected-live");
payoutRpcGate.resolve({ data: null, error: { message: "Payout profile unavailable" } });
await payoutSubmit;
assert.deepEqual(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id],
  priorPayout,
  "rejected live payout RPC must leave the prior device value unchanged"
);
assert.equal(viewEl.innerHTML, htmlBeforePayoutFailure);
assert.equal(rejectedPayoutForm.fields.paymeLink, "payme.hsbc.com.hk/1/rejected-live");
for (const control of Object.values(rejectedPayoutControls)) {
  assert.equal(control.disabled, false, "payout controls must be restored after rejection");
}
assert.equal(rejectedPayoutControls.submit.hasAttribute("aria-busy"), false);
assert.equal(rejectedPayoutControls.submit.textContent, "Save payout details");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Payout profile unavailable",
]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
console.log("ok  rejected live payout preserves prior cache and restores its busy form");

const invalidPayoutForm = new HTMLFormElement();
invalidPayoutForm.id = "";
invalidPayoutForm.dataset = {
  action: "form-payouts",
  fpsPhone: "+852 6123 4567",
};
invalidPayoutForm.fields = { paymeLink: "https://evil.example/1/not-payme" };
const invalidPayoutControls = equipPayoutForm(invalidPayoutForm);
const payoutRpcCallsBeforeInvalid = operationalRpcCalls
  .filter((call) => call.name === "update_collector_payout_profile").length;
toastStack.children.length = 0;
await domListeners.get("submit")({ target: invalidPayoutForm, preventDefault() {} });
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "update_collector_payout_profile").length,
  payoutRpcCallsBeforeInvalid,
  "an unsafe PayMe link must be rejected before the live payout RPC"
);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Enter your personal PayMe link from PayMe.",
]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");
assert.equal(invalidPayoutControls.input.disabled, false);
assert.equal(invalidPayoutControls.submit.disabled, false);
console.log("ok  unsafe delegated PayMe submit fails before its live RPC");

const successfulPayoutForm = new HTMLFormElement();
successfulPayoutForm.id = "";
successfulPayoutForm.dataset = {
  action: "form-payouts",
  fpsPhone: "+852 6123 4567",
};
successfulPayoutForm.fields = { paymeLink: "payme.hsbc/successful-live" };
const successfulPayoutControls = equipPayoutForm(successfulPayoutForm);
const successfulPayoutRpcGate = deferred();
operationalRpcHandler = (name, args) => {
  if (name === "update_collector_payout_profile") {
    payoutRpcArgs = structuredClone(args);
    return successfulPayoutRpcGate.promise;
  }
  return baseOperationalRpcHandler(name, args);
};
toastStack.children.length = 0;
let successfulPayoutSettled = false;
const successfulPayoutSubmit = domListeners.get("submit")({
  target: successfulPayoutForm,
  preventDefault() {},
}).then(() => { successfulPayoutSettled = true; });
await new Promise(setImmediate);
assert.deepEqual(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id],
  priorPayout,
  "successful live payout must not persist before RPC settlement"
);
assert.equal(successfulPayoutSettled, false);
assert.equal(successfulPayoutControls.input.disabled, true);
assert.equal(successfulPayoutControls.submit.disabled, true);
const successfulServerPayout = operationalTableRows.collector_payout_profiles
  .find((row) => row.profile_id === authUser.id);
assert.deepEqual(payoutRpcArgs, {
  p_profile_id: authUser.id,
  p_payme_link: "https://payme.hsbc/successful-live",
  p_fps_phone: "+852 6123 4567",
}, "typed PayMe and rendered FPS phone must be captured before controls disable");
Object.assign(successfulServerPayout, {
  payme_link: "https://payme.hsbc/successful-live",
  fps_phone: "+852 6123 4567",
});
successfulPayoutRpcGate.resolve({ data: structuredClone(successfulServerPayout), error: null });
await successfulPayoutSubmit;
await new Promise(setImmediate);
assert.deepEqual(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id],
  {
    paymeLink: "https://payme.hsbc/successful-live",
    fpsPhone: "+852 6123 4567",
  },
  "successful live payout must persist its normalized value after RPC settlement"
);
assert.equal(successfulPayoutControls.input.disabled, false);
assert.equal(successfulPayoutControls.submit.disabled, false);
assert.equal(successfulPayoutControls.submit.hasAttribute("aria-busy"), false);
assert.ok(toastStack.children.some((item) => item.textContent === "Payout details saved"));
console.log("ok  successful live payout persists only after RPC settlement");

operationalRpcHandler = baseOperationalRpcHandler;
const applicationFailurePayoutForm = new HTMLFormElement();
applicationFailurePayoutForm.id = "";
applicationFailurePayoutForm.dataset = {
  action: "form-payouts",
  fpsPhone: "+852 6123 4567",
};
applicationFailurePayoutForm.fields = { paymeLink: "payme.hsbc.com.hk/1/application-failure" };
const applicationFailurePayoutControls = equipPayoutForm(applicationFailurePayoutForm);
const applicationFailurePayoutGate = deferred();
const payoutRpcCallsBeforeApplicationFailure = operationalRpcCalls
  .filter((call) => call.name === "update_collector_payout_profile").length;
operationalRpcHandler = (name, args) => {
  if (name === "update_collector_payout_profile") {
    payoutRpcArgs = structuredClone(args);
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return applicationFailurePayoutGate.promise;
  }
  return baseOperationalRpcHandler(name, args);
};
applicationReadError = new Error("Membership details unavailable");
toastStack.children.length = 0;
let applicationFailureSubmitSettled = false;
const applicationFailureSubmit = domListeners.get("submit")({
  target: applicationFailurePayoutForm,
  preventDefault() {},
}).then(() => { applicationFailureSubmitSettled = true; });
await new Promise(setImmediate);
assert.equal(applicationFailureSubmitSettled, false,
  "a valid payout submit must await its RPC despite an unavailable application reread");
assert.equal(
  operationalRpcCalls.filter((call) => call.name === "update_collector_payout_profile").length,
  payoutRpcCallsBeforeApplicationFailure + 1,
  "an unavailable application reread must not block a valid payout RPC"
);
assert.deepEqual(payoutRpcArgs, {
  p_profile_id: authUser.id,
  p_payme_link: "https://payme.hsbc.com.hk/1/application-failure",
  p_fps_phone: "+852 6123 4567",
});
for (const control of Object.values(applicationFailurePayoutControls)) {
  assert.equal(control.disabled, true);
}
Object.assign(successfulServerPayout, {
  payme_link: "https://payme.hsbc.com.hk/1/application-failure",
  fps_phone: "+852 6123 4567",
});
applicationFailurePayoutGate.resolve({
  data: structuredClone(successfulServerPayout),
  error: null,
});
await applicationFailureSubmit;
applicationReadError = null;
assert.deepEqual(
  JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts?.[authUser.id],
  {
    paymeLink: "https://payme.hsbc.com.hk/1/application-failure",
    fpsPhone: "+852 6123 4567",
  },
  "rendered FPS fallback must allow authoritative payout persistence without a second application read"
);
assert.equal(applicationFailurePayoutForm.fields.paymeLink, "payme.hsbc.com.hk/1/application-failure");
assert.equal(applicationFailurePayoutControls.input.disabled, false);
assert.equal(applicationFailurePayoutControls.submit.disabled, false);
assert.equal(applicationFailurePayoutControls.submit.hasAttribute("aria-busy"), false);
assert.ok(toastStack.children.some((item) => item.textContent === "Payout details saved"));
assert.ok(!toastStack.children.some((item) => item.textContent === "Membership details unavailable"));
console.log("ok  rendered FPS fallback keeps valid payout save independent of application rereads");

// Legacy member-management URLs canonicalize instead of rendering the removed
// row/avatar implementation.
location.hash = "#/admin/users";
await windowListeners.get("hashchange")();
assert.equal(location.hash, "#/admin/members");
assert.doesNotMatch(elements.get("view").innerHTML, /class="(?:row|avatar)"/);

// Every role/access change names the member and target state before touching
// the store. Cancelling leaves the profile untouched.
const roleSelect = makeElement();
roleSelect.dataset = { change: "set-role", user: "approved-member", memberName: "Micah Member" };
roleSelect.value = "admin";
roleSelect.closest = () => roleSelect;
let confirmMessage = null;
window.confirm = (message) => { confirmMessage = message; return false; };
const updatesBeforeRoleCancel = profileUpdates.length;
await change({ target: roleSelect });
assert.equal(confirmMessage, "Change Micah Member’s role to Admin?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled promotion must not call the store");

const demoteSelect = makeElement();
demoteSelect.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "admin" };
demoteSelect.value = "member";
demoteSelect.closest = () => demoteSelect;
await change({ target: demoteSelect });
assert.equal(confirmMessage, "Change Tina Admin’s role to Member?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled demotion must not call the store");

const revokeControl = makeElement();
revokeControl.textContent = "Revoke access";
revokeControl.dataset = { action: "revoke-member", user: "approved-admin", memberName: "Tina Admin" };
revokeControl.closest = () => revokeControl;
await click({ target: revokeControl });
assert.equal(confirmMessage, "Revoke Tina Admin’s access and move them to Pending?");
assert.equal(profileUpdates.length, updatesBeforeRoleCancel, "Cancelled revoke must not call the store");

window.confirm = () => true;
const successfulRoleSelect = makeElement();
successfulRoleSelect.tagName = "SELECT";
successfulRoleSelect.dataset = { change: "set-role", user: "approved-member", memberName: "Micah Member", currentRole: "member" };
successfulRoleSelect.value = "admin";
successfulRoleSelect.closest = () => successfulRoleSelect;
const roleGate = deferred();
profileUpdateGate = roleGate.promise;
const pendingRoleChange = change({ target: successfulRoleSelect });
assert.equal(successfulRoleSelect.disabled, true);
assert.equal(successfulRoleSelect.getAttribute("aria-busy"), "true");
roleGate.resolve();
await pendingRoleChange;
profileUpdateGate = null;
assert.equal(successfulRoleSelect.disabled, false);
assert.equal(successfulRoleSelect.hasAttribute("aria-busy"), false);
assert.ok(profileUpdates.some((update) => update.id === "approved-member" && update.role === "admin"));
assert.ok(toastStack.children.some((item) => item.textContent === "Micah Member is now Admin."));

// Successful delegated demotion and revocation both dispatch through the live
// role API and only announce success after the returned row confirms mutation.
toastStack.children.length = 0;
const successfulDemotion = makeElement();
successfulDemotion.tagName = "SELECT";
successfulDemotion.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "admin" };
successfulDemotion.value = "member";
successfulDemotion.closest = () => successfulDemotion;
await change({ target: successfulDemotion });
assert.ok(profileUpdates.some((update) => update.id === "approved-admin" && update.role === "member"));
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Tina Admin is now Member."]);

toastStack.children.length = 0;
const successfulRevoke = makeElement();
successfulRevoke.textContent = "Revoke access";
successfulRevoke.dataset = { action: "revoke-member", user: "approved-member", memberName: "Micah Member" };
successfulRevoke.closest = () => successfulRevoke;
await click({ target: successfulRevoke });
assert.ok(profileUpdates.some((update) => update.id === "approved-member" && update.role === "pending"));
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Micah Member moved to Pending."]);

// A stale delegated target restores its select and never emits false success.
toastStack.children.length = 0;
profileUpdateResult = "zero";
const staleRoleSelect = makeElement();
staleRoleSelect.tagName = "SELECT";
staleRoleSelect.dataset = { change: "set-role", user: "removed-member", memberName: "Removed Member", currentRole: "member" };
staleRoleSelect.value = "admin";
staleRoleSelect.closest = () => staleRoleSelect;
await change({ target: staleRoleSelect });
profileUpdateResult = "row";
assert.equal(staleRoleSelect.value, "member");
assert.equal(staleRoleSelect.disabled, false);
assert.equal(staleRoleSelect.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Application decision conflict."]);
assert.equal(toastStack.children.some((item) => /is now Admin/.test(item.textContent)), false);

// Once the authoritative role mutation succeeds, a failed Members refresh is
// a stale-view problem: success remains truthful and the old control is locked
// so the mutation cannot be retried against already-changed data.
toastStack.children.length = 0;
const refreshFailedRole = makeElement();
refreshFailedRole.tagName = "SELECT";
refreshFailedRole.dataset = { change: "set-role", user: "approved-admin", memberName: "Tina Admin", currentRole: "member" };
refreshFailedRole.value = "admin";
refreshFailedRole.closest = () => refreshFailedRole;
profileListError = new Error("Members refresh failed");
await change({ target: refreshFailedRole });
profileListError = null;
assert.equal(approvedProfiles.find((item) => item.id === "approved-admin").role, "admin");
assert.equal(refreshFailedRole.disabled, true, "refresh failure must lock the stale role control");
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Tina Admin is now Admin.",
  "Change saved, but this Admin view could not refresh. Members refresh failed",
]);
assert.equal(toastStack.children.some((item) => /Unable to change role/.test(item.textContent)), false);

// Restore fixture roles so later approval-queue regressions retain their
// original baseline independently of these member-action tests.
approvedProfiles.find((item) => item.id === "approved-admin").role = "admin";
approvedProfiles.find((item) => item.id === "approved-member").role = "member";
location.hash = "#/admin";
await windowListeners.get("hashchange")();

// Delegated async controls expose exact progress copy, suppress a duplicate
// action, and recover without a success toast when the store rejects.
const googleControl = makeElement();
googleControl.textContent = "Continue with Google";
googleControl.dataset = { action: "sign-in-google" };
googleControl.closest = () => googleControl;
toastStack.children.length = 0;
const firstGoogleClick = click({ target: googleControl });
assert.equal(googleControl.disabled, true);
assert.equal(googleControl.textContent, "Connecting…");
assert.equal(googleControl.getAttribute("aria-busy"), "true");
const duplicateGoogleClick = click({ target: googleControl });
assert.equal(oauthCalls, 1, "pending control must prevent a duplicate store action");
assert.equal(
  oauthOptions?.options?.redirectTo,
  `${location.origin}/app/`,
  "Google OAuth must use the allowlisted /app/ callback before canonical-root routing"
);
releaseOAuth({ error: new Error("OAuth unavailable") });
await Promise.all([firstGoogleClick, duplicateGoogleClick]);
assert.equal(googleControl.disabled, false);
assert.equal(googleControl.textContent, "Continue with Google");
assert.equal(googleControl.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["OAuth unavailable"]);
assert.equal(toastStack.children[0].getAttribute("role"), "alert");

// Exercise a second delegated path: sign-out must also suppress duplicate
// clicks, recover its control on rejection, and withhold the success toast.
const signOutControl = makeElement();
signOutControl.textContent = "Sign out";
signOutControl.dataset = { action: "signout" };
signOutControl.closest = () => signOutControl;
toastStack.children.length = 0;
const signOutCallsBeforeDelegatedTest = signOutCalls;
const firstSignOut = click({ target: signOutControl });
assert.equal(signOutControl.disabled, true);
assert.equal(signOutControl.textContent, "Signing out…");
assert.equal(signOutControl.getAttribute("aria-busy"), "true");
const duplicateSignOut = click({ target: signOutControl });
assert.equal(signOutCalls, signOutCallsBeforeDelegatedTest + 1, "pending sign-out must prevent a duplicate store action");
releaseSignOut({ error: new Error("Sign-out unavailable") });
await Promise.all([firstSignOut, duplicateSignOut]);
assert.equal(signOutControl.disabled, false);
assert.equal(signOutControl.textContent, "Sign out");
assert.equal(signOutControl.hasAttribute("aria-busy"), false);
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Sign-out unavailable"]);
assert.equal(toastStack.children.some((item) => item.textContent === "Signed out"), false);
await store.getCurrentUser();

const makeDecisionCard = (action) => {
  const approve = makeElement();
  approve.textContent = "Approve";
  approve.dataset = { action: "approve", user: "pending-submitted", applicantName: "Submitted Runner" };
  const decline = makeElement();
  decline.textContent = "Decline";
  decline.dataset = { action: "decline", user: "pending-submitted", applicantName: "Submitted Runner" };
  const error = makeElement();
  error.hidden = true;
  const card = makeElement();
  card.querySelectorAll = () => [approve, decline];
  card.querySelector = (selector) => selector === ".decision-error" ? error : null;
  for (const control of [approve, decline]) {
    control.closest = (selector) => selector === "[data-action]" ? control : card;
  }
  return { card, approve, decline, error, target: action === "approve" ? approve : decline };
};
confirmMessage = null;
window.confirm = (message) => { confirmMessage = message; return false; };
const cancelledDecline = makeDecisionCard("decline");
const updatesBeforeCancel = profileUpdates.length;
await click({ target: cancelledDecline.target });
assert.equal(confirmMessage, "Decline Submitted Runner’s membership application?");
assert.equal(profileUpdates.length, updatesBeforeCancel, "Cancelled decline must not update the profile");

window.confirm = (message) => { confirmMessage = message; return true; };
const declineAttempt = makeDecisionCard("decline");
const decisionGate = deferred();
profileUpdateGate = decisionGate.promise;
profileUpdateError = new Error("Profile update failed");
toastStack.children.length = 0;
const pendingDecline = click({ target: declineAttempt.target });
assert.equal(confirmMessage, "Decline Submitted Runner’s membership application?");
assert.equal(declineAttempt.approve.disabled, true);
assert.equal(declineAttempt.decline.disabled, true);
assert.equal(declineAttempt.decline.textContent, "Declining…");
decisionGate.resolve();
await pendingDecline;
profileUpdateGate = null;
assert.equal(elements.get("view").innerHTML, retainedQueueHtml, "Failed decline must retain prior queue UI");
assert.equal(declineAttempt.approve.disabled, false);
assert.equal(declineAttempt.decline.disabled, false);
assert.equal(declineAttempt.decline.textContent, "Decline");
assert.equal(declineAttempt.error.hidden, false);
assert.equal(declineAttempt.error.textContent, "Profile update failed");
assert.equal(declineAttempt.error.getAttribute("role"), "alert");
assert.deepEqual(toastStack.children.map((item) => item.textContent), ["Profile update failed"]);
assert.equal(toastStack.children.some((item) => /Approved\.|Declined\./.test(item.textContent)), false);
profileUpdateError = null;

for (const [expectedError, configure] of [
  ["Profile update failed", () => { profileUpdateError = new Error("Profile update failed"); }],
  ["Application decision conflict.", () => { profileUpdateResult = "zero"; }],
]) {
  const approvalAttempt = makeDecisionCard("approve");
  toastStack.children.length = 0;
  configure();
  await click({ target: approvalAttempt.target });
  assert.equal(elements.get("view").innerHTML, retainedQueueHtml, `${expectedError} must retain prior queue UI`);
  assert.equal(approvalAttempt.error.textContent, expectedError);
  assert.equal(approvalAttempt.error.hidden, false);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [expectedError]);
  assert.equal(toastStack.children.some((item) => item.textContent === "Approved."), false,
    `${expectedError} must not produce a success toast`);
  profileUpdateError = null;
  profileUpdateResult = "row";
}

// A confirmed decision must not become a false action failure when the
// post-decision queue read rejects. Keep the retained card non-actionable and
// announce the successful mutation separately from the stale Admin view.
const refreshFailedDecision = makeDecisionCard("approve");
toastStack.children.length = 0;
profileListErrorAfterUpdate = new Error("Queue refresh failed");
await click({ target: refreshFailedDecision.target });
profileListErrorAfterUpdate = null;
profileListError = null;
assert.equal(pendingProfiles.find((item) => item.id === "pending-submitted").role, "member");
assert.equal(refreshFailedDecision.approve.disabled, true);
assert.equal(refreshFailedDecision.decline.disabled, true);
assert.equal(refreshFailedDecision.error.hidden, false);
assert.equal(
  refreshFailedDecision.error.textContent,
  "Change saved, but this Admin view could not refresh. Queue refresh failed"
);
assert.deepEqual(toastStack.children.map((item) => item.textContent), [
  "Approved.",
  "Change saved, but this Admin view could not refresh. Queue refresh failed",
]);
assert.equal(toastStack.children.some((item) => item.textContent === "Decision failed"), false);
pendingProfiles.find((item) => item.id === "pending-submitted").role = "pending";

escapedRejections.length = 0;
toastStack.children.length = 0;
profile.role = "pending";
applicationReadError = null;
location.hash = "#/account";
await dispatchAuthStateChange("SIGNED_IN");
if (location.hash !== "#/apply"
    || !elements.get("view").innerHTML.includes("Application details unavailable")) {
  throw new Error("Deferred SIGNED_IN handling should preserve Account rendering before redirecting a pending applicant to Apply");
}

applicationReadError = new Error("Application read failed");
location.hash = "#/home";
await dispatchAuthStateChange("SIGNED_IN");
await new Promise(setImmediate);
if (escapedRejections.length || toastStack.children.length !== 1 || toastStack.children[0].textContent !== "Application read failed") {
  throw new Error("SIGNED_IN should catch failed application reads and show one error toast");
}
process.off("unhandledRejection", captureRejection);
applicationReadError = null;
profile.role = "super_admin";
await store.getCurrentUser();
const approvedSyncBefore = avatarFunctionCalls.filter((call) => call.options.body?.action === "sync_google").length;
location.hash = "#/account";
toastStack.children.length = 0;
await dispatchAuthStateChange("SIGNED_IN");
const approvedSyncAfter = avatarFunctionCalls.filter((call) => call.options.body?.action === "sync_google").length;
assert.equal(approvedSyncAfter, approvedSyncBefore,
  "repeated SIGNED_IN focus events must not consume a Google import attempt when a photo exists");
assert.equal(location.hash, "#/account", "repeated SIGNED_IN must preserve the committed route");
avatarPresentation = {
  ...avatarPresentation,
  source: "initials",
  url: null,
  state: "active",
  expiresAt: null,
};
store.clearAvatarCache();
await dispatchAuthStateChange("SIGNED_IN");
const missingSyncAfter = avatarFunctionCalls.filter((call) => call.options.body?.action === "sync_google").length;
assert.equal(missingSyncAfter, approvedSyncAfter + 1,
  "approved sign-in must import the verified Google avatar when no photo exists");
assert.equal(store.currentUser().status, "approved");
const signedInAvatar = await store.getOwnAvatar();
assert.equal(signedInAvatar.source, "google");
assert.match(signedInAvatar.url, /google[.]jpg/);
assert.match(views.avatarHTML(store.currentUser(), signedInAvatar), /avatar__image/);
app.commitOwnAvatarPresentation(signedInAvatar);
assert.match(elements.get("top-avatar").innerHTML, /avatar__image/,
  "top navigation must render the resolved signed presentation");

let managedOptions = null;
const profileAvatarButton = makeElement();
const previousViewQuery = viewEl.querySelector;
viewEl.querySelector = (selector) => selector === '[data-action="manage-profile-photo"]'
  ? profileAvatarButton
  : null;
await app.openOwnAvatarManager((options) => {
  managedOptions = options;
  return { close() {} };
});
assert.equal(managedOptions.memberName, "Riley Runner");
assert.equal(typeof managedOptions.onUpload, "function");
const managedUpload = await managedOptions.onUpload(new Blob(["jpeg"], { type: "image/jpeg" }));
assert.equal(managedUpload.source, "custom");
assert.match(elements.get("top-avatar").innerHTML, /custom[.]jpg/);
assert.match(profileAvatarButton.innerHTML, /custom[.]jpg/,
  "upload must update Profile avatar without a page reload");
const managedRemove = await managedOptions.onRemove();
assert.equal(managedRemove.source, "google");
assert.match(elements.get("top-avatar").innerHTML, /google[.]jpg/);
assert.match(profileAvatarButton.innerHTML, /google[.]jpg/,
  "remove must update Profile avatar without a page reload");
viewEl.querySelector = previousViewQuery;

const avatarErrorWrapper = makeElement();
const avatarErrorImage = makeElement();
avatarErrorImage.className = "avatar__image";
avatarErrorImage.classList.toggle("avatar__image", true);
avatarErrorImage.closest = () => avatarErrorWrapper;
assert.equal(app.revealAvatarInitials(avatarErrorImage), true);
assert.equal(avatarErrorImage.hidden, true);
assert.equal(avatarErrorWrapper.classList.contains("is-error"), true,
  "image failure must reveal the independent initials fallback");
assert.doesNotMatch(readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8"), /location[.]reload/,
  "avatar updates must not reload the page");

store.clearAvatarCache();
const activityAvatarResolveBefore = avatarResolveCalls.length;
location.hash = `#/activity/${gatedPaidSession.id}`;
await windowListeners.get("hashchange")();
const activityAvatarCalls = avatarResolveCalls.slice(activityAvatarResolveBefore)
  .filter((call) => new URL(call.url).searchParams.get("scope") === "session");
assert.equal(activityAvatarCalls.length, 1,
  "approved Activity Details must request exactly one session-scoped avatar list");
assert.equal(new URL(activityAvatarCalls[0].url).searchParams.get("sessionId"), gatedPaidSession.id);
assert.match(viewEl.innerHTML, /Alex T[.]/);
assert.match(viewEl.innerHTML, /attendee-avatar/);

store.clearAvatarCache();
avatarResolveStatus = 500;
location.hash = `#/activity/${gatedPaidSession.id}`;
await windowListeners.get("hashchange")();
avatarResolveStatus = 200;
assert.match(viewEl.innerHTML, /Who’s coming/);
assert.doesNotMatch(viewEl.innerHTML, /sensitive resolver detail|object_path|pending_object/,
  "resolver failure must retain safe attendee UI without server details");

const makeAvatarModerationControl = (action, profileId, reason) => {
  const reasonInput = makeElement();
  reasonInput.value = reason;
  const primary = makeElement();
  primary.dataset = { action, profileId, memberName: "Micah Member" };
  const secondary = makeElement();
  const card = makeElement();
  card.querySelector = (selector) => selector === "[data-avatar-moderation-reason]" ? reasonInput : null;
  card.querySelectorAll = () => [primary, secondary, reasonInput];
  primary.closest = () => card;
  return { primary, secondary, reasonInput, card };
};

views.adminMemberFilters.query = "";
views.adminMemberFilters.status = "all";
views.adminMemberFilters.role = "all";
Object.assign(avatarAdminRows[1], pendingRowBackup);
store.clearAvatarCache();
location.hash = "#/admin/members";
viewEl.innerHTML = "moderation-before";
const moderationGate = deferred();
avatarModerationGate = moderationGate.promise;
const approveControl = makeAvatarModerationControl("avatar-approve", "approved-member", "");
const moderateCallsBefore = avatarFunctionCalls.filter((call) => call.name === "moderate-profile-avatar").length;
const firstModeration = app.runAvatarModeration(approveControl.primary);
const duplicateModeration = await app.runAvatarModeration(approveControl.primary);
assert.equal(duplicateModeration, false);
assert.equal(
  avatarFunctionCalls.filter((call) => call.name === "moderate-profile-avatar").length,
  moderateCallsBefore + 1,
  "pending moderation must suppress duplicate actions",
);
assert.equal(approveControl.primary.disabled, true);
assert.equal(approveControl.secondary.disabled, true);
assert.equal(approveControl.reasonInput.disabled, true);
assert.equal(approveControl.primary.getAttribute("aria-busy"), "true");
assert.equal(approveControl.primary.textContent, "Approving…");
moderationGate.resolve();
assert.equal(await firstModeration, true);
avatarModerationGate = null;
assert.notEqual(viewEl.innerHTML, "moderation-before", "successful moderation must rerender Admin Members");
assert.match(viewEl.innerHTML, /No profile photos awaiting review/);

Object.assign(avatarAdminRows[1], pendingRowBackup);
store.clearAvatarCache();
const rejectControl = makeAvatarModerationControl("avatar-reject", "approved-member", "Keep this reason");
avatarModerationError = { message: "sensitive moderation detail", context: { status: 500 } };
viewEl.innerHTML = "moderation-failure-preserved";
assert.equal(await app.runAvatarModeration(rejectControl.primary), false);
avatarModerationError = null;
assert.equal(viewEl.innerHTML, "moderation-failure-preserved",
  "failed moderation must preserve the current Admin UI");
assert.equal(rejectControl.reasonInput.value, "Keep this reason");
assert.equal(rejectControl.primary.disabled, false);
assert.equal(rejectControl.secondary.disabled, false);
assert.equal(rejectControl.reasonInput.disabled, false);
assert.equal(rejectControl.primary.hasAttribute("aria-busy"), false);
assert.equal(rejectControl.primary.textContent, "");
const missingReasonControl = makeAvatarModerationControl("avatar-reject", "approved-member", "   ");
const callsBeforeMissingReason = avatarFunctionCalls.length;
assert.equal(await app.runAvatarModeration(missingReasonControl.primary), false);
assert.equal(avatarFunctionCalls.length, callsBeforeMissingReason);
assert.equal(missingReasonControl.reasonInput.focusOptions, undefined);
assert.equal(activeElement, missingReasonControl.reasonInput,
  "missing moderation reason must move focus to the reason field");

activeGivingCampaignRow = null;
activeGivingCampaignError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const missingSchemaGiving = await views.viewGiving();
assert.match(missingSchemaGiving, /No active Giving campaign at the moment/);
assert.match(missingSchemaGiving, /Check back soon for the next opportunity to support the ITC community\./);

activeGivingCampaignError = null;
const emptyGiving = await views.viewGiving();
assert.match(emptyGiving, /No active Giving campaign at the moment/);

activeGivingCampaignError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewGiving(), { message: "permission denied" });
activeGivingCampaignError = null;

activeGivingCampaignRow = {
  id: "campaign-current", title: "Current campaign", description: "Current route data",
  goal_hkd: 1000, fps_id: "1111111", fps_payee: "ITC", status: "published",
};
await store.getActiveGivingCampaign();
activeGivingCampaignRow = {
  id: "campaign-stale", title: "Stale campaign", description: "Obsolete route data",
  goal_hkd: 2000, fps_id: "2222222", fps_payee: "ITC", status: "published",
};
const staleGivingHtml = await views.viewGiving({ ownsGeneration: () => false });
assert.match(staleGivingHtml, /Stale campaign/, "stale route may finish with its own result");
const retainedCampaignGift = store.recordDonation({
  name: "Riley Runner", amount: 50, ref: "STALE-CACHE-REGRESSION",
});
assert.equal(retainedCampaignGift.userId, authUser.id, "live Giving must derive the authenticated UUID");
assert.equal(retainedCampaignGift.campaignId, "campaign-current",
  "stale Giving completion must not replace the shared live campaign cache");
const liveGivingUser = store.currentUser();
const liveGivingUserId = liveGivingUser.id;
liveGivingUser.id = "";
assert.throws(
  () => store.recordDonation({ name: "Missing UUID", amount: 10, ref: "MISSING-UUID" }),
  /Approved member access required/,
  "Giving must reject an approved-looking identity with no UUID"
);
liveGivingUser.id = liveGivingUserId;
console.log("ok  stale Giving lookups cannot mutate the owned live campaign cache");

const finalSignOut = store.signOutLive();
releaseSignOut({ error: null });
await finalSignOut;
const avatarResolveCountAfterSignOut = avatarResolveCalls.length;
const signedOutAvatar = await store.getOwnAvatar({ force: true });
assert.equal(signedOutAvatar.source, "initials");
assert.equal(signedOutAvatar.url, null);
assert.equal(avatarResolveCalls.length, avatarResolveCountAfterSignOut,
  "sign-out must clear signed URLs and never resolve another avatar anonymously");
if (!store.getBooking(uuidBooking.id) || store.getBooking(uuidBooking.id).userId !== authUser.id) {
  throw new Error("Live sign-out must preserve device-local Payment records keyed by profile UUID");
}

console.log("ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock");
console.log("ok  live application read failures are caught and shown once across async render flows");
console.log("ok  live OAuth session renders the signed-in home page");
console.log("ok  live profile renders valid account metadata");
console.log("ok  live indemnity renders from the application waiver state");
console.log("ok  live approved/admin missing-application Profile sections render unavailable cards");

// Giving integration must retain live Supabase ownership for campaigns and donor IDs.
for (const relativePath of [
  "../supabase/migrations/20260805000011_giving_campaigns.sql",
  "../supabase/migrations/20260806000001_donor_id.sql",
  "../supabase/tests/giving_campaigns_integration.sql",
  "../supabase/tests/verify_giving_campaigns_safety.sh",
]) {
  if (!existsSync(resolve(__dirnameSmoke, relativePath))) {
    throw new Error(`live Giving database contract missing ${relativePath}`);
  }
}
if (typeof store.updateMyDonorId !== "function" || typeof store.getActiveGivingCampaign !== "function") {
  throw new Error("live Giving profile/campaign APIs are missing");
}
console.log("ok  live Giving database and profile APIs coexist with Payment/Auth and Notifications");

// Retained BFT/Midtown cancellations never re-enter active session selectors.
assert.equal(await store.getSession("hyrox-bft-2026-08-15"), null);
assert.equal(await store.getSession("hyrox-midtown-2026-08-15"), null);
const liveCancelledRsvpRow = {
  ...structuredClone(operationalTableRows.operational_sessions.find((row) => row.id === lunchSession.id)),
  id: "lunch-cancelled-render",
  cancelled_at: fixedIso,
  cancelled_by: "approved-admin",
  cancelled_source: "admin",
  cancel_reason: "Lunch venue unavailable",
};
const liveCancelledFreeTemplate = {
  activity_id: "event-live-free-render",
  name: "Cancelled Community Social",
  venue: "Tamar Park",
  weekday: 0,
  start_time: "15:00:00",
  duration_minutes: 90,
  capacity: 20,
  price_hkd: 0,
  default_open: true,
  active: false,
  category: "Socials",
  maps_query: "Tamar Park",
  requires_rsvp: false,
};
const liveCancelledFreeRow = {
  ...structuredClone(liveCancelledRsvpRow),
  id: "event-live-free-render-2026-08-30",
  activity_id: liveCancelledFreeTemplate.activity_id,
  session_date: "2026-08-30",
  start_time: "15:00:00",
  venue: "Tamar Park",
  capacity: 20,
  price_hkd: 0,
};
operationalTableRows.operational_activity_templates.push(liveCancelledFreeTemplate);
operationalTableRows.operational_sessions.push(liveCancelledRsvpRow, liveCancelledFreeRow);
await operations.refreshOperationalState();
const liveRsvpCancellationHtml = views.viewActivity(liveCancelledRsvpRow.id);
const liveFreeCancellationHtml = views.viewActivity(liveCancelledFreeRow.id);
for (const [label, html] of [
  ["RSVP", liveRsvpCancellationHtml],
  ["free", liveFreeCancellationHtml],
]) {
  if (!html.includes("Stay tuned for the next available social.")
      || html.includes("Paid bookings were moved to the next available session — check your account.")) {
    throw new Error(`live ${label} cancellation Activity Details must render the exact social follow-up copy`);
  }
}
console.log("ok  live cancellation copy renders exact paid and social follow-up variants");

// Location-map surface: a non-cancelled paid HYROX exposes Get directions
// without the inline map host.
const liveNonCancelledHyrox = store.upcomingSessions(21)
  .find((s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
if (!liveNonCancelledHyrox) throw new Error("live smoke needs an upcoming non-cancelled hyrox session");
const liveHyroxDetail = views.viewActivity(liveNonCancelledHyrox.id);
if (!liveHyroxDetail.includes("Get directions") || liveHyroxDetail.includes('id="activity-map"')) {
  throw new Error("paid HYROX activity must surface Get directions without the inline map");
}
console.log("ok  live paid HYROX surfaces Get directions without the inline map");

// app.js owns the browser-relative lazy import. Exercise that real import from
// app/js/app.js so a duplicated "js/" path cannot pass through the smoke file's
// different base URL.
const browserRelativeMap = await app.loadActivityMapModule();
assert.equal(
  typeof browserRelativeMap.mountActivityMap,
  "function",
  "app.js must resolve the map module relative to its own app/js URL"
);

// Admin Tamar picker: map click and marker drag emit exact selected points.
const pickerLeafletBefore = globalThis.L;
let pickerMapClick;
let pickerMarkerDrag;
let pickerMarkerPoint = { lat: 22.2816182, lng: 114.1655613 };
let pickerRemoved = 0;
const pickerSetViews = [];
const pickerChanges = [];
const pickerMap = {
  setView(coords, zoom) { pickerSetViews.push([coords, zoom]); },
  on(type, callback) { if (type === "click") pickerMapClick = callback; },
  remove() { pickerRemoved += 1; },
};
const pickerMarker = {
  addTo() { return this; },
  setLatLng(coords) { pickerMarkerPoint = { lat: coords[0], lng: coords[1] }; },
  getLatLng() { return pickerMarkerPoint; },
  on(type, callback) { if (type === "dragend") pickerMarkerDrag = callback; },
};
globalThis.L = {
  map: () => pickerMap,
  tileLayer: () => ({ addTo() {} }),
  marker: () => pickerMarker,
};
const pickerHost = makeElement();
pickerHost.isConnected = true;
const pickerController = await browserRelativeMap.mountVenuePicker(pickerHost, {
  initialPoint: { lat: 22.2816182, lng: 114.1655613 },
  onChange: (point) => pickerChanges.push(point),
  loadLeaflet: async () => {},
});
assert.deepEqual(pickerSetViews, [[ [22.2816182, 114.1655613], 17 ]]);
pickerMapClick({ latlng: { lat: 22.2825, lng: 114.1659 } });
assert.deepEqual(pickerChanges.at(-1), { lat: 22.2825, lng: 114.1659 });
pickerMarkerPoint = { lat: 22.2827, lng: 114.1661 };
pickerMarkerDrag();
assert.deepEqual(pickerChanges.at(-1), { lat: 22.2827, lng: 114.1661 });
pickerController.destroy();
assert.equal(pickerRemoved, 1);
globalThis.L = pickerLeafletBefore;

// Form synchronization reveals Tamar, seeds defaults, retains marker changes,
// and clears/destroys the picker after changing to an indoor venue.
const pickerForm = new HTMLFormElement();
pickerForm.dataset = { session: "wnt-2026-08-26" };
const pickerLocation = { value: "Tamar Park" };
const pickerLat = { value: "" };
const pickerLng = { value: "" };
const pickerShell = makeElement();
pickerShell.classList.toggle("hidden", true);
const pickerFormHost = makeElement();
pickerFormHost.isConnected = true;
pickerForm.querySelector = (selector) => ({
  '[name="location"]': pickerLocation,
  '[name="meetingLat"]': pickerLat,
  '[name="meetingLng"]': pickerLng,
  "[data-venue-picker-shell]": pickerShell,
  "[data-venue-picker]": pickerFormHost,
})[selector] || null;
let pickerFormChange;
let pickerFormDestroyed = 0;
let pickerInitialPoint;
assert.equal(await app.syncWeekVenuePicker(pickerForm, {
  ownsGeneration: () => true,
  loadModule: async () => ({
    mountVenuePicker: async (_host, options) => {
      pickerInitialPoint = options.initialPoint;
      pickerFormChange = options.onChange;
      return { destroy() { pickerFormDestroyed += 1; } };
    },
  }),
}), true);
assert.equal(pickerShell.classList.contains("hidden"), false);
assert.deepEqual(pickerInitialPoint, { lat: 22.2816182, lng: 114.1655613 });
assert.equal(pickerLat.value, "22.2816182");
assert.equal(pickerLng.value, "114.1655613");
pickerFormChange({ lat: 22.2825, lng: 114.1659 });
assert.equal(pickerLat.value, "22.2825");
assert.equal(pickerLng.value, "114.1659");
pickerLocation.value = "Island ECC 9/F";
assert.equal(await app.syncWeekVenuePicker(pickerForm), false);
assert.equal(pickerShell.classList.contains("hidden"), true);
assert.equal(pickerLat.value, "");
assert.equal(pickerLng.value, "");
assert.equal(pickerFormDestroyed, 1);
console.log("ok  Admin Tamar picker click, drag, default, and clear behavior");

// A rejected lazy import must settle the host on the public fallback instead
// of escaping as an unhandled rejection or leaving "Loading map…" forever.
const rejectedImportHost = {
  id: "activity-map",
  isConnected: true,
  dataset: { mapsQuery: "Causeway Bay, Hong Kong", markerLabel: "Rejected import" },
  innerHTML: "<p>Loading map…</p>",
};
const rejectedImportResult = await app.mountCommittedActivityMap(rejectedImportHost, {
  loadModule: async () => { throw new Error("simulated map import rejection"); },
});
assert.equal(rejectedImportResult, false, "a rejected map import must resolve to false");
assert.match(rejectedImportHost.innerHTML, /Couldn.t find the venue on the map/);
assert.doesNotMatch(rejectedImportHost.innerHTML, /Loading map/);
console.log("ok  app-relative map import resolves and import rejection renders fallback");

// A failed ECC guide image must be replaced with the generic map host while
// route ownership is current; stale routes must leave their figure untouched.
let venueImageError;
let replacedVenueFigure = null;
let mountedFallbackHost = null;
const venueFigure = {
  replaceWith(node) { replacedVenueFigure = node; },
};
const venueImage = {
  dataset: { fallbackQuery: "Island ECC" },
  isConnected: true,
  closest: () => venueFigure,
  addEventListener(type, callback) {
    if (type === "error") venueImageError = callback;
  },
};
assert.equal(app.mountVenueImageFallback(venueImage, {
  mountMap: async (host) => { mountedFallbackHost = host; return true; },
}), true);
assert.equal(replacedVenueFigure, null);
await venueImageError();
assert.ok(replacedVenueFigure, "image error must replace the guide figure");
assert.equal(mountedFallbackHost?.dataset?.mapsQuery, "Island ECC");

let noQueryError;
let noQueryRemoved = false;
const noQueryImage = {
  dataset: { fallbackQuery: "" },
  isConnected: true,
  closest: () => ({ remove() { noQueryRemoved = true; } }),
  addEventListener(type, callback) { if (type === "error") noQueryError = callback; },
};
assert.equal(app.mountVenueImageFallback(noQueryImage), true);
noQueryError();
assert.equal(noQueryRemoved, true, "failed guide without a map query must be removed");

let detailPhotoError;
let detailPhotoSrc = "/assets/itc/missing-hyrox.webp";
let detailPhotoRemoved = false;
const detailPhoto = {
  dataset: { photoFallback: "/assets/itc/hyrox.webp" },
  isConnected: true,
  getAttribute(name) { return name === "src" ? detailPhotoSrc : null; },
  set src(value) { detailPhotoSrc = value; },
  remove() { detailPhotoRemoved = true; },
  addEventListener(type, callback) { if (type === "error") detailPhotoError = callback; },
};
assert.equal(app.mountDetailPhotoFallback(detailPhoto), true);
detailPhotoError();
assert.equal(detailPhotoSrc, "/assets/itc/hyrox.webp", "failed HYROX image must retry the root asset");
detailPhotoError();
assert.equal(detailPhotoRemoved, true, "a failed HYROX fallback must not remain broken");
console.log("ok  HYROX detail photo retries a root asset fallback");

let staleReplaced = false;
let staleImageError;
const staleImage = {
  dataset: { fallbackQuery: "Island ECC" },
  isConnected: true,
  closest: () => ({ replaceWith() { staleReplaced = true; } }),
  addEventListener(type, callback) { if (type === "error") staleImageError = callback; },
};
assert.equal(app.mountVenueImageFallback(staleImage, {
  ownsGeneration: () => false,
}), false);
assert.equal(staleImageError, undefined);
assert.equal(staleReplaced, false);
console.log("ok  ECC guide failure falls back to map only for the current route");

// Mount contract: stale activity hosts must not be remounted after navigation.
let lateMounted = false;
const lateMap = await import("./js/map.js");
globalThis.window.__lateMapLoader = () => {
  lateMounted = true;
  return Promise.resolve();
};
const lateHost = {
  id: "activity-map",
  isConnected: false,
  dataset: { mapsQuery: "Causeway Bay, Hong Kong", markerLabel: "Late" },
  innerHTML: "<p>Loading\u2026</p>",
};
const lateResult = await lateMap.mountActivityMap(lateHost, {
  ownsGeneration: () => false,
  fetchImpl: async () => ({ ok: true, json: async () => [] }),
  loadLeaflet: globalThis.window.__lateMapLoader,
});
if (lateResult !== false) {
  throw new Error("stale activity host must resolve to false");
}
if (lateMounted) {
  throw new Error("stale activity host must not load Leaflet");
}
console.log("ok  inline map mount respects stale generation ownership");

// Manual HYROX replacement RPC bridge: hashes stay client-side and live
// mutations cache only redacted request metadata after authoritative refresh.
const replacementBaseHandler = operationalRpcHandler;
const replacementCalls = [];
let replacementListRowsOverride = null;
let replacementRow = {
  requestId: "replacement-request-1",
  bookingId: "island-ecc-booking",
  status: "pending",
  originalDisplayName: "Payer Member",
  replacementDisplayName: null,
  sessionId: islandEccSessionId,
  snapshot: { name: "ITC HYROX", kind: "paid", dateISO: normalWeeklyFixtureDates[0], time: "10:30" },
  createdAt: "2098-12-31T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
operationalRpcHandler = (name, args) => {
  if (!name.includes("replacement")) return replacementBaseHandler(name, args);
  replacementCalls.push({ name, args: structuredClone(args) });
  if (name === "admin_decide_operational_replacement") {
    return Promise.resolve({ data: null, error: { message: "replacement decision unavailable" } });
  }
  if (name === "list_operational_replacement_requests") {
    return Promise.resolve({ data: replacementListRowsOverride || [{
      ...replacementRow,
      requestId: "retired-replacement-request",
      bookingId: "historical-retired-replacement-booking",
      sessionId: "historical-retired-replacement-session",
    }, {
      ...replacementRow,
      requestId: "historical-ecc-replacement-request",
      bookingId: "historical-ecc-replacement-booking",
      sessionId: "historical-ecc-replacement-session",
    }], error: null });
  }
  if (name === "accept_operational_replacement_request") {
    replacementRow = { ...replacementRow, status: "accepted", replacementDisplayName: "Friend Member" };
  }
  return Promise.resolve({ data: replacementRow, error: null });
};
const replacementHash = await operations.hashReplacementToken("invite-token");
assert.equal(
  replacementHash,
  "f9e3c47d452a8fab2dc56ef07d766534cb2cd31c5f63de7107412acc65daa5b8",
  "replacement token hashing must use SHA-256",
);
const replacementExpiry = Date.parse("2099-01-01T00:00:00.000Z");
const createdReplacement = await operations.liveCreateReplacementRequest(
  "island-ecc-booking", replacementHash, replacementExpiry
);
assert.equal(createdReplacement.status, "pending");
assert.deepEqual(replacementCalls.at(-1), {
  name: "create_operational_replacement_request",
  args: {
    p_booking_id: "island-ecc-booking",
    p_token_hash: replacementHash,
    p_expires_at: "2099-01-01T00:00:00.000Z",
  },
});
const invite = await operations.liveReplacementInvite(replacementHash);
assert.equal(invite.originalDisplayName, "Payer Member");
assert.equal(invite.tokenHash, undefined, "live invite mapping must omit token hashes");
const acceptedReplacement = await operations.liveAcceptReplacement(replacementHash);
assert.equal(acceptedReplacement.status, "accepted");
const replacementRelationshipQueryCount = operationalSessionQueries.length;
const listedReplacements = await operations.liveListReplacementRequests();
assert.equal(listedReplacements.length, 1,
  "out-of-horizon retired replacement requests must not enter the live cache");
assert.equal(listedReplacements[0].requestId, "historical-ecc-replacement-request",
  "a same-shape out-of-horizon Island ECC replacement must remain active");
assert.equal(listedReplacements[0].status, "accepted");
assert.ok(operationalSessionQueries.slice(replacementRelationshipQueryCount).some((query) =>
  query.ids?.includes("historical-retired-replacement-session")
  && query.ids?.includes("historical-ecc-replacement-session")
), "replacement session relationships must be fetched by canonical session ID");
assert.equal("tokenHash" in listedReplacements[0], false, "Admin replacement rows must not expose token hashes");
assert.equal("email" in listedReplacements[0], false, "Admin replacement rows must not expose contact fields");
assert.equal("paymentReference" in listedReplacements[0], false, "Admin replacement rows must not expose payment references");
assert.equal("paymentReference" in (listedReplacements[0].snapshot || {}), false, "Admin replacement snapshots must be redacted");
await assert.rejects(
  () => operations.liveDecideReplacement("replacement-request-1", true, ""),
  /replacement decision unavailable/,
);
assert.equal(
  operations.liveReplacementRequestForBooking("historical-ecc-replacement-booking").status,
  "accepted",
  "failed live replacement mutations must not overwrite the filtered active cache",
);
const olderSameBookingRequest = {
  ...replacementRow,
  requestId: "older-same-booking-request",
  bookingId: "same-booking-history",
  sessionId: "historical-ecc-replacement-session",
  status: "rejected",
  createdAt: "2026-05-01T00:00:00.000Z",
};
replacementListRowsOverride = [olderSameBookingRequest];
await operations.liveListReplacementRequests();
replacementRow = {
  ...replacementRow,
  requestId: "newer-same-booking-request",
  bookingId: olderSameBookingRequest.bookingId,
  sessionId: "post-success-ecc-replacement-session",
  status: "accepted",
  createdAt: "2026-06-01T00:00:00.000Z",
};
operationalSessionRelationshipReadErrors.set(
  replacementRow.sessionId,
  { message: "newer same-booking relationship unavailable" },
);
await operations.liveAcceptReplacement(replacementHash);
assert.equal(
  operations.liveReplacementRequestForBooking(olderSameBookingRequest.bookingId)?.requestId,
  olderSameBookingRequest.requestId,
  "failed enrichment for a new request must preserve older same-booking history",
);
replacementListRowsOverride = null;

for (const mutation of ["create", "accept"]) {
  replacementRow = {
    ...replacementRow,
    requestId: `post-success-${mutation}-request`,
    bookingId: `post-success-${mutation}-booking`,
    sessionId: "post-success-ecc-replacement-session",
    status: mutation === "create" ? "pending" : "accepted",
  };
  operationalSessionRelationshipReadErrors.set(
    "post-success-ecc-replacement-session",
    { message: `post-success ${mutation} relationship unavailable` },
  );
  const result = mutation === "create"
    ? await operations.liveCreateReplacementRequest(
      replacementRow.bookingId, replacementHash, replacementExpiry
    )
    : await operations.liveAcceptReplacement(replacementHash);
  assert.deepEqual(result, {
    requestId: replacementRow.requestId,
    status: replacementRow.status,
    cachePending: true,
  }, `successful replacement ${mutation} must return a safe authoritative result`);
  assert.equal(operations.liveReplacementRequestForBooking(replacementRow.bookingId), null,
    `unresolved successful replacement ${mutation} data must not enter the cache`);
}
operationalSessionRelationshipReadErrors.delete("post-success-ecc-replacement-session");
replacementRow = {
  ...replacementRow,
  requestId: "nonpool-cycle-ecc-request",
  bookingId: "nonpool-cycle-ecc-booking",
  cycleId: "island-ecc-cycle-2099-01-03",
  sessionId: "post-success-ecc-replacement-session",
  status: "accepted",
};
const nonpoolCycleResult = await operations.liveAcceptReplacement(replacementHash);
assert.equal(nonpoolCycleResult.requestId, replacementRow.requestId,
  "an Island ECC replacement with a non-pool cycle ID must remain active");
assert.equal(nonpoolCycleResult.status, "accepted");
assert.equal(nonpoolCycleResult.retired, undefined);
replacementRow = {
  ...replacementRow,
  requestId: "retired-response-secret-request",
  bookingId: "retired-response-booking",
  cycleId: "hyrox-pool-2099-01-03",
  sessionId: "retired-response-unknown-session",
  status: "accepted",
};
const retiredResponseQueryCount = operationalSessionQueries.length;
const retiredMutationResult = await operations.liveAcceptReplacement(replacementHash);
assert.deepEqual(retiredMutationResult, { retired: true },
  "explicitly retired mutation responses must return only a retirement marker");
assert.equal("requestId" in retiredMutationResult, false);
assert.equal("status" in retiredMutationResult, false);
assert.equal(operationalSessionQueries.slice(retiredResponseQueryCount).some((query) =>
  query.ids?.includes(replacementRow.sessionId)), false,
  "an explicit retired cycle relationship must not require session enrichment");
assert.equal(operations.liveReplacementRequestForBooking(replacementRow.bookingId), null,
  "explicitly retired mutation responses must stay out of cache");
console.log("ok  live HYROX replacement hashing, RPC payloads, redaction, and failure preservation");
