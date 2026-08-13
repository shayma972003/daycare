import { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      schoolId: string;
      schoolName: string;
      role: string;
      authVersion: number;
    };
  }

  interface User {
    schoolId: string;
    schoolName: string;
    role: string;
    authVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    schoolId: string;
    schoolName: string;
    role: string;
    authVersion: number;
  }
}
