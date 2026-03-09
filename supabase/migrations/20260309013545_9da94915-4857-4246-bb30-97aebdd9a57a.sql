
-- ── 1. Fix RLS policies on generations to restrict to authenticated role ──
DROP POLICY IF EXISTS "Users can view own generations" ON public.generations;
DROP POLICY IF EXISTS "Users can insert own generations" ON public.generations;

CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
  ON public.generations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── 2. Fix RLS policies on prompt_conversations to restrict to authenticated role ──
DROP POLICY IF EXISTS "Users can view own conversations" ON public.prompt_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.prompt_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.prompt_conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON public.prompt_conversations;

CREATE POLICY "Users can view own conversations"
  ON public.prompt_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.prompt_conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.prompt_conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.prompt_conversations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. Harden handle_new_user trigger: add input length limits and error handling ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, avatar_url, email)
    VALUES (
      NEW.id,
      SUBSTRING(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), 1, 255),
      SUBSTRING(NEW.raw_user_meta_data->>'avatar_url', 1, 500),
      SUBSTRING(NEW.email, 1, 255)
    );
  EXCEPTION
    WHEN others THEN
      RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
