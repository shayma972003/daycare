import { SessionProvider } from "@/components/layout/SessionProvider";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
