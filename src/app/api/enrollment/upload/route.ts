import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import {
  storeUpload,
  isFailure,
  DOCUMENT_TYPES,
  DOCUMENT_LABEL,
  MAX_ENROLLMENT_FILE_BYTES,
} from "@/lib/file-upload";

/**
 * The child's evaluation file, uploaded before the enrolment form is submitted.
 *
 * It used to travel inside the form's JSON as a base64 data URI. Two things were
 * wrong with that, and the second one broke the feature outright:
 *
 *  - base64 inflates by a third, and Vercel refuses any request body over
 *    4.5 MB **at the edge**, before a single line of our code runs. The form
 *    accepted files up to 100 MB, so a parent attaching an ordinary 4 MB scan
 *    was told the file was fine and then handed a platform error page with no
 *    explanation. Anything above roughly 3.3 MB failed this way.
 *  - the data URI was stored exactly as received. Nothing checked that the bytes
 *    were a PDF or an image, on a public endpoint.
 *
 * The file now goes to R2 through the same `storeUpload` path as every other
 * upload — type read from the bytes, size enforced, tenant in the key — and the
 * form sends only the resulting URL.
 *
 * ## Unauthenticated by necessity
 *
 * A parent filling this in has no account. What stands in for one is the
 * enrolment token: it is unguessable, expires in 24 hours, is bound to one
 * school, and has a submission limit. The token is re-checked here rather than
 * trusted from the form, and the upload is rate-limited per address on top.
 */
export async function POST(request: Request) {
  const limited = await rateLimit({
    key: `enroll-upload:${clientIp(request)}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const token = formData.get("token");
  const file = formData.get("file");

  if (typeof token !== "string" || !token) {
    return Response.json({ error: "الرابط غير صالح" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "لم يتم إرسال ملف" }, { status: 400 });
  }

  const record = await prisma.enrollmentToken.findUnique({
    where: { token },
    select: {
      school_id: true,
      status: true,
      expires_at: true,
      submissions_count: true,
      max_submissions: true,
      otp_verified: true,
    },
  });

  // One message for every reason, matching the rest of this flow: distinguishing
  // "expired" from "never existed" would tell a stranger which links are real.
  const invalid = Response.json({ error: "الرابط غير صالح أو منتهي" }, { status: 403 });

  if (!record) return invalid;
  if (record.status === "expired" || record.expires_at < new Date()) return invalid;
  if (record.submissions_count >= record.max_submissions) return invalid;
  // The code proves the address belongs to whoever is filling this in. Without
  // it the link alone would be enough to put files in the school's bucket.
  if (!record.otp_verified) return invalid;

  const stored = await storeUpload(record.school_id, file, {
    allowed: DOCUMENT_TYPES,
    maxBytes: MAX_ENROLLMENT_FILE_BYTES,
    humanLabel: DOCUMENT_LABEL,
    category: "students",
    // No student row exists yet — one is created only if the school approves.
    // The orphan sweep looks for this owner.
    ownerId: "enrollment",
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  return Response.json({ url: stored.url, name: file.name.slice(0, 200) });
}
