import mysql from 'mysql2/promise';

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-pass'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: true }
    });

    // 1. Получить все записи с ролями и реакциями
    if (event.httpMethod === 'GET') {
      const [rows] = await connection.execute(
        `SELECT id, name,
                COALESCE(country, 'Uzbekistan') AS country,
                COALESCE(role, 'ATT Talabasi') AS role,
                COALESCE(heart_count, 0) AS heart_count,
                COALESCE(fire_count, 0) AS fire_count,
                COALESCE(clap_count, 0) AS clap_count,
                created_at
         FROM notes ORDER BY id DESC`
      );
      return { statusCode: 200, headers, body: JSON.stringify(rows) };
    }

    // 2. Добавить новую запись
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const name = (body.name || '').trim();
      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name required' }) };
      }

      const allowedRoles = ['ATT Talabasi', 'Boshqa guruh', 'Ustoz', 'Mehmon'];
      const role = allowedRoles.includes(body.role) ? body.role : 'ATT Talabasi';

      let country = body.country || 'Uzbekistan';
      if (event.headers['x-nf-geo']) {
        try {
          const geo = JSON.parse(Buffer.from(event.headers['x-nf-geo'], 'base64').toString('utf-8'));
          if (geo?.country?.name) country = geo.country.name;
        } catch (e) {}
      }

      await connection.execute(
        'INSERT INTO notes (name, country, role, heart_count, fire_count, clap_count) VALUES (?, ?, ?, 0, 0, 0)',
        [name, country, role]
      );
      return { statusCode: 201, headers, body: JSON.stringify({ ok: true }) };
    }

    // 3. Поставить или снять реакцию (heart, fire, clap)
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const id = Number(body.id);
      const colMap = {
        heart: 'heart_count',
        fire: 'fire_count',
        clap: 'clap_count'
      };
      const col = colMap[body.type];
      if (!id || !col) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid ID or reaction type' }) };
      }

      const delta = body.action === 'remove' ? -1 : 1;
      await connection.execute(
        `UPDATE notes SET ${col} = GREATEST(0, COALESCE(${col}, 0) + ?) WHERE id = ?`,
        [delta, id]
      );

      const [rows] = await connection.execute(
        'SELECT COALESCE(heart_count, 0) AS heart_count, COALESCE(fire_count, 0) AS fire_count, COALESCE(clap_count, 0) AS clap_count FROM notes WHERE id = ?',
        [id]
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, counts: rows[0] || {} })
      };
    }

    // 4. Удалить запись (админ-панель)
    if (event.httpMethod === 'DELETE') {
      const adminPass = event.headers['x-admin-pass'];
      const correctPass = process.env.ADMIN_PASS || 'ruslan2026';
      if (adminPass !== correctPass) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Wrong admin password' }) };
      }

      const body = JSON.parse(event.body || '{}');
      if (!body.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID required' }) };
      }

      await connection.execute('DELETE FROM notes WHERE id = ?', [body.id]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    if (connection) await connection.end();
  }
};
