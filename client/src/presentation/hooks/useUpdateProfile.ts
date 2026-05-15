import { useState } from 'react';
import type { User } from '@/domain/user/User';
import type { UpdateProfileInput } from '@/application/user/UserRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';

export function useUpdateProfile(): {
  submit: (input: UpdateProfileInput) => Promise<User>;
  saving: boolean;
  error: Error | null;
} {
  const { updateProfile } = useContainer();
  const { applyUserUpdate } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (input: UpdateProfileInput): Promise<User> => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateProfile.execute(input);
      applyUserUpdate(next);
      return next;
    } catch (e) {
      const err = e as Error;
      setError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving, error };
}
