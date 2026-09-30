-- Include shared community announcements in web push.
-- Audit rows (community_announcement_audit) stay inbox-only.
-- Replaces web_push_ops_kind_eligible; does not edit applied migrations.

create or replace function public.web_push_ops_kind_eligible(p_kind text, p_title text)
returns boolean
language sql
immutable
as $$
  select case
    when p_kind in (
      'operational_booking_reserved',
      'operational_rsvp_confirmed',
      'operational_payment_approved',
      'operational_session_deferred',
      'operational_session_cancelled',
      'operational_session_cancelled_no_defer',
      'community_announcement_published'
    ) then true
    when p_kind = 'operational_session_venue_updated'
      and p_title in ('Venue confirmed', 'Venue updated') then true
    else false
  end;
$$;

comment on function public.web_push_ops_kind_eligible(text, text) is
  'Web push allowlist: booking/payment/venue shared rows and community_announcement_published. Excludes venue audit and community_announcement_audit.';
