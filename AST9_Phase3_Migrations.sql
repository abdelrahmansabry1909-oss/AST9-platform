-- ═══════════════════════════════════════════════════════════════
-- AST9 Health Hub — Phase 3 Database Migrations
-- Run this in Supabase SQL Editor (new query)
-- ═══════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- COMMUNITY FEATURES
-- ═══════════════════════════════════════════════════════════════

-- Coach peer messaging
CREATE TABLE IF NOT EXISTS coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT no_self_message CHECK (sender_id != receiver_id)
);

-- Coach specialty groups
CREATE TABLE IF NOT EXISTS coach_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coach_group_members (
  group_id uuid REFERENCES coach_groups(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, coach_id)
);

-- Client referrals between coaches
CREATE TABLE IF NOT EXISTS client_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_coach_id uuid REFERENCES auth.users(id),
  to_coach_id uuid REFERENCES auth.users(id),
  client_id uuid REFERENCES profiles(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','completed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz
);

-- Case study sharing (anonymized)
CREATE TABLE IF NOT EXISTS case_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES auth.users(id),
  title text NOT NULL,
  description text,
  anonymized_data jsonb DEFAULT '{}',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Client community posts
CREATE TABLE IF NOT EXISTS client_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  type text DEFAULT 'progress' CHECK (type IN ('progress','question','support','milestone')),
  created_at timestamptz DEFAULT now()
);

-- Comments on client posts
CREATE TABLE IF NOT EXISTS client_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES client_posts(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id),
  author_role text DEFAULT 'client' CHECK (author_role IN ('client','coach','admin')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Client support groups
CREATE TABLE IF NOT EXISTS client_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  focus_area text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_group_members (
  group_id uuid REFERENCES client_groups(id) ON DELETE CASCADE,
  client_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, client_id)
);

-- Privacy settings per user
CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  share_progress boolean DEFAULT false,
  share_posts boolean DEFAULT true,
  allow_comments boolean DEFAULT true,
  visible_to text DEFAULT 'coach_only' CHECK (visible_to IN ('public','coach_only','private')),
  updated_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- EXERCISE LIBRARY
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text CHECK (category IN ('Rehab','Mobility','Strength','Neurology','Breathing')),
  phase text CHECK (phase IN ('Phase 1','Phase 2','Phase 3')),
  video_url text,
  thumbnail_url text,
  cues text,
  common_errors text,
  progressions text,
  regressions text,
  tags text[] DEFAULT '{}',
  target_joints text[] DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercise_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_playlist_id text NOT NULL,
  name text,
  phase_mapping text CHECK (phase_mapping IN ('Phase 1','Phase 2','Phase 3','All')),
  auto_sync boolean DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- PROGRESS VISUALIZATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS progress_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES assessments(id),
  session_date date DEFAULT CURRENT_DATE,
  rom_score numeric(5,1),
  control_score numeric(5,1),
  force_score numeric(5,1),
  neurology_score numeric(5,1),
  composite_score numeric(5,1),
  phase text,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) — ENABLE + POLICIES
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS on all new tables
ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_snapshots ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION Auth.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION Auth.is_coach()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'coach'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION Auth.is_coach_or_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role IN ('coach','admin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Coach messages: participants only
CREATE POLICY "coach_messages_participants" ON coach_messages
  FOR ALL USING (auth.uid() IN (sender_id, receiver_id));

-- Coach groups: members can see their groups
CREATE POLICY "coach_groups_members" ON coach_groups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM coach_group_members WHERE group_id = id AND coach_id = auth.uid())
    OR Auth.is_admin()
  );

CREATE POLICY "coach_groups_create" ON coach_groups
  FOR ALL USING (Auth.is_coach_or_admin());

-- Coach group members: visible to group members
CREATE POLICY "coach_group_members_visible" ON coach_group_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM coach_group_members cgm WHERE cgm.group_id = group_id AND cgm.coach_id = auth.uid())
    OR Auth.is_admin()
  );

