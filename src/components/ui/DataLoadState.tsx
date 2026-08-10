export function DataErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 px-4 py-2 bg-white border border-red-200 rounded-lg font-medium hover:bg-red-100"
      >
        {retryLabel}
      </button>
    </div>
  );
}

export function RefreshIndicator({ label }: { label: string }) {
  return (
    <div role="status" className="text-xs text-gray-400">
      {label}
    </div>
  );
}
