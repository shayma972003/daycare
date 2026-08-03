-- Move orphaned monthly expenses into the live Expense table, then drop the dead
-- one (task 0.97ب).
--
-- `MonthlyExpense` was written by an older version of the UI and is read by
-- nothing today — the finance reports read `Expense`. In production that meant
-- the only expense records that existed were invisible: two months of rent,
-- maintenance and materials that no report has ever counted.
--
-- So this is not a cleanup. Dropping the table without moving the rows would
-- have destroyed the school's only expense history; leaving it would have left
-- real money permanently unreported. The rows move first, and only then does the
-- table go.

-- ---------------------------------------------------------------------------
-- One Expense row per non-zero line, dated to the first of the month it
-- describes.
--
-- `one_time` rather than `monthly`: each source row is a statement about one
-- specific month that already happened, not a recurring subscription. Marking
-- them recurring would make the expense updater keep charging them forward.
--
-- Zero-valued lines are skipped — "no maintenance that month" is not an expense.
-- ---------------------------------------------------------------------------

INSERT INTO "Expense" (
    "id", "school_id", "title", "description", "amount", "type",
    "start_date", "end_date", "is_active", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::TEXT,
    m."schoolId",
    line.title,
    'مُرحَّل من سجل المصاريف الشهرية',
    line.amount,
    'one_time',
    make_date(m."year", m."month", 1),
    NULL,
    -- Historic and already spent: not an active recurring charge.
    false,
    m."createdAt",
    now()
FROM "MonthlyExpense" m
CROSS JOIN LATERAL (
    VALUES
        ('إيجار', m."rent"),
        ('صيانة', m."maintenance"),
        ('مواد', m."materials"),
        ('مصاريف متفرقة', m."misc")
) AS line(title, amount)
WHERE line.amount IS NOT NULL
  AND line.amount > 0;

-- ---------------------------------------------------------------------------
-- Now the table can go.
--
-- The only code that referenced it was the school-deletion cascade in
-- src/app/api/admin/schools/[id]/route.ts, updated in the same change.
-- ---------------------------------------------------------------------------

DROP TABLE "MonthlyExpense";
