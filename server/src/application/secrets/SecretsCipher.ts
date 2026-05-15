export interface SecretsCipher {
  encrypt(plain: string): string;   // returns base64(iv || ciphertext || authTag)
  decrypt(packed: string): string;  // reverses; throws on tamper
}
