import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { logAction } from '@/lib/activity-logger';
import { MAX_SPREADSHEET_BYTES } from '@/lib/file-upload';

/** Upper bound on rows accepted from one uploaded file. */
const MAX_IMPORT_ROWS = 2000;
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { z } from 'zod';

const schema = z.object({ type: z.enum(['students', 'teachers']) });

function isArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

function detectLanguage(headers: string[]): 'ar' | 'en' {
  const arabicCount = headers.filter(isArabic).length;
  return arabicCount / headers.length > 0.5 ? 'ar' : 'en';
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '');
}

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  // Expired-session cleanup moved to the nightly cron. Running it here was
  // global, so one school's upload deleted other schools' sessions — and as a
  // fire-and-forget promise in a serverless function it was often dropped
  // before it settled anyway.

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const typeRaw = formData.get('type');

  if (!file) return Response.json({ error: 'لم يتم رفع ملف' }, { status: 400 });

  const parsed = schema.safeParse({ type: typeRaw });
  if (!parsed.success) return Response.json({ error: 'نوع الملف غير صحيح' }, { status: 400 });
  const { type } = parsed.data;

  const filename = file.name.toLowerCase();
  const isXlsx = filename.endsWith('.xlsx') || filename.endsWith('.xls');
  const isCsv = filename.endsWith('.csv');
  if (!isXlsx && !isCsv) {
    return Response.json({ error: 'صيغة الملف غير مدعومة. يُرجى رفع ملف .xlsx أو .csv فقط.' }, { status: 400 });
  }

  // There was no size cap at all, and the parser runs on attacker-controlled
  // bytes. A large workbook was an easy way to exhaust memory or hang the
  // function.
  if (file.size > MAX_SPREADSHEET_BYTES) {
    return Response.json(
      { error: `حجم الملف كبير. الحد الأقصى ${MAX_SPREADSHEET_BYTES / (1024 * 1024)} ميجابايت.` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, unknown>[] = [];
  let headers: string[] = [];

  if (isXlsx) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    headers = raw.length > 0 ? Object.keys(raw[0]) : [];
    rows = raw.filter((r) => !isEmptyRow(r));
  } else {
    const content = buffer.toString('utf-8');
    const result = Papa.parse<Record<string, unknown>>(content, { header: true, skipEmptyLines: true });
    headers = result.meta.fields ?? [];
    rows = result.data.filter((r) => !isEmptyRow(r));
  }

  // Bounded so one import cannot fan out into tens of thousands of sequential
  // inserts during the confirm step.
  if (rows.length > MAX_IMPORT_ROWS) {
    return Response.json(
      { error: `الملف يحتوي ${rows.length} صفاً. الحد الأقصى ${MAX_IMPORT_ROWS} صف في المرة الواحدة.` },
      { status: 413 }
    );
  }

  // Remove blank columns
  const nonBlankHeaders = headers.filter((h) =>
    rows.some((r) => r[h] !== null && r[h] !== undefined && String(r[h]).trim() !== '')
  );
  rows = rows.map((r) => {
    const cleaned: Record<string, unknown> = {};
    for (const h of nonBlankHeaders) cleaned[h] = r[h];
    return cleaned;
  });
  headers = nonBlankHeaders;

  const fileLanguage = detectLanguage(headers);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const importSession = await prisma.importSession.create({
    data: {
      school_id: schoolId,
      type,
      status: 'pending',
      total_rows: rows.length,
      original_headers: headers,
      file_language: fileLanguage,
      expires_at: expiresAt,
    },
  });

  // Create import rows in batches
  await prisma.importRow.createMany({
    data: rows.map((row, i) => ({
      session_id: importSession.id,
      row_number: i + 2, // 1-indexed, row 1 is header
      raw_data: row as object,
    })),
  });

  const previewRows = rows.slice(0, 10);

  await logAction({
    school_id: schoolId,
    action: type === 'students'
      ? `رفع ملف استيراد طلاب: ${rows.length} صف`
      : `رفع ملف استيراد معلمين: ${rows.length} صف`,
    entity_type: 'import',
    entity_id: importSession.id,
    performed_by: session.user.name ?? 'المدير',
    request,
  });

  return Response.json({
    session_id: importSession.id,
    total_rows: rows.length,
    preview_rows: previewRows,
    headers,
  }, { status: 201 });
}
