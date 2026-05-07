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

-- ═══════════════════════════════════════════════════════════════
-- NEUCORE — 3D Body Assessment & Gait Phase Tables
-- Run after the Phase 3 tables above. Column names match
-- exactly what dashboard.js _saveToSupabase() inserts.
-- ═══════════════════════════════════════════════════════════════

-- 3D body map state per assessment
CREATE TABLE IF NOT EXISTS body_map_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id    uuid REFERENCES assessments(id) ON DELETE SET NULL,
  joint_data       jsonb  DEFAULT '{}',
  animation_state  text   DEFAULT 'idle',
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS body_map_states_assessment_uidx
  ON body_map_states(assessment_id) WHERE assessment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS body_map_states_client_idx ON body_map_states(client_id);

-- Gait phase analysis results
CREATE TABLE IF NOT EXISTS gait_assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id       uuid REFERENCES assessments(id) ON DELETE SET NULL,
  phase_deficiencies  jsonb  DEFAULT '{}',
  symmetry_index      int    DEFAULT 100,
  worst_case_scenario text,
  exercise_priorities jsonb  DEFAULT '[]',
  chain_reactions     jsonb  DEFAULT '[]',
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gait_assessments_client_idx     ON gait_assessments(client_id);
CREATE INDEX IF NOT EXISTS gait_assessments_assessment_idx ON gait_assessments(assessment_id);

-- Objective rehab assessment — all columns match dashboard.js insert
CREATE TABLE IF NOT EXISTS rehab_objective_assessments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id          uuid REFERENCES assessments(id) ON DELETE CASCADE,
  coach_id               uuid REFERENCES auth.users(id),
  client_id              uuid REFERENCES profiles(id),
  session_date           date DEFAULT CURRENT_DATE,

  toe_touch_score        int,
  ankle_df_left_cm       numeric(5,1),  ankle_df_right_cm      numeric(5,1),
  ankle_pronation_left   text,          ankle_pronation_right  text,
  ankle_supination_left  text,          ankle_supination_right text,

  tibia_ir_left          int,           tibia_ir_right         int,

  hip_ir_left            int,           hip_ir_right           int,
  hip_er_left            int,           hip_er_right           int,
  hip_flexion_left       int,           hip_flexion_right      int,
  hip_extension_left     int,           hip_extension_right    int,
  hip_abduction_left     int,           hip_abduction_right    int,

  spine_flexion_pain     boolean DEFAULT false,
  spine_extension_pain   boolean DEFAULT false,
  spine_lat_flex_l_pain  boolean DEFAULT false,
  spine_lat_flex_r_pain  boolean DEFAULT false,
  spine_rot_l_pain       boolean DEFAULT false,
  spine_rot_r_pain       boolean DEFAULT false,

  shoulder_flexion_left    int,           shoulder_flexion_right   int,
  shoulder_extension_left  int,           shoulder_extension_right int,
  shoulder_ir_left         int,           shoulder_ir_right        int,
  shoulder_er_left         int,           shoulder_er_right        int,

  sl_squat_left_score    int CHECK (sl_squat_left_score  BETWEEN 0 AND 3),
  sl_squat_right_score   int CHECK (sl_squat_right_score BETWEEN 0 AND 3),
  sl_rdl_left_score      int CHECK (sl_rdl_left_score    BETWEEN 0 AND 3),
  sl_rdl_right_score     int CHECK (sl_rdl_right_score   BETWEEN 0 AND 3),
  oh_squat_score         int CHECK (oh_squat_score       BETWEEN 0 AND 3),

  sl_balance_eo_left     int,           sl_balance_eo_right    int,
  sl_balance_ec_left     int,           sl_balance_ec_right    int,
  sl_reach_left          int,           sl_reach_right         int,

  rom_score              numeric(5,1),  control_score          numeric(5,1),
  force_score            numeric(5,1),  neurology_score        numeric(5,1),
  composite_score        numeric(5,1),
  phase_recommendation   text,
  referral_required      boolean DEFAULT false,
  pain_flags             text[]  DEFAULT '{}',
  asymmetry_flags        text[]  DEFAULT '{}',
  gait_flags             text[]  DEFAULT '{}',

  created_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roa_assessment_idx ON rehab_objective_assessments(assessment_id);
CREATE INDEX IF NOT EXISTS roa_client_idx     ON rehab_objective_assessments(client_id);

-- Generated programs
CREATE TABLE IF NOT EXISTS programs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id       uuid REFERENCES auth.users(id),
  assessment_id  uuid REFERENCES assessments(id) ON DELETE SET NULL,
  phase          text,
  structure      jsonb  DEFAULT '{}',
  daily_routine  jsonb  DEFAULT '{}',
  rules_applied  text[] DEFAULT '{}',
  artifact_html  text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS programs_client_idx ON programs(client_id);
CREATE INDEX IF NOT EXISTS programs_coach_idx  ON programs(coach_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE body_map_states             ENABLE ROW LEVEL SECURITY;
ALTER TABLE gait_assessments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehab_objective_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs                    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bms_client_own"   ON body_map_states;
DROP POLICY IF EXISTS "bms_coach_access" ON body_map_states;
CREATE POLICY "bms_client_own" ON body_map_states
  FOR ALL USING (client_id = auth.uid());
CREATE POLICY "bms_coach_access" ON body_map_states
  FOR ALL USING (
    EXISTS (SELECT 1 FROM assessments a
            WHERE a.id = assessment_id AND a.coach_id = auth.uid())
  );

DROP POLICY IF EXISTS "ga_client_own"   ON gait_assessments;
DROP POLICY IF EXISTS "ga_coach_access" ON gait_assessments;
CREATE POLICY "ga_client_own" ON gait_assessments
  FOR ALL USING (client_id = auth.uid());
CREATE POLICY "ga_coach_access" ON gait_assessments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM assessments a
            WHERE a.id = assessment_id AND a.coach_id = auth.uid())
  );

DROP POLICY IF EXISTS "roa_access" ON rehab_objective_assessments;
CREATE POLICY "roa_access" ON rehab_objective_assessments
  FOR ALL USING (
    coach_id = auth.uid()
    OR client_id = auth.uid()
    OR EXISTS (SELECT 1 FROM assessments a
               WHERE a.id = assessment_id
                 AND (a.coach_id = auth.uid() OR a.client_id = auth.uid()))
  );

DROP POLICY IF EXISTS "programs_access" ON programs;
CREATE POLICY "programs_access" ON programs
  FOR ALL USING (coach_id = auth.uid() OR client_id = auth.uid());

-- Auto-update body_map_states.updated_at
CREATE OR REPLACE FUNCTION update_body_map_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bms_updated_at ON body_map_states;
CREATE TRIGGER bms_updated_at
  BEFORE UPDATE ON body_map_states
  FOR EACH ROW EXECUTE FUNCTION update_body_map_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- NEUCORE MASTER PROMPT — Step 2 additions
-- ═══════════════════════════════════════════════════════════════

-- Add muscle activation + simulation columns to gait_assessments
ALTER TABLE gait_assessments
  ADD COLUMN IF NOT EXISTS muscle_activation_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS client_kinematics       jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS simulation_deficits     jsonb DEFAULT '[]';
