# DB設計：病棟シフト作成アプリ

作成日: 2026-04-06  
DB: Supabase (PostgreSQL)

---

## ER図（概要）

```
users
 └── staff_profiles ──┬── staff_skills ── skills
                      └── leave_requests
                      └── shift_assignments ── shifts（生成結果）
                                                └── schedule_months（月次ヘッダー）

shift_types（シフト種別マスタ）
shift_constraints（勤務制約マスタ）
skill_shift_requirements（シフト別スキル要件）
```

---

## テーブル定義

### 1. users（認証・アカウント）
Supabase Auth と連携。管理者のみが使用するシングルロール構成。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | auth.users.id と一致 |
| created_at | timestamptz | 作成日時 |

※ スタッフはアプリにログインしない。管理者（師長）のみが使用する。

---

### 2. staff_profiles（スタッフ情報）
条件 a: スタッフ情報（管理者が登録・管理する）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 氏名 |
| employment_type | text | `full_time` / `part_time` / `dispatch` |
| max_hours_per_month | int | 月間最大勤務時間 |
| max_night_shifts | int | 月間最大夜勤回数 |
| experience_years | int | 経験年数（スキルバランス判定に使用） |
| is_active | bool DEFAULT true | 在籍フラグ |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

### 3. skills（スキル・資格マスタ）
条件 g: スキルバランス

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | スキル名（例: ICU対応、救急対応） |
| created_at | timestamptz | |

---

### 4. staff_skills（スタッフ×スキル 中間テーブル）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| staff_id | uuid FK → staff_profiles.id | |
| skill_id | uuid FK → skills.id | |

---

### 5. shift_types（シフト種別マスタ）
条件 b: シフト種別

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 例: 早番、日勤、遅番、夜勤、明け、公休 |
| start_time | time | 開始時刻 |
| end_time | time | 終了時刻 |
| is_overnight | bool DEFAULT false | 翌日またぎフラグ（夜勤等） |
| is_off | bool DEFAULT false | 休み扱いフラグ（明け・公休） |
| color | text | カラーコード（例: #4A7FA5） |
| display_order | int | 表示順 |
| created_at | timestamptz | |

---

### 6. shift_constraints（勤務制約マスタ）
条件 d, e, f: 最低配置数・連続勤務上限・明け自動挿入

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| min_staff_per_shift | jsonb | シフト種別ごとの最低配置数 `{"shift_type_id": min_count}` |
| max_consecutive_work_days | int DEFAULT 5 | 最大連続勤務日数 |
| min_rest_hours_after_night | int DEFAULT 11 | 夜勤後の最低休息時間（h） |
| auto_insert_off_after_night | bool DEFAULT true | 夜勤翌日に明けを自動挿入 |
| max_night_shifts_per_month | int DEFAULT 8 | 月間最大夜勤回数 |
| updated_at | timestamptz | |

※ 制約は病棟単位で1レコード想定

---

### 7. skill_shift_requirements（シフト別スキル要件）
条件 g: スキルバランス

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| shift_type_id | uuid FK → shift_types.id | |
| skill_id | uuid FK → skills.id | NULL = スキル不問 |
| min_experienced_count | int DEFAULT 1 | 経験者（experience_years >= 3）の最低人数 |
| note | text | 備考（例: 新人のみ夜勤禁止） |

---

### 8. staff_pair_constraints（スタッフペア制約）
条件 h: スタッフの組み合わせ指定

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| staff_id_a | uuid FK → staff_profiles.id | スタッフA |
| staff_id_b | uuid FK → staff_profiles.id | スタッフB |
| constraint_type | text | `must_pair`（必ず同じシフト）/ `must_not_pair`（同じシフト禁止） |
| shift_type_id | uuid FK → shift_types.id | NULL = 全シフト対象 |
| note | text | 備考（例: 夜勤時はAとBをペアに） |
| created_at | timestamptz | |

---

### 9. leave_requests（勤務希望）
条件 c: 希望休・有給申請・シフト希望

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| staff_id | uuid FK → staff_profiles.id | |
| date | date NOT NULL | 希望日 |
| type | text | `希望休` / `有給` / `特別休暇` / `シフト希望` |
| preferred_shift_type_id | uuid FK → shift_types.id | `type = 'シフト希望'` の場合に希望するシフト種別（例: 夜勤）。それ以外は NULL |
| note | text | 備考 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

