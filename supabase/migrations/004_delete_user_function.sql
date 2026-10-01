-- Captured from the live database on 2026-09-29.
-- RPC called by settings.js to let a user delete their own account.
-- SECURITY DEFINER so it can delete from auth.users, but every statement is
-- scoped to auth.uid(), so a caller can only ever delete their OWN data.

CREATE OR REPLACE FUNCTION public.delete_user()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  delete from public.applications where user_id = auth.uid();
  delete from public.profiles     where id      = auth.uid();
  delete from auth.users          where id      = auth.uid();
$function$;
