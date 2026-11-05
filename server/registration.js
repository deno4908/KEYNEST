import { AppError } from './security.js';
import { accountConsentRecord } from './legal-consent.js';

// Admin Auth creates a real user or returns an error; it never returns the
// obfuscated success response used by public signUp for existing accounts.
export async function registerSupabase(store, authClient, input) {
  const consent = accountConsentRecord(input.legal, 'email-registration');
  const conflicts = await store.query(store.client.rpc('registration_conflicts', {
    p_email: input.email, p_name: input.name,
  }));
  if (conflicts.email) throw new AppError('Email đã được sử dụng.', 409);
  if (conflicts.name) throw new AppError('Tên đăng ký đã được sử dụng.', 409);
  const { data, error } = await store.client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name, registration_name: input.name },
    app_metadata: { legal_acceptance: consent },
  });
  if (error || !data?.user) {
    if (['email_exists', 'user_already_exists'].includes(error?.code))
      throw new AppError('Email đã được sử dụng.', 409);
    // A concurrent registration may have won the unique name constraint.
    const latest = await store.query(store.client.rpc('registration_conflicts', {
      p_email: input.email, p_name: input.name,
    }));
    if (latest.email || latest.name)
      throw new AppError(latest.email ? 'Email đã được sử dụng.' : 'Tên đăng ký đã được sử dụng.', 409);
    throw new AppError('Không thể tạo tài khoản. Vui lòng thử lại sau.', 503);
  }
  const signedIn = await authClient.auth.signInWithPassword({ email: input.email, password: input.password });
  if (signedIn.error || !signedIn.data?.session)
    return { message: 'Đã tạo tài khoản. Bạn có thể đăng nhập bằng email và mật khẩu.' };
  return { session: signedIn.data.session, user: await store.profile(data.user.id) };
}
