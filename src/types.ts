export type Env = {
  DB: D1Database;
  UPDATES: R2Bucket;
  JWT_SECRET: string;
  CLAIM_SECRET: string;
};

export interface JWTPayload {
  userId: string;
  storeId: string;
  email: string;
  role: string;
  sessionId: string;
  exp: number;
}

export interface AuthContext {
  userId: string;
  storeId: string;
  email: string;
  role: string;
  sessionId: string;
}

export interface SyncChange {
  id: string;
  table_name: string;
  record_id: string;
  store_id: string;
  data: Record<string, unknown>;
}

export const SYNCABLE_TABLES = [
  'stores',
  'products',
  'customers',
  'employees',
  'expenses',
  'customer_transactions',
  'pos_transactions',
  'pos_transaction_items',
] as const;

export type SyncableTable = typeof SYNCABLE_TABLES[number];
