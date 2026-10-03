import type { Pool } from "./db.js";
import type { User } from "../domain/types.js";
import type { UserRepository } from "../domain/ports.js";

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT id, email, password_hash, created_at FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT id, email, password_hash, created_at FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async create(email: string, passwordHash: string): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, password_hash, created_at`,
      [email.toLowerCase(), passwordHash],
    );
    return toUser(rows[0]!);
  }
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}
