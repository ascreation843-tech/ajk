
import { Pool } from 'pg';
import "dotenv/config";

async function main() {
  const directUrl = "postgresql://postgres.zmbrcmbrrqsfmcfbvrjw:Lolypop929%40@db.zmbrcmbrrqsfmcfbvrjw.supabase.co:5432/postgres";
  console.log('Testing DIRECT connection to Supabase...');
  
  try {
    const connectionString = directUrl;
    const pool = new Pool({ 
      connectionString, 
      connectionTimeoutMillis: 30000,
      ssl: {
        rejectUnauthorized: true 
      }
    });

    console.log('Attempting raw PG connection with strict SSL...');
    const client = await pool.connect();
    console.log('Raw PG connection successful!');
    const res = await client.query('SELECT NOW()');
    console.log('Raw PG query result:', res.rows[0]);
    client.release();
    await pool.end();
    
  } catch (err) {
    console.error('Connection test failed:', err);
  }
}

main();
