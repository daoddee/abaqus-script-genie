
-- Generations tracking table
CREATE TABLE public.generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT,
  prompt_hash TEXT NOT NULL,
  raw_prompt TEXT,
  script_hash TEXT,
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT false,
  issues TEXT[],
  template_id TEXT,
  analysis_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
  ON public.generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_generations_user_id ON public.generations(user_id);
CREATE INDEX idx_generations_created_at ON public.generations(created_at DESC);

-- Audit events table
CREATE TABLE public.audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  event_type TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Only service role can insert audit events (from edge functions)
-- No user-facing read policy needed
CREATE POLICY "Service role can manage audit events"
  ON public.audit_events FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX idx_audit_events_type ON public.audit_events(event_type);
CREATE INDEX idx_audit_events_created_at ON public.audit_events(created_at DESC);
