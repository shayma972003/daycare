-- A teaching unit becomes a calendar event type.
--
-- The standalone units page is withdrawn. A unit is a titled span of days that
-- belongs to some classes — which is what a calendar event already is — so it
-- is created from the same form as a lesson, an activity or an announcement
-- rather than from a screen of its own.
--
-- Additive only. The Unit, Lesson and UnitFile tables are untouched, and
-- CalendarEvent.unitId still points at them. Nothing existing is rewritten:
-- adding a value to a Postgres enum cannot invalidate a row that does not use
-- it.

ALTER TYPE "CalendarEventType" ADD VALUE IF NOT EXISTS 'UNIT';
