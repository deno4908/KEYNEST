export function sessionRefreshHandler({ config, makeAuthClient, store, operations, adminOtp, setAuth, clearAuth }) {
  return async (req, res) => {
    if (config.mode === 'demo') return res.json({ ok: true });
    if (!req.cookies.kn_refresh) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const client = makeAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: req.cookies.kn_refresh });
    if (error || !data.session || !data.user) {
      clearAuth(res);
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    }
    req.user = await store.profile(data.user.id);
    req.authUser = data.user;
    req.authToken = data.session.access_token;
    try {
      await operations.authorize(req, req.authToken);
    } catch (error) {
      if ([401, 403].includes(error.status)) clearAuth(res);
      throw error;
    }
    adminOtp.renew(req, res);
    setAuth(res, data.session);
    res.json({ ok: true });
  };
}
