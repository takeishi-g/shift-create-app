# DB設計：病棟シフト作成アプリ

作成日: 2026-04-06
最終更新: 2026-04-19（Issue #9: UI実装に合わせて更新）
DB: Supabase (PostgreSQL)

---

## ER図（概要）

```
users
 └── staff_profiles ──┬── leave_requests
                      └── shift_assignments ── shifts（生成結果）
                                                └── schedule_months（月次ヘッダー）

shift_types（シフト種別マスタ）
shift_constraints（勤務制約マスタ）
bath_days（お風呂の日：月別の曜日/日付指定）
staff_pair_constraints（スタッフペア制約）
```

※ Phase 2以降で `skills` / `staff_skills` / `skill_shift_requirements` を追加予定（スキルバランスS3制約のため）。

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
| qualification | text NOT NULL | 資格区分：`正看護師` / `准看護師` |
| role | text NOT NULL DEFAULT '一般' | 役職：`師長` / `主任` / `一般` |
| work_start_time | time NOT NULL | 勤務開始時刻（例: `08:30`）。日勤AM/PM分類に使用 |
| work_end_time | time NOT NULL | 勤務終了時刻（例: `17:30`） |
| max_night_shifts | int DEFAULT 8 | 月間最大夜勤回数（スタッフごと） |
| experience_years | int DEFAULT 0 | 経験年数（スキルバランス判定に使用） |
| is_active | bool DEFAULT true | 在籍フラグ |
| created_at | timestamptz | |
| updated_at | timestamptz | |

※ `work_start_time` が `12:00` 未満なら「AM帯」、以上なら「PM帯」として日勤AM/PM集計に使う。
※ Phase 2以降で必要に応じて `employment_type` / `max_hours_per_month` を追加検討。

---

### 3. shift_types（シフト種別マスタ）
条件 b: シフト種別

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 例: 早番、日勤、遅番、夜勤、明け、公休、有給、その他、希望休 |
| start_time | time | 開始時刻（休み系は NULL） |
| end_time | time | 終了時刻（休み系は NULL） |
| is_overnight | bool DEFAULT false | 翌日またぎフラグ（夜勤等） |
| is_off | bool DEFAULT false | 休み扱いフラグ（明け・公休・有給・その他・希望休） |
| color | text | カラーコード（例: #C084FC） |
| display_order | int | 表示順 |
| created_at | timestamptz | |

※ Phase 1 では UI 側にシフト種別コード（早/日/遅/夜/明/公/有/他/希休）をハードコードし、バック接続時に shift_types マスタと紐付ける。

---

### 4. shift_constraints（勤務制約マスタ）
条件 d, e, f: 最低配置数・連続勤務上限・明け自動挿入

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| min_staff_per_shift | jsonb | シフト種別ごとの最低配置数 `{"shift_type_id": min_count}`（例: `{"早番":2,"日勤":3,"遅番":2,"夜勤":2}`） |
| min_staff_weekend | int DEFAULT 3 | 土日の最低配置人数 |
| min_staff_bath_day | int DEFAULT 4 | お風呂の日の最低配置人数 |
| max_consecutive_work_days | int DEFAULT 5 | 最大連続勤務日数 |
| min_rest_hours_after_night | int DEFAULT 11 | 夜勤後の最低休息時間（h） |
| auto_insert_off_after_night | bool DEFAULT true | 夜勤翌日に明けを自動挿入 |
| updated_at | timestamptz | |

※ 制約は病棟単位で1レコード想定。
※ 月間最大夜勤回数はスタッフ個別に `staff_profiles.max_night_shifts` で管理する（グローバル値は廃止）。

---

### 5. bath_days（お風呂の日）
UI独自機能: 月ごとにお風呂の日を曜日指定 or 日付指定で登録。最低配置人数が上乗せされる。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| year | int NOT NULL | 対象年 |
| month | int NOT NULL | 対象月（1〜12） |
| pattern | text NOT NULL | `weekly`（曜日指定）/ `date`（日付指定） |
| day_of_week | int | `weekly` の場合に曜日（0=日 〜 6=土）。`date` の場合は NULL |
| date | int | `date` の場合に日付（1〜31）。`weekly` の場合は NULL |
| created_at | timestamptz | |

※ Phase 1 UI では曜日指定（`weekly`）のみ対応。`date`指定は将来拡張用。

---

### 6. staff_pair_constraints（スタッフペア制約）
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

