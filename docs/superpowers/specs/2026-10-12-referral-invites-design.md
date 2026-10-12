# Referral Invites Design

Date: 2026-10-12

## Purpose

Approved ITC members, Admins, and Super Admins can refer new people to ITC through a single-use private link. Each referrer may have no more than three accepted referrals in a Hong Kong calendar month and no more than three active pending invites.

A referral records who invited the applicant, but it does not bypass the existing membership application or Admin approval process. Payment is not involved.

## Product Rules

- Referral creation is available from **Profile → Refer a friend**.
- Only approved Members, Admins, and Super Admins may create invites.
- Visitors and pending applicants cannot create invites.
- Each invite is a single-use private link suitable for sharing through WhatsApp or another external channel.
- An unused invite expires after 7 days.
- A referrer may have at most 3 active pending invites.
- A referral counts only after the invitee signs in or creates an account and explicitly clicks **Accept invitation**.
- Accepted referrals count against the referrer's Asia/Hong_Kong calendar month.
- An accepted referral remains consumed if the application is abandoned or declined.
- An invitee who already has an ITC profile or application cannot accept a referral.
- The invite page identifies the referrer by preferred name only.
- Acceptance leads into the normal membership application flow.
- The applicant can resume an abandoned application without receiving another invite.
- Admins see `Referred by [preferred name]` and the acceptance date in the approval queue.
- Admins cannot manually adjust quotas in this version.

## Data Model

Add a dedicated referral workflow rather than storing referral state only on applications.

`referral_invites` tracks:

- referrer profile ID
- secure invite token hash
- status: `pending`, `accepted`, `expired`, or `cancelled`
- creation and expiry timestamps
- invitee profile ID after acceptance
- acceptance timestamp
- linked application ID
- audit timestamps and actor IDs

The raw invite token is returned only when the invite is created. Persistent storage and lookups use its hash. The local prototype mirrors the same records in `store.js` and bumps the persisted state version with a migration that initializes an empty referral collection.

## Enforcement

All mutation rules are enforced by the store seam and, in live mode, by Supabase RPCs:

- create an invite
- inspect an invite by token hash
- accept an invite
- cancel a pending invite
- expire stale pending invites
- list the current member's referral history
- list referral context for Admin review

Creation and acceptance are atomic. Acceptance checks the monthly quota, active-invite limit, invite expiry, single-use state, and invitee eligibility before writing the accepted record. Two people cannot claim the same invite, and the same person cannot consume multiple referral slots.

Pending invites are marked expired by the expiry operation and deleted after 30 days. Accepted records are retained for monthly quota enforcement and audit history. Cancelled records are retained for 30 days and then deleted.

## Member Experience

**Profile → Refer a friend** shows:

- `N of 3 referrals used this month`
- `N of 3 active invites`
- a disabled explanation when either limit is reached
- a create-invite action
- copy/share controls for each active link
- expiry dates and accepted/expired/cancelled history

The invite page shows the referrer's preferred name, explains that acceptance starts the normal application, and requires an explicit acceptance action after sign-in.

## Admin Experience

The existing approval queue gains referral context for each referred applicant:

- referrer's preferred name
- acceptance date
- referral status

Approval, decline, and role behavior remain unchanged. Referral context is informational and auditable.

## Testing

Cover both local and live seams:

- role and approval gates
- token hashing and single-use acceptance
- 7-day expiry and cleanup
- 3 active pending invites
- 3 accepted referrals per Hong Kong calendar month
- existing profile/application rejection
- abandoned and declined applications retaining the consumed slot
- application resumption without another invite
- Admin queue referral display
- migration of existing local state without data loss

## Out of Scope

- Referral rewards, discounts, or payments
- Manual Admin quota adjustments
- Referral codes in addition to links
- Public referrer profile photos or contact details
- Bypassing membership screening or approval