※ 管理者がスタッフから口頭・紙で収集して代理入力する。承認ワークフロー不要。

**種別ごとのソルバーへの影響**

| type | preferred_shift_type_id | ソルバーでの扱い |
|------|------------------------|----------------|
| 希望休 / 有給 / 特別休暇 | NULL | ハード制約 H3：対象日に勤務シフトを割り当て禁止 |
| シフト希望 | 夜勤など（shift_type_id） | ソフト制約 S5：対象日に指定シフトをできるだけ割り当て |

---

### 10. schedule_months（月次スケジュールヘッダー）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| year | int NOT NULL | 年 |
| month | int NOT NULL | 月（1〜12） |
| status | text DEFAULT 'draft' | `draft` / `published` |
| generated_at | timestamptz | 自動生成日時 |
| created_by | uuid FK → users.id | 作成者 |
| created_at | timestamptz | |

UNIQUE(year, month)

---

### 11. shift_assignments（シフト割り当て：自動生成結果）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| schedule_month_id | uuid FK → schedule_months.id | |
| staff_id | uuid FK → staff_profiles.id | |
| date | date NOT NULL | 日付 |
| shift_type_id | uuid FK → shift_types.id | |
| is_auto_generated | bool DEFAULT true | 自動生成 or 手動修正 |
| note | text | 備考 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE(schedule_month_id, staff_id, date)

---

## 自動スケジューリングの処理フロー

```
1. 入力データ収集
   - staff_profiles（全スタッフ）
   - staff_skills（スキル情報）
   - leave_requests（当月の承認済み希望休）
   - shift_constraints（制約マスタ）
   - shift_types（シフト種別）
   - skill_shift_requirements（スキル要件）

2. 制約充足問題として定式化
   - ハードコンストレイント（必ず守る）
     - 最低配置人数
     - 夜勤後の明け自動挿入
     - 最大連続勤務日数
     - 承認済み希望休の反映
   - ソフトコンストレイント（できるだけ守る）
     - スキルバランス（経験者配置）
     - 夜勤回数の均等化
     - 月間勤務時間の平準化

3. アルゴリズム（OR-Tools CP-SAT ソルバー）
   - Google OR-Tools の CP-SAT（制約プログラミング）を使用
   - Python サービスとして実装 → Google Cloud Run にデプロイ
   - Next.js API Routes から HTTP POST で呼び出す

   【CP-SAT での定式化】
   - 変数: shifts[staff_id][date][shift_type_id] = 0 or 1
   - ハードコンストレイント（必ず満たす）
     - 1日1スタッフに1シフトのみ割り当て
     - 最低配置人数を満たす
     - 夜勤翌日に明けを自動挿入
     - 最大連続勤務日数を超えない
     - 承認済み希望休を反映
     - `must_pair`: 指定ペアは同じ日・同じシフトに必ず配置
     - `must_not_pair`: 指定ペアは同じ日・同じシフトに配置しない
   - ソフトコンストレイント（最大化する目的関数）
     - スキルバランス（経験者の夜勤配置を最大化）
     - 夜勤回数の均等化（スタッフ間の差を最小化）
     - 月間勤務時間の平準化

4. 結果をshift_assignmentsへ保存
5. schedule_months.status を `draft` で返す
```

---

## RLS（行レベルセキュリティ）方針

管理者のみがアプリを使用するシングルロール構成のため、認証済みユーザー（管理者）は全テーブルに対して全操作可能。

| テーブル | 認証済み管理者 |
|---------|--------------|
| staff_profiles | 全操作 |
| leave_requests | 全操作 |
| shift_assignments | 全操作 |
| schedule_months | 全操作 |
| shift_types / shift_constraints | 全操作 |

---

## インデックス

```sql
-- よく使う検索パターンに対してインデックスを設定
CREATE INDEX idx_shift_assignments_month ON shift_assignments(schedule_month_id);
CREATE INDEX idx_shift_assignments_staff ON shift_assignments(staff_id);
CREATE INDEX idx_shift_assignments_date ON shift_assignments(date);
CREATE INDEX idx_leave_requests_staff_date ON leave_requests(staff_id, date);
```
