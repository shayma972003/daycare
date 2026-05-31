@AGENTS.md

# CLAUDE.md — Project Rules & Context

## Project Overview

A multi-tenant SaaS daycare management system built for Arabic-speaking users in Saudi Arabia.
Full RTL support. Arabic-only UI for MVP.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (RTL-first)
- **Database**: PostgreSQL via Neon (Prisma ORM)
- **Auth**: NextAuth.js
- **State**: TanStack React Query
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **Notifications**: Twilio (WhatsApp) + Resend (Email)

## Absolute Rules

1. Never use static/hardcoded data. All data must come from the database via API routes.
2. Never use placeholder images or real icons. Use labeled placeholder divs only.
3. All UI text must be in Arabic.
4. All layouts must use `dir="rtl"`. RTL is non-negotiable.
5. Every database table must include a `school_id` column for multi-tenant isolation.
6. Never expose secret keys on the client side. All API calls go through `/api` routes.
7. Use Zod schemas for all form validation.
8. Every API route must verify the session and the school_id before returning data.

## Folder Structure

src/
├── app/
│ ├── (auth)/ # login, register
│ ├── (dashboard)/ # all main pages
│ │ ├── page.tsx # الرئيسية
│ │ ├── students/ # الطلاب
│ │ ├── classes/ # الفصول
│ │ ├── teachers/ # المعلمون
│ │ ├── statistics/ # الإحصائيات
│ │ └── settings/ # الإعدادات
│ └── api/ # all backend routes
├── components/
│ ├── ui/ # reusable base components
│ ├── students/
│ ├── classes/
│ ├── teachers/
│ ├── statistics/
│ └── settings/
├── lib/
│ ├── prisma.ts # Prisma client singleton
│ ├── auth.ts # NextAuth config
│ ├── twilio.ts # WhatsApp helper
│ ├── resend.ts # Email helper
│ └── utils.ts # clsx + tailwind-merge
├── hooks/ # custom React hooks
├── types/ # TypeScript interfaces
└── schemas/ # Zod validation schemas

## Database Rules

- Use Prisma for all DB access, never raw SQL in components
- Every query must filter by school_id
- Soft-delete archived students (never hard delete)
- All timestamps in UTC, display converted to AST (UTC+3)

## Component Rules

- All forms use React Hook Form + Zod
- Loading states must always be handled
- Error states must always be handled
- No component should fetch data directly — use custom hooks
