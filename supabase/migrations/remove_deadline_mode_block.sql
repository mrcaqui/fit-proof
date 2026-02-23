-- 既存の 'block' 値を 'mark' に変換（既存データの互換性確保）
UPDATE profiles SET deadline_mode = 'mark' WHERE deadline_mode = 'block';

-- CHECK制約を差し替える
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_deadline_mode_check,
  ADD CONSTRAINT profiles_deadline_mode_check CHECK (deadline_mode IN ('none', 'mark'));