※ 現状UIでは `shift_type_id` を `'日勤'` / `'夜勤'` / `'all'` の文字列で管理しているが、バック接続時に shift_types.id（UUID）と紐付ける。

---

### 7. leave_requests（勤務希望）
条件 c: 希望休・有給申請・シフト希望

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| staff_id | uuid FK → staff_profiles.id | |
| date | date NOT NULL | 希望日 |
| type | text | `希望休` / `有給` / `特別休暇` / `シフト希望` / `他` |
| preferred_shift_type_id | uuid FK → shift_types.id | `type = 'シフト希望'` の場合に希望するシフト種別（例: 夜勤）。それ以外は NULL |
| note | text | 備考 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

※ 管理者がスタッフから口頭・紙で収集して代理入力する。承認ワークフロー不要。

**種別ごとのソルバーへの影響**

| type | preferred_shift_type_id | ソルバーでの扱い |
|------|------------------------|----------------|
| 希望休 / 有給 / 特別休暇 / 他 | NULL | ハード制約 H3：対象日に勤務シフトを割り当て禁止 |
| シフト希望 | 夜勤など（shift_type_id） | ソフト制約 S5：対象日に指定シフトをできるだけ割り当て |

---

### 8. schedule_months（月次スケジュールヘッダー）

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

### 9. shift_assignments（シフト割り当て：自動生成結果）

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
   - leave_requests（当月の勤務希望）
   - shift_constraints（制約マスタ）
   - shift_types（シフト種別）
   - bath_days（当月のお風呂の日）
   - staff_pair_constraints（ペア制約）

2. 制約充足問題として定式化
   - ハードコンストレイント（必ず守る）
     - 最低配置人数（シフト種別ごと）
     - 土日の最低配置人数
     - お風呂の日の最低配置人数
     - 夜勤後の明け自動挿入
     - 最大連続勤務日数
     - 希望休・有給・特別休暇・その他の反映
     - スタッフごとの月間最大夜勤回数
   - ソフトコンストレイント（できるだけ守る）
     - 夜勤回数の均等化
     - シフト希望の反映

3. アルゴリズム（OR-Tools CP-SAT ソルバー）
   - Google OR-Tools の CP-SAT（制約プログラミング）を使用
   - Python サービスとして実装 → Google Cloud Run にデプロイ
   - Next.js API Routes から HTTP POST で呼び出す

   【CP-SAT での定式化】
   - 変数: shifts[staff_id][date][shift_type_id] = 0 or 1
   - ハードコンストレイント（必ず満たす）
     - 1日1スタッフに1シフトのみ割り当て
     - 最低配置人数（通常・土日・お風呂の日）を満たす
     - 夜勤翌日に明けを自動挿入
     - 最大連続勤務日数を超えない
     - 希望休等を反映
     - スタッフごとの月間最大夜勤回数を超えない
     - `must_pair`: 指定ペアは同じ日・同じシフトに必ず配置
     - `must_not_pair`: 指定ペアは同じ日・同じシフトに配置しない
   - ソフトコンストレイント（最大化する目的関数）
     - 夜勤回数の均等化（スタッフ間の差を最小化）
     - シフト希望の充足数を最大化

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
| shift_types / shift_constraints / bath_days / staff_pair_constraints | 全操作 |

---

## インデックス

```sql
-- よく使う検索パターンに対してインデックスを設定
CREATE INDEX idx_shift_assignments_month ON shift_assignments(schedule_month_id);
CREATE INDEX idx_shift_assignments_staff ON shift_assignments(staff_id);
CREATE INDEX idx_shift_assignments_date ON shift_assignments(date);
CREATE INDEX idx_leave_requests_staff_date ON leave_requests(staff_id, date);
CREATE INDEX idx_bath_days_year_month ON bath_days(year, month);
```

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-04-06 | 初版作成 |
| 2026-04-19 | Issue #9：UI実装に合わせて更新 |
| | - staff_profiles: `employment_type` / `max_hours_per_month` を削除、`qualification` / `role` / `work_start_time` / `work_end_time` を追加 |
| | - shift_constraints: `max_night_shifts_per_month` を削除（`staff_profiles.max_night_shifts` に統一）、`min_staff_weekend` / `min_staff_bath_day` を追加 |
| | - `bath_days` テーブルを新規追加 |
| | - leave_requests: `type` に `'他'` を追加 |
| | - `skills` / `staff_skills` / `skill_shift_requirements` を Phase 2以降に後送 |
