import { SessionProvider } from "@/components/layout/SessionProvider";

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
