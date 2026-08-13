import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const baseUrl = process.env.DATABASE_URL; const directUrl = process.env.DIRECT_DATABASE_URL ?? baseUrl;
if (!baseUrl || !directUrl || ![baseUrl,directUrl].every((value)=>new URL(value).hostname.includes("neon"))) throw new Error("Neon only");
const schema=`codex_6h_retention_${Date.now()}_${randomBytes(4).toString("hex")}`;
if(!/^codex_6h_[a-z0-9_]+$/.test(schema)||schema==="public")throw new Error("Unsafe schema");
const ident=`"${schema}"`; const client=new pg.Client({connectionString:directUrl});
const result={migrations:false,indexes:false,behavior:false,publicUnchanged:false,schemaRemoved:false}; let before;let failure;
const fingerprint=async()=>(await client.query(`SELECT md5(COALESCE(string_agg(table_name||':'||column_name,',' ORDER BY table_name,column_name),'')) value FROM information_schema.columns WHERE table_schema='public'`)).rows[0].value;
try{await client.connect();before=await fingerprint();await client.query(`CREATE SCHEMA ${ident}`);await client.query(`SET search_path TO ${ident}`);for(const e of readdirSync(join(process.cwd(),"prisma/migrations"),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort())await client.query(readFileSync(join(process.cwd(),"prisma/migrations",e,"migration.sql"),"utf8"));result.migrations=true;const idx=await client.query(`SELECT count(*)::int count FROM pg_indexes WHERE schemaname=$1 AND indexname IN ('RefreshToken_revokedAt_expiresAt_idx','PasswordResetToken_expiresAt_idx','ImportSession_expires_at_idx')`,[schema]);result.indexes=idx.rows[0].count===3;const test=spawnSync(process.execPath,[join(process.cwd(),"node_modules/vitest/vitest.mjs"),"run","tests/retention-postgres.test.ts","--maxWorkers=1"],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,DATABASE_URL:baseUrl,RETENTION_TEST_SCHEMA:schema}});if(test.status!==0)throw new Error(test.stderr.slice(-3000));result.behavior=true;}catch(error){failure=error;}finally{await client.query(`DROP SCHEMA IF EXISTS ${ident} CASCADE`).catch(e=>{failure??=e});if(before)result.publicUnchanged=before===await fingerprint().catch(()=>undefined);result.schemaRemoved=(await client.query(`SELECT count(*)::int count FROM information_schema.schemata WHERE schema_name=$1`,[schema]).catch(()=>({rows:[{count:-1}]}))).rows[0].count===0;await client.end().catch(()=>undefined)}console.log(JSON.stringify(result,null,2));if(failure||!Object.values(result).every(Boolean)){if(failure)console.error(failure instanceof Error?failure.message:failure);process.exitCode=1}
