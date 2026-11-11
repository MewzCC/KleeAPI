import type { Account, Model, Platform } from '../types'

export type OnboardingAction = 'settings' | 'accounts' | 'pool' | 'models' | 'test' | 'client' | 'refresh'
type Step = { title: string; description: string; action: OnboardingAction; button: string; done: boolean; disabled?: boolean }

function authorized(account: Account) {
  return account.enabled !== false && (account.status === 'ready' || account.status === 'no_credits')
}

export function modelConnection(platform: Platform, accounts: Account[], model?: Model) {
  if (!model) return ''
  const candidates = accounts.filter(account => {
    if (!authorized(account)) return false
    if (platform !== 'gateway') return account.active
    if (account.quotaError || account.modelsError || !(account.unlimited || (account.remaining ?? 0) > 0)) return false
    const ids = model.canonicalIds?.length ? model.canonicalIds : [model.id]
    return account.models?.some(entry => {
      const id = typeof entry === 'string' ? entry : entry.id
      return ids.includes(`${account.platform}/${account.region}/${id}`)
        || (model.id === `${account.platform}/${id}` && ids.includes(id))
    })
  })
  return candidates.length ? JSON.stringify(candidates.map(a => [a.platform ?? platform, a.region, a.uid]).sort()) : ''
}

export function getOnboarding(input: {
  platform: Platform; keyPresent: boolean; accounts: Account[]; models: Model[]; selected: string;
  tested: boolean; clientConfirmed: boolean; accountError?: string; modelError?: string; loadingAccounts?: boolean; loadingModels?: boolean;
}) {
  const { platform, keyPresent, accounts, models, selected, tested, clientConfirmed, accountError, modelError, loadingAccounts, loadingModels } = input
  const gateway = platform === 'gateway'
  const currentAccounts = gateway ? accounts : accounts.filter(account => account.active)
  const keyRejected = accountError?.includes('API Key')
  const keyDone = keyPresent && !keyRejected
  const keyStep: Step = { title: '设置 API Key', done: keyDone, action: 'settings', button: keyDone ? '查看连接设置' : '设置 API Key',
    description: keyDone ? '已设置本地服务 API Key。' : keyRejected ? 'API Key 无效，请在连接设置中重新保存。' : '保存本地服务 API Key，用于连接 KleeAPI。' }
  const connected = keyDone && !accountError && currentAccounts.some(authorized)
  const accountStep: Step = { title: '添加授权账号', done: connected, action: gateway && connected ? 'pool' : 'accounts',
    button: connected ? gateway ? '查看号池' : '管理账号' : '添加授权账号', description: gateway ? '已有授权有效的账号。' : '当前账号已连接。' }
  if (!keyDone) {
    Object.assign(accountStep, { description: '先完成 API Key 设置，再登录或导入平台账号。', disabled: true })
  } else if (accountError || (!connected && loadingAccounts)) {
    Object.assign(accountStep, { action: 'refresh', button: '刷新账号状态', description: accountError ? '无法读取账号状态，请刷新重试。' : '正在读取账号状态…', disabled: loadingAccounts })
  } else if (!connected) {
    Object.assign(accountStep, { button: accounts.length ? '管理账号' : '添加授权账号', description: accounts.length
      ? gateway ? '请启用一个账号，或重新登录已过期的账号。' : '请启用、重新登录或设为当前账号。'
      : '选择平台并完成官方登录，或导入已有授权。' })
  }

  const chosen = models.find(model => model.id === selected)
  const modelDone = connected && !modelError && !!modelConnection(platform, accounts, chosen)
  const modelStep: Step = { title: '选择模型', done: modelDone, action: 'models', button: '打开模型目录', description: '从模型目录选择要使用的模型。', disabled: !connected }
  if (modelDone) modelStep.description = selected
  else if (!connected) modelStep.description = '添加授权账号后即可查看可用模型。'
  else if (loadingModels) modelStep.description = '正在读取模型目录…'
  else if (modelError) modelStep.description = '无法读取模型目录，请进入目录刷新。'
  else if (gateway && !models.length) {
    Object.assign(modelStep, { action: 'pool', button: '检查号池和额度', description: '暂无可调度模型，请检查账号额度和模型权限。' })
  } else if (selected) modelStep.description = '上次选择的模型当前不可用，请重新选择。'

  const testDone = modelDone && tested
  const clientDone = testDone && clientConfirmed
  const testStep: Step = { title: '测试消息', done: testDone, action: 'test', button: testDone ? '重新测试' : '打开测试聊天', disabled: !modelDone,
    description: testDone ? '已收到模型回复。' : modelDone ? '发送一条测试消息，确认模型能正常回复。' : '先选择要测试的模型。' }
  const steps: Step[] = [keyStep, accountStep, modelStep, testStep,
    { title: '接入客户端', done: clientDone, action: 'client', button: '查看客户端配置', disabled: !testDone,
      description: clientDone ? '你已确认客户端收到回复。' : testDone ? '填写接入配置，并在自己的客户端确认收到回复。' : '先完成测试消息，再用同一配置接入。' },
  ]
  return { steps, keyStep, accountStep, modelStep, testStep, completed: steps.filter(step => step.done).length }
}
