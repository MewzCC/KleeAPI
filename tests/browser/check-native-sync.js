async (page) => {
  await page.goto('http://127.0.0.1:17864/admin/trae?tab=accounts#theme=default');
  await page.getByRole('heading', { name: /^Trae 主账号/ }).waitFor();
  const posts = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname); });
  const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/shared-user/device'));
  await page.getByRole('button', { name: '同步本机设备', exact: true }).first().click();
  if ((await response).status() !== 200) throw Error('Native device sync UI did not reach the endpoint');
  await page.getByText('账号已更新。', { exact: true }).waitFor();
  if (posts.length !== 1 || posts[0] !== '/api/accounts/shared-user/device') throw Error('Device sync must not trigger a claim');
  if (await page.getByRole('textbox', { name: '凭据 JSON' }).inputValue()) throw Error('Sync must not fill the credential editor');
  return 'PASS: Trae native device button uses the targeted endpoint without claiming or exposing credentials.';
}
