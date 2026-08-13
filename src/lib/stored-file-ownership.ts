/**
 * Mirrors Prisma's StoredFileOwnerType without importing the generated client
 * into upload code. Keep this list in lock-step with prisma/schema.prisma.
 */
export const STORED_FILE_OWNER = {
  LEGACY: "LEGACY",
  STUDENT: "STUDENT",
  TEACHER: "TEACHER",
  ENROLLMENT_TOKEN: "ENROLLMENT_TOKEN",
  ENROLLMENT_SUBMISSION: "ENROLLMENT_SUBMISSION",
} as const;

export type StoredFileOwner =
  (typeof STORED_FILE_OWNER)[keyof typeof STORED_FILE_OWNER];
