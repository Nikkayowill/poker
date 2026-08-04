-- M16: the one friend mutation that cannot be two round trips.
--
-- Accepting a request is two writes -- settle the request row, insert the
-- friendship -- and they have to be one unit. Split across two PostgREST
-- calls, a failure between them leaves a request marked accepted with no
-- friendship behind it, which no later call can detect: the request is no
-- longer pending, so a retry finds nothing to do and the two players are
-- permanently "accepted but not friends".
--
-- Everything else in this feature is a single statement whose correctness the
-- indexes in 20260804120000_friends_and_table_invites.sql already own, so
-- this is the only RPC the friends slice adds.

/**
 * Accepts a pending friend request on behalf of its addressee.
 *
 * Returns true only when this call is the one that accepted it. False covers
 * every ordinary way there is nothing to accept -- already settled, not
 * pending, not addressed to this caller, or blocked -- because all of those
 * are states the UI renders, not failures worth raising.
 */
create or replace function public.accept_friend_request(
  p_request_id uuid,
  p_addressee_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requester_id uuid;
  -- One timestamp for the settled request and the friendship it creates, so
  -- "responded at" and "friends since" cannot disagree.
  v_now timestamptz := now();
begin
  -- FOR UPDATE is what serializes two concurrent accepts of the same request.
  -- The loser blocks here, then re-reads a row that is no longer pending and
  -- falls through to `return false` -- rather than both proceeding to insert
  -- the same friendship, where only the primary key would stop them.
  --
  -- The addressee_id predicate is authorization, not a filter: a requester who
  -- learned their own request id must not be able to accept it for the other
  -- party.
  select requester_id into v_requester_id
    from public.friend_requests
   where id = p_request_id
     and addressee_id = p_addressee_id
     and status = 'pending'
   for update;

  if v_requester_id is null then
    return false;
  end if;

  -- A block placed after the request was sent has to win. Settling the row as
  -- declined rather than leaving it pending matters: profile_blocks is checked
  -- when sending, so a request left pending here would be un-actionable
  -- forever and would keep occupying the one-pending-per-pair slot.
  if exists (
    select 1 from public.profile_blocks
     where (blocker_id = v_requester_id and blocked_id = p_addressee_id)
        or (blocker_id = p_addressee_id and blocked_id = v_requester_id)
  ) then
    update public.friend_requests
       set status = 'declined', responded_at = v_now
     where id = p_request_id;
    return false;
  end if;

  update public.friend_requests
     set status = 'accepted', responded_at = v_now
   where id = p_request_id;

  -- least/greatest is the canonical ordering friendships_canonical_order
  -- demands. Doing it here rather than in the caller is deliberate: it is the
  -- kind of invariant that survives exactly as long as every writer remembers
  -- it, and this function is the only writer.
  insert into public.friendships (profile_a, profile_b, created_at)
  values (
    least(v_requester_id, p_addressee_id),
    greatest(v_requester_id, p_addressee_id),
    v_now
  )
  -- Re-accepting a pair who are already friends -- possible if they unfriended
  -- and a stale request survived -- is a no-op, not an error.
  on conflict (profile_a, profile_b) do nothing;

  return true;
end;
$$;

-- PUBLIC first, and it is the one that matters. Postgres grants EXECUTE on a
-- new function to PUBLIC by default, which anon and authenticated inherit --
-- so revoking from those two roles alone leaves the default grant intact and
-- the function still callable by every role.
revoke all on function public.accept_friend_request(uuid, uuid) from public;
revoke all on function public.accept_friend_request(uuid, uuid) from anon, authenticated;
