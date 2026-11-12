async (page) => {
  await page.context().addInitScript(() => {
    for (const p of ['gateway', 'workbuddy', 'trae', 'qoder']) sessionStorage.setItem('klee.' + p, 'klee-offline-demo');
  });
  const platforms = ['workbuddy', 'trae', 'qoder'];
  let traeDesktopBound = false;
  const accounts = p => [
    { uid: 'shared-user', nickname: p === 'workbuddy' ? '日常开发账号' : p === 'trae' ? 'Trae 主账号' : 'Qoder 国内开发', platform: p, region: 'cn', enabled: true, active: true, status: 'ready', credits: 128.75, remaining: 128.75, unit: '积分', plan: 'Pro', email: 'demo@example.test', expiresAt: Date.now() + 86400000, source: '官方登录', models: ['Claude-Sonnet-4'], ...(p === 'trae' ? { desktopBound: traeDesktopBound, checkinDeviceReady: traeDesktopBound } : {}) },
    { uid: p + '-secondary', nickname: p === 'qoder' ? '国际版备用账号' : '备用测试账号', platform: p, region: 'global', enabled: false, status: 'expired', remaining: null, models: [] },
  ];
  const models = [{ id: 'trae/Claude-Sonnet-4', name: 'Claude Sonnet 4', availableAccounts: 2, canonicalIds: ['Claude-Sonnet-4'] }, { id: 'qoder/Auto', name: 'Qoder Auto', availableAccounts: 1, canonicalIds: ['Auto'] }, { id: 'workbuddy/GPT-5', name: 'GPT-5', availableAccounts: 1, canonicalIds: ['GPT-5'] }];
  const states = new Map();
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.href === 'https://www.trae.cn/authorization?login_trace_id=offline-test') return route.fulfill({ contentType: 'text/html', body: '<title>Offline authorization fixture</title>' });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) return route.continue();
    const platform = ({ 18887: 'gateway', 18791: 'workbuddy', 17864: 'trae', 17865: 'qoder' })[url.port] || 'gateway';
    let data;
    if (url.pathname === '/api/config') data = { platform, ports: { gateway: 18887, workbuddy: 18791, trae: 17864, qoder: 17865 } };
    else if (url.pathname === '/api/login') data = { id: 'offline-login', url: 'https://www.trae.cn/authorization?login_trace_id=offline-test', expiresAt: Date.now() + 60000 };
    else if (url.pathname === '/api/login/offline-login') data = { status: 'pending' };
    else if (url.pathname === '/api/gateway/status') data = { accounts: platforms.flatMap(accounts), models, platforms: platforms.map(platform => ({ platform })), fetchedAt: Date.now() };
    else if (url.pathname === '/api/accounts') data = { accounts: accounts(platform).map(({ platform, ...a }) => a), activeUid: 'shared-user' };
    else if (url.pathname.endsWith('/device') && req.method() === 'POST') {
      traeDesktopBound = true;
      data = { ok: true, account: { uid: 'shared-user', nickname: 'Trae 主账号', enabled: true, desktopBound: true } };
    }
    else if (url.pathname === '/v1/models') data = { data: models, source: 'account', fetchedAt: Date.now() };
    else if (url.pathname === '/api/monitor') data = { accounts: accounts(platform).map(a => ({ ...a, limit: 300, used: 171.25, checkin: { enabled: true, checkedIn: false, reward: 10 }, packages: [{ name: '开发积分包', remaining: 128.75, limit: 300 }] })), fetchedAt: Date.now(), unit: '积分' };
    else if (['/api/checkin', '/api/checkin/desktop'].includes(url.pathname)) {
      const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
      if (body) await new Promise(resolve => setTimeout(resolve, 300));
      const requested = platform === 'gateway' ? body?.platform ? [body.platform] : platforms : [platform];
      const rows = requested.flatMap(p => accounts(p).filter(a => !body?.uid || a.uid === body.uid).map(a => {
        const key = p + ':' + a.uid;
        if (body && a.enabled) states.set(key, p === 'trae' ? 'failed' : 'claimed');
        const status = a.enabled ? states.get(key) || 'available' : 'disabled';
        return { ...a, ...(platform === 'gateway' ? { platform: p, ...(p === 'trae' ? { checkinDeviceReady: true } : {}) } : { platform: undefined }), status, checkedIn: status === 'claimed', message: status === 'failed' ? 'Trae 拒绝请求（9074）：当前参与用户太多，请稍后再试。奖励未确认到账' : status === 'claimed' ? '签到状态已确认' : status === 'disabled' ? '账号已停用' : '今日未签到', reward: 10, ...(status === 'failed' ? { errorCode: 'trae_9074', hint: '请稍后刷新签到状态。若仍显示未签到，再重新尝试领取。' } : {}) };
      }));
      data = { accounts: rows, fetchedAt: Date.now(), ...(platform === 'gateway' ? { platforms: requested.map(platform => ({ platform, status: 'ready' })) } : {}) };
    } else if (url.pathname === '/api/gateway/usage') data = { records: [], fetchedAt: Date.now() };
    else return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: '离线验证不执行此操作' } }) });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:18887/admin/gateway#theme=default');
}
