import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

const schema = process.env.ACTIVITY_TEST_SCHEMA;
const suite = schema ? describe.sequential : describe.skip;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function gate() {
  return { before: deferred<number>(), entered: deferred<number>(), release: deferred<void>(), paused:false };
}
type Context = { gate?: ReturnType<typeof gate>; failRecipients?: boolean };

suite("activity calendar on approved isolated PostgreSQL", () => {
  let db: PrismaClient;
  let send: typeof import("@/app/api/activities/[id]/send/route").POST;
  let update: typeof import("@/app/api/activities/[id]/route").PUT;
  let removeClass: typeof import("@/app/api/trash/permanent/class/[id]/route").DELETE;
  let removeTeacher: typeof import("@/app/api/trash/permanent/teacher/[id]/route").DELETE;
  let cleanup: typeof import("@/lib/trash-cleanup").cleanupExpiredTrash;
  const context = new AsyncLocalStorage<Context>();
  const push = vi.fn();
  let schoolId = "";
  let sequence = 0;
  const suffix = randomBytes(4).toString("hex");
  const uid = (label: string) => `activity_check_${suffix}_${++sequence}_${label}`;

  beforeAll(async () => {
    if (!schema || !/^codex_activity_verify_[0-9]+_[a-f0-9]{10}$/.test(schema)) throw new Error("Unsafe isolated schema");
    const url = new URL(process.env.DATABASE_URL ?? "");
    const identity = createHash("sha256").update(`${url.hostname}|${url.pathname.slice(1)}`).digest("hex").slice(0,16);
    if (identity !== "a29feb47bc609480" || process.env.ACTIVITY_TEST_EXPECTED_FINGERPRINT !== identity || url.searchParams.get("schema") !== schema) {
      throw new Error("Unapproved activity PostgreSQL target");
    }
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.delete("options");
    db = new PrismaClient({
      adapter: new PrismaPg({connectionString:url.toString(),options:`-c search_path=${schema}`,max:6}, {schema}),
      transactionOptions:{maxWait:15000,timeout:30000},
    });
    const resolved = await db.$queryRaw<Array<{schema:string; resolved:string}>>`
      SELECT current_schema() AS schema, (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('"Activity"')) AS resolved`;
    expect(resolved[0]).toEqual({schema,resolved:schema});
    expect(await db.activity.findUnique({where:{id:"activity_legacy_canary"}})).toMatchObject({allDay:null});

    // Use the real transaction and real SQL lock. The proxy supplies only test
    // isolation and deterministic scheduling barriers; it never emulates locks.
    const isolated = new Proxy(db, {
      get(target,property,receiver) {
        if (property !== "$transaction") return Reflect.get(target,property,receiver);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          if (typeof callback !== "function") throw new Error("Unexpected batch transaction in this fixture");
          const active = context.getStore();
          return target.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('search_path', ${schema}, true)`;
            const connection = await tx.$queryRaw<Array<{pid:number; schema:string}>>`SELECT pg_backend_pid() pid,current_schema() schema`;
            expect(connection[0].schema).toBe(schema);
            const pid = connection[0].pid;
            const observed = new Proxy(tx, {
              get(client,key,recv) {
                if (key === "$queryRaw") return async (statement: Prisma.Sql) => {
                  const isLock = statement.strings.join(" ").includes("FOR UPDATE");
                  if (isLock) active?.gate?.before.resolve(pid);
                  const result = await client.$queryRaw(statement);
                  if (isLock && active?.gate && !active.gate.paused) {
                    active.gate.paused=true;
                    active.gate.entered.resolve(pid);
                    await active.gate.release.promise;
                  }
                  return result;
                };
                if (key === "activityMessage" && active?.failRecipients) {
                  return new Proxy(client.activityMessage, {get(model,method) {
                    if (method !== "create") return Reflect.get(model,method);
                    return (args: Parameters<typeof client.activityMessage.create>[0]) => {
                      const copy = structuredClone(args);
                      const rows = copy.data.recipients?.create;
                      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Missing recipient fixture");
                      const unchecked = rows as Prisma.ActivityMessageRecipientUncheckedCreateWithoutMessageInput[];
                      unchecked.push({...unchecked[0]}); // real nested uniqueness failure; must roll back the message
                      return client.activityMessage.create(copy);
                    };
                  }});
                }
                return Reflect.get(client,key,recv);
              },
            });
            return callback(observed);
          });
        };
      },
    });
    vi.doMock("@/lib/prisma",()=>({prisma:isolated}));
    vi.doMock("@/lib/session",()=>({
      requireSession:async()=>({user:{id:"isolated-manager",name:"Test",schoolId},can:()=>true}),
      sessionErrorResponse:()=>null,
    }));
    vi.doMock("@/lib/rate-limit",()=>({rateLimit:async()=>({status:"allowed"}),rateLimitResponse:()=>null}));
    vi.doMock("@/lib/push",()=>({enqueuePush:push}));
    vi.doMock("@/lib/activity-logger",()=>({logAction:async()=>{}}));
    send=(await import("@/app/api/activities/[id]/send/route")).POST;
    update=(await import("@/app/api/activities/[id]/route")).PUT;
    removeClass=(await import("@/app/api/trash/permanent/class/[id]/route")).DELETE;
    removeTeacher=(await import("@/app/api/trash/permanent/teacher/[id]/route")).DELETE;
    cleanup=(await import("@/lib/trash-cleanup")).cleanupExpiredTrash;
  },60000);

  afterAll(async()=>{ await db?.$disconnect(); });
  beforeEach(()=>{
    push.mockReset();
    push.mockImplementation(async (_target, payload) => {
      // A separate query must already see the committed message before Push.
      expect(await db.activityMessage.findUnique({where:{id:payload.data.messageId}})).not.toBeNull();
      return 1;
    });
  });

  async function fixture() {
    schoolId=uid("school");
    await db.school.create({data:{id:schoolId,name:"Isolated calendar school"}});
    const teacher=await db.teacher.create({data:{id:uid("teacher"),schoolId,name:"Teacher"}});
    const room=await db.class.create({data:{id:uid("class"),schoolId,name:"Room",teacherId:teacher.id}});
    const second=await db.class.create({data:{id:uid("other_class"),schoolId,name:"Other room"}});
    const guardians=[];
    const accounts=[];
    for(let i=0;i<3;i++) {
      const guardian=await db.guardian.create({data:{id:uid("guardian"),schoolId,name:`Guardian ${i}`}});
      guardians.push(guardian);
      accounts.push(await db.guardianAccount.create({data:{id:uid("account"),schoolId,guardianId:guardian.id,email:`${guardian.id}@example.invalid`,acceptedAt:new Date()}}));
    }
    const student=await db.student.create({data:{id:uid("student"),schoolId,name:"Child",classId:room.id,guardianId:guardians[0].id,
      guardianLinks:{create:{guardianId:guardians[1].id}}}});
    await db.student.create({data:{id:uid("other_student"),schoolId,name:"Other child",classId:second.id,guardianId:guardians[2].id}});
    const activity=await db.activity.create({data:{id:uid("activity"),schoolId,name:"Event",teacherId:teacher.id,message:"Stored text",allDay:true,
      startDate:new Date("2026-09-04"),endDate:new Date("2026-09-04"),activityInvites:{create:{classId:room.id}}}});
    return {activity,room,second,teacher,student,accounts};
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const params=(id:string)=>({params:Promise.resolve({id})});
  const req=(method:string,body?:unknown)=>new Request("http://isolated.invalid/test",{method,headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const body=(f:Fixture,key=uid("request"))=>({notifyGuardians:true,notifyStaff:false,message:f.activity.message,
    activityVersion:f.activity.updatedAt.toISOString(),idempotencyKey:key});

  async function race(first:()=>Promise<unknown>, second:()=>Promise<unknown>) {
    const a=gate(),b=gate();
    const firstTask=context.run({gate:a},first);
    // Observe failures immediately while retaining the rejection for assertions.
    void firstTask.catch(()=>{});
    const secondTaskHolder: Promise<unknown>[]=[];
    try {
      const firstPid=await a.entered.promise;
      const secondTask=context.run({gate:b},second);
      void secondTask.catch(()=>{});
      secondTaskHolder.push(secondTask);
      const secondPid=await b.before.promise;
      expect(secondPid).not.toBe(firstPid);
      let blocked=false;
      for(let attempt=0;attempt<80;attempt++) {
        const rows=await db.$queryRaw<Array<{blocked:boolean}>>`SELECT ${firstPid}::int = ANY(pg_blocking_pids(${secondPid}::int)) blocked`;
        if(rows[0].blocked){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      expect(blocked,"PostgreSQL must report the second backend waiting for the first").toBe(true);
      a.release.resolve();
      await b.entered.promise;
      b.release.resolve();
      return await Promise.all([firstTask,secondTask]);
    } finally {
      a.release.resolve(); b.release.resolve();
      await Promise.allSettled([firstTask,...secondTaskHolder]);
    }
  }

  it("update-first rejects stale send after a real lock wait",async()=>{
    const f=await fixture();
    const original=body(f);
    const [changed,sent]=await race(()=>update(req("PUT",{classIds:[f.second.id]}),params(f.activity.id)),()=>send(req("POST",original),params(f.activity.id))) as Response[];
    expect(changed.status).toBe(200); expect(sent.status).toBe(409);
    expect(await db.activityMessage.count({where:{activityId:f.activity.id}})).toBe(0);
    expect(push).not.toHaveBeenCalled();
  },60000);

  it("send-first keeps its revision and recipient snapshot before target update",async()=>{
    const f=await fixture();
    const original=body(f);
    const [sent,changed]=await race(()=>send(req("POST",original),params(f.activity.id)),()=>update(req("PUT",{classIds:[f.second.id]}),params(f.activity.id))) as Response[];
    expect(sent.status).toBe(201); expect(changed.status).toBe(200);
    const saved=await db.activityMessage.findFirstOrThrow({where:{activityId:f.activity.id},include:{recipients:true}});
    expect(saved.targetRevision.toISOString()).toBe(original.activityVersion);
    expect(saved.recipients.map(x=>x.guardianAccountId).sort()).toEqual(f.accounts.slice(0,2).map(x=>x.id).sort());
    expect(push).toHaveBeenCalledTimes(2);
    const retry=await send(req("POST",original),params(f.activity.id));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({duplicate:true,notified:2,messageId:saved.id});
    expect(push).toHaveBeenCalledTimes(2);
    const current=await db.activity.findUniqueOrThrow({where:{id:f.activity.id}});
    expect((await send(req("POST",{...original,activityVersion:current.updatedAt.toISOString()}),params(f.activity.id))).status).toBe(409);
  },60000);

  it("concurrent equal keys persist one message and one push batch",async()=>{
    const f=await fixture(); const input=body(f);
    const replies=await race(()=>send(req("POST",input),params(f.activity.id)),()=>send(req("POST",input),params(f.activity.id))) as Response[];
    expect(replies.map(x=>x.status).sort()).toEqual([200,201]);
    expect(await db.activityMessage.count({where:{activityId:f.activity.id}})).toBe(1);
    expect(await db.activityMessageRecipient.count({where:{schoolId}})).toBe(2);
    expect(push).toHaveBeenCalledTimes(2);
    await db.student.update({where:{id:f.student.id},data:{classId:f.second.id}});
    expect(await (await send(req("POST",input),params(f.activity.id))).json()).toMatchObject({duplicate:true,notified:2});
    expect(push).toHaveBeenCalledTimes(2);
  },60000);

  it("real nested recipient uniqueness failure rolls back the message",async()=>{
    const f=await fixture();
    await expect(context.run({failRecipients:true},()=>send(req("POST",body(f)),params(f.activity.id)))).rejects.toMatchObject({code:"P2002"});
    expect(await db.activityMessage.count({where:{activityId:f.activity.id}})).toBe(0);
    expect(push).not.toHaveBeenCalled();
  },30000);

  it("control: nested recipients inherit schoolId from the composite message relation",async()=>{
    const f=await fixture();
    const message=await db.activityMessage.create({data:{
      schoolId,activityId:f.activity.id,body:"Control only",idempotencyKey:uid("control"),requestHash:"control",
      targetRevision:f.activity.updatedAt,guardianRecipientCount:2,
      recipients:{create:f.accounts.slice(0,2).map(account=>({guardianAccountId:account.id}))},
    },include:{recipients:true}});
    expect(message.recipients).toHaveLength(2);
    expect(message.recipients.every(recipient=>recipient.schoolId===schoolId)).toBe(true);
    expect(push).not.toHaveBeenCalled();
  },30000);

  it("failed push keeps durable message and tenant-mismatched send is denied",async()=>{
    const f=await fixture(); push.mockRejectedValue(new Error("Test push failure"));
    const reply=await send(req("POST",body(f)),params(f.activity.id));
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({pushFailures:2});
    expect(await db.activityMessage.count({where:{activityId:f.activity.id}})).toBe(1);
    schoolId=uid("foreign_school");
    expect((await send(req("POST",body(f)),params(f.activity.id))).status).toBe(404);
  },30000);

  for(const kind of ["class","teacher"] as const) {
    it(`${kind} deletion-first serializes and invalidates the saved target`,async()=>{
      const f=await fixture();
      if(kind==="class") await db.class.update({where:{id:f.room.id},data:{deletedAt:new Date()}});
      else await db.teacher.update({where:{id:f.teacher.id},data:{deletedAt:new Date()}});
      const [removed,sent]=await race(
        ()=>kind==="class"?removeClass(req("DELETE"),params(f.room.id)):removeTeacher(req("DELETE"),params(f.teacher.id)),
        ()=>send(req("POST",body(f)),params(f.activity.id))) as Response[];
      expect(removed.status).toBe(200); expect(sent.status).toBe(409);
      expect(await db.activityMessage.count({where:{activityId:f.activity.id}})).toBe(0);
      expect((await db.activity.findUniqueOrThrow({where:{id:f.activity.id}})).updatedAt.getTime()).toBeGreaterThan(f.activity.updatedAt.getTime());
    },60000);
  }

  it("retention cleanup uses real locks and never reads application data",async()=>{
    const f=await fixture();
    const expired=new Date(Date.now()-40*86400000);
    await db.teacher.update({where:{id:f.teacher.id},data:{deletedAt:expired}});
    await db.class.update({where:{id:f.room.id},data:{deletedAt:expired}});
    const [cleaned,sent]=await race(()=>cleanup(),()=>send(req("POST",body(f)),params(f.activity.id)));
    expect(cleaned).toMatchObject({teachers:1,classes:1,failures:0});
    expect((sent as Response).status).toBe(409);
    expect(await db.teacher.findUnique({where:{id:f.teacher.id}})).toBeNull();
    expect(await db.class.findUnique({where:{id:f.room.id}})).toBeNull();
  },60000);
});
