import { beforeAll, afterAll, test, expect } from 'vitest';
import pg from 'pg';
const base = process.env.TEST_BASE_URL!;
const trainee = process.env.TEST_TRAINEE_ID!;
const manager = process.env.TEST_MANAGER_ID!;
const repToken = process.env.TEST_TRAINEE_TOKEN!;
const managerToken = process.env.TEST_MANAGER_TOKEN!;
const db = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const adminToken = 'certificate-test-admin-session';
async function get(path: string, token?: string) {
  const response = await fetch(base + path, {headers:token ? {Authorization:'Bearer ' + token} : {}});
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
beforeAll(async () => {
  await db.query("INSERT INTO certifications (user_id, certificate_name, score, certified_at) VALUES ($1, 'Earned Name', 91, '2026-10-01 12:00:00')",[trainee]);
  const admin = await db.query("INSERT INTO super_admins (username,password_hash,display_name) VALUES ('certificate-test','unused-test-hash','Certificate Admin') RETURNING id");
  await db.query("INSERT INTO admin_sessions (admin_id,token,expires_at) VALUES ($1,$2,NOW() + INTERVAL '1 hour')",[admin.rows[0].id,adminToken]);
});
afterAll(() => db.end());
test('certificate routes refuse anonymous access and reps cannot read admin records',async () => {
  for (const path of ['/api/certificates/me','/api/admin/certificates','/api/cms/certificates']) expect((await get(path)).status).toBe(401);
  expect((await get('/api/admin/certificates',repToken)).status).toBe(403);
  expect((await get('/api/admin/certificates/' + trainee,repToken)).status).toBe(403);
  expect((await get('/api/cms/certificates',repToken)).status).toBe(401);
});
test('rep reads only their own saved record, and admin paths return identical credential data',async () => {
  const own = await get('/api/certificates/me?userId=' + manager,repToken);
  expect(own.status).toBe(200);
  expect(own.cache).toBe('no-store');
  expect(own.body.certificate).toMatchObject({userId:trainee,recipientName:'Earned Name',score:91});
  expect(own.body.certificate.certificateId).toMatch(/^RER-2026-[A-F0-9]{12}$/);
  for (const [prefix,token] of [['/api/admin',managerToken],['/api/cms',adminToken]]) {
    expect((await get(prefix + '/certificates/' + trainee,token)).body).toEqual(own.body);
    expect((await get(prefix + '/certificates',token)).body.certificates).toContainEqual(own.body.certificate);
    expect((await get(prefix + '/certificates/' + manager,token)).status).toBe(404);
  }
  expect((await get('/api/certificates/me',managerToken)).status).toBe(404);
});
