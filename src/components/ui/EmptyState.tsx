interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
        <circle cx="60" cy="60" r="50" fill="#FFF8E0" />
        <circle cx="60" cy="45" r="18" fill="#F8B500" opacity="0.6" />
        <rect x="30" y="70" width="60" height="8" rx="4" fill="#2F96A6" opacity="0.4" />
        <rect x="40" y="84" width="40" height="6" rx="3" fill="#F64651" opacity="0.3" />
      </svg>
      <h3 className="mt-6 text-lg font-bold text-navy">{title}</h3>
      <p className="mt-2 text-sm text-gray-400 max-w-xs">{description}</p>
    </div>
  );
}
