
-- Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Update the handle_new_user trigger to also save email
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );
  RETURN NEW;
END;
$function$;

-- Backfill email for existing profiles from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.user_id = u.id AND p.email IS NULL;
