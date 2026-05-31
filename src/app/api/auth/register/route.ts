import { prisma } from "@/lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";

const registerSchema = z
  .object({
    schoolName: z.string().min(1, "اسم المنشأة مطلوب"),
    email: z.string().email("البريد الإلكتروني غير صالح"),
    password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
    confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "كلمة المرور وتأكيدها غير متطابقتين",
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { schoolName, password } = parsed.data;
    const email = parsed.data.email.toLowerCase().trim();

    const existing = await prisma.school.findFirst({ where: { email } });
    if (existing) {
      return Response.json(
        { error: "البريد الإلكتروني مستخدم بالفعل" },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const school = await prisma.school.create({
      data: { name: schoolName, email },
    });

    await prisma.user.create({
      data: {
        name: schoolName,
        email,
        password: hashedPassword,
        role: "admin",
        schoolId: school.id,
      },
    });

    return Response.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Register error:", error);
    return Response.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
