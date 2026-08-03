# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project Overview

Multi-tenant SaaS daycare management system for Arabic-speaking users in Saudi Arabia. Full RTL UI. Arabic-only for MVP.

## Commands

```bash
npm run dev          # start dev server (Next.js)
npm run build        # prisma generate && next build
npm run db:push      # push schema changes to Neon (no migration file)
npm run db:migrate   # create migration + apply
npm run db:seed      # seed default data (tsx prisma/seed.ts)
npx prisma studio    # open Prisma Studio GUI
```

## Tech Stack

- **Framework**: Next.js 16 (App Router) — read `node_modules/next/dist/docs/` before writing Next.js code
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 (RTL-first, no `tailwind.config.js` — config is in CSS)
- **Database**: PostgreSQL via Neon · Prisma 7 (`provider = "prisma-client"`, output `src/generated/prisma`)
- **Auth**: NextAuth.js v4 (JWT strategy) · config in `src/lib/auth.ts`
- **Notifications**: Twilio WhatsApp + Resend email · helpers in `src/lib/notifications.ts`
- **PDF**: `@react-pdf/renderer` v4 · fonts must be static TTF in `public/fonts/` (variable fonts crash textkit BiDi)

## Architecture

### Multi-tenancy
Every DB table has `schoolId`. Every API route must call `requireSession()` from `src/lib/session.ts`, extract `schoolId` from the JWT, and filter all queries by it. The super-admin panel (`src/app/admin/`) uses a separate JWT via `src/lib/admin-auth.ts` — completely separate from NextAuth.

### Authorisation
`requireSession()` does three jobs: proves the tenant claim, re-reads the account from the database (JWT sessions outlive a deleted or disabled user), and enforces the route's permission. Requirements live in `src/lib/route-permissions.ts`, keyed by path and method — **add a rule there when adding a route**, or it falls back to owner-only. Permission keys and role templates are in `src/lib/permissions.ts`; they are code, not rows.

`src/proxy.ts` (the Next 16 rename of `middleware.ts`) is deny-by-default: everything is protected except an explicit exclusion list. It also forwards `x-pathname`/`x-method`, which is how the permission table is reachable from inside a handler.

Routes catch session failures with `sessionErrorResponse(error) ?? 401` so a permission denial answers **403**, not 401 — the client treats 401 as "session ended" and redirects to sign-in.

### File storage
Uploads go to Cloudflare R2 via `storeUpload()` in `src/lib/file-upload.ts` — never write a data URI to a column. The bucket is **private**; the column holds `/api/files/<key>`, and that route proves the caller before redirecting to a 5-minute signed URL. Keys are `schools/<schoolId>/<category>/<ownerId>/<uuid>.<ext>`, so the tenant is checkable without a query and a child's files are deletable by owner.

Deleting a row is no longer deleting a file: call `discardStoredFile()` / `discardFilesOwnedBy()` from `src/lib/stored-files.ts`. For any surface without a cookie session (kiosk, parent portal, mobile), stamp URLs with `stampFileUrl()` — an `<img>` cannot send a bearer token.

### Mobile API
`/api/mobile/v1/*` is versioned and separate from the web routes: an app in the wild cannot be updated on demand. Bearer tokens, never cookies — see `src/lib/mobile-auth.ts` (short access JWT + rotating hashed refresh token) and `src/lib/mobile-guard.ts`. All guardian queries scope through `guardianChildIds()`.

### Route layout
```
src/app/
  login/               # public — NextAuth sign-in page
  register/            # public — self-service school registration
  forgot-password/     # public — OTP request
  reset-password/      # public — OTP verify + new password
  (dashboard)/         # protected by src/proxy.ts — school admin panel
  admin/               # super-admin panel (own JWT auth)
  api/
    auth/              # NextAuth + register + forgot/reset password
    admin/             # super-admin APIs (schools, subscriptions, …)
    students/ teachers/ classes/ invoices/ …   # school-scoped APIs
```

### Auth flow
- School users: NextAuth credentials → JWT → `session.user.schoolId` + `session.user.role`
- Super-admin: POST `/api/admin/auth/login` → sets `admin_token` httpOnly cookie verified by `verifyAdminSessionFromRequest()`

### PDF generation
`@react-pdf/renderer` runs server-side in API routes (Node.js runtime). Fonts registered at module level from `public/fonts/Arabic-Regular.ttf` + `Arabic-Bold.ttf` (Amiri static TTF). Always call `Font.registerHyphenationCallback((w) => [w])`. Never use `direction: "rtl"` on `<Page>` style — it shifts the coordinate origin off-page. Use `flexDirection: "row-reverse"` + `textAlign: "right"` instead. PDF is returned as a base64 data URI stored in `Invoice.pdfUrl` — no filesystem writes (Vercel read-only FS).

### Notifications
`sendWhatsApp(phone, body)` and `sendEmail(to, subject, body, schoolName)` in `src/lib/notifications.ts`. Both are no-ops when env vars are missing (warn + return false). `sendNotification()` combines both and logs to `NotificationLog`.

## Absolute Rules

1. Never use static/hardcoded data — all data from DB via API routes.
2. No real icons or placeholder images — use labeled `<div>` placeholders.
3. All UI text in Arabic.
4. All layouts use `dir="rtl"`. Non-negotiable.
5. Every DB table has `school_id` / `schoolId` for multi-tenant isolation.
6. No secret keys on the client — all sensitive calls through `/api` routes.
7. Zod schemas for all form validation.
8. Every API route verifies session and schoolId before returning data.
9. Soft-delete for students (`isActive: false`) — never hard delete.
10. Timestamps stored UTC, displayed as AST (UTC+3).