-- Client referrals: involved coaches + admin
CREATE POLICY "referral_participants" ON client_referrals
  FOR ALL USING (
    auth.uid() IN (from_coach_id, to_coach_id) OR Auth.is_admin()
  );

-- Case shares: all coaches read, author edits
CREATE POLICY "case_shares_read" ON case_shares
  FOR SELECT USING (Auth.is_coach_or_admin());

CREATE POLICY "case_shares_edit" ON case_shares
  FOR ALL USING (auth.uid() = coach_id OR Auth.is_admin());

-- Client posts: visibility controlled by privacy + ownership
CREATE POLICY "client_posts_select" ON client_posts
  FOR SELECT USING (
    auth.uid() = client_id OR
    Auth.is_admin() OR
    EXISTS (
      SELECT 1 FROM privacy_settings ps
      WHERE ps.user_id = client_posts.client_id
      AND (
        ps.visible_to = 'public' OR 
        (ps.visible_to = 'coach_only' AND Auth.is_coach())
      )
    )
  );

CREATE POLICY "client_posts_insert" ON client_posts
  FOR INSERT WITH CHECK (auth.uid() = client_id);

CREATE POLICY "client_posts_update" ON client_posts
  FOR UPDATE USING (auth.uid() = client_id);

CREATE POLICY "client_posts_delete" ON client_posts
  FOR DELETE USING (auth.uid() = client_id OR Auth.is_admin());

-- Comments: authors + post owners + coaches on their clients
CREATE POLICY "comments_access" ON client_comments
  FOR ALL USING (
    auth.uid() = author_id OR
    auth.uid() IN (SELECT client_id FROM client_posts WHERE id = post_id) OR
    Auth.is_admin()
  );

-- Client groups: all can see, members can post
CREATE POLICY "client_groups_public" ON client_groups
  FOR SELECT USING (true);

-- Client group members: own records
CREATE POLICY "client_group_members_own" ON client_group_members
  FOR ALL USING (auth.uid() = client_id);

-- Privacy settings: own only
CREATE POLICY "privacy_own" ON privacy_settings
  FOR ALL USING (auth.uid() = user_id);

-- Exercises: coaches can CRUD, clients can read
CREATE POLICY "exercises_coach_crud" ON exercises
  FOR ALL USING (Auth.is_coach_or_admin());

CREATE POLICY "exercises_client_read" ON exercises
  FOR SELECT USING (true);

-- Exercise playlists: coaches only
CREATE POLICY "playlists_coach" ON exercise_playlists
  FOR ALL USING (Auth.is_coach_or_admin());

-- Progress snapshots: own + coach + admin
CREATE POLICY "progress_own" ON progress_snapshots
  FOR ALL USING (
    auth.uid() = client_id OR
    Auth.is_admin() OR
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = progress_snapshots.client_id 
      AND p.assigned_coach = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- INDEXES (Performance)
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_coach_messages_sender ON coach_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_coach_messages_receiver ON coach_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_coach_messages_created ON coach_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_from ON client_referrals(from_coach_id);
CREATE INDEX IF NOT EXISTS idx_referrals_to ON client_referrals(to_coach_id);
CREATE INDEX IF NOT EXISTS idx_referrals_client ON client_referrals(client_id);
CREATE INDEX IF NOT EXISTS idx_case_shares_coach ON case_shares(coach_id);
CREATE INDEX IF NOT EXISTS idx_client_posts_client ON client_posts(client_id);
CREATE INDEX IF NOT EXISTS idx_client_posts_type ON client_posts(type);
CREATE INDEX IF NOT EXISTS idx_client_comments_post ON client_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_exercises_phase ON exercises(phase);
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercises_tags ON exercises USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_progress_client ON progress_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_progress_date ON progress_snapshots(session_date);

-- ═══════════════════════════════════════════════════════════════
-- TRIGGERS (Auto-update timestamps)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER privacy_settings_updated
  BEFORE UPDATE ON privacy_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA (Default privacy settings for existing users)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO privacy_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM privacy_settings)
ON CONFLICT DO NOTHING;
