import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export async function createLessonDraft(pool:Pool,moduleId:string,html:string) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const mod=await client.query('SELECT id FROM cms_modules WHERE id=$1 FOR UPDATE',[moduleId]);
    if(!mod.rowCount)throw Error('Module not found');
    const latest=await client.query('SELECT COALESCE(MAX(version),0) AS version FROM cms_module_content WHERE module_id=$1',[moduleId]);
    const version=Number(latest.rows[0].version)+1;
    await client.query(`INSERT INTO cms_module_content (id,module_id,version,status,html_content) VALUES ($1,$2,$3,'draft',$4)`,[randomUUID(),moduleId,version,html]);
    await client.query('COMMIT');return version;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}

export async function publishLessonDraft(pool:Pool,moduleId:string,version:number) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM cms_modules WHERE id=$1 FOR UPDATE',[moduleId]);
    const target=await client.query(`SELECT status FROM cms_module_content WHERE module_id=$1 AND version=$2 FOR UPDATE`,[moduleId,version]);
    if(target.rows[0]?.status!=='draft')throw Error('Choose an existing saved draft');
    await client.query(`UPDATE cms_module_content SET status='archived',updated_at=NOW() WHERE module_id=$1 AND status='published'`,[moduleId]);
    await client.query(`UPDATE cms_module_content SET status='published',published_at=NOW(),updated_at=NOW() WHERE module_id=$1 AND version=$2`,[moduleId,version]);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
