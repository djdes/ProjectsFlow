// Last login and last activity of an account (db/178), shown in the admin users console.
export interface UserActivityRepository {
  recordLogin(userId: string, at: Date): Promise<void>;
  // Writes only when the stored value is older than `olderThan`, so concurrent servers
  // and stale caches do not add writes.
  touchLastSeen(userId: string, at: Date, olderThan: Date): Promise<void>;
}
