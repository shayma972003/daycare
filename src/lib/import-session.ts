export function importConfirmationPaths(sessionId: string) {
  const encodedSessionId = encodeURIComponent(sessionId);
  return {
    confirm: `/api/import/${encodedSessionId}/confirm`,
    status: `/api/import/${encodedSessionId}`,
  };
}
