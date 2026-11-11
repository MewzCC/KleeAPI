const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function reportedCredits(usage) {
  return [usage?.credits_consumed, usage?.credits_used, usage?.credits].find(amount) ?? null;
}

/** 估算必须保留可核对的两次余额，不能冒充平台上报值。 */
export function creditEstimate(usage) {
  if (reportedCredits(usage) !== null) return null;
  const value = usage?.klee_credit_estimate;
  if (!value || ![value.amount, value.balance_before, value.balance_after, value.measured_at].every(amount)
    || value.balance_after > value.balance_before || typeof value.unit !== 'string' || !value.unit || value.unit.length > 64
    || Math.abs(value.amount - (value.balance_before - value.balance_after)) > 0.000001) return null;
  return { amount: value.amount, balanceBefore: value.balance_before, balanceAfter: value.balance_after, unit: value.unit, measuredAt: value.measured_at };
}

/** 每次余额探测最多等待三秒；失败不影响模型响应。账号槽位在复查结束前保持占用。 */
export async function createCreditEstimator({ readQuota, unit, signal, timeoutMs = 3000 }) {
  async function read() {
    if (signal?.aborted) return null;
    let timer, abort;
    try {
      const quota = await Promise.race([
        Promise.resolve().then(readQuota),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); abort = () => resolve(null); signal?.addEventListener('abort', abort, { once: true }); }),
      ]);
      if (signal?.aborted || !quota || quota.unlimited || !amount(quota.remaining)) return null;
      const label = quota.unit || unit;
      if (typeof label !== 'string' || !label || label.length > 64) return null;
      return { remaining: quota.remaining, limit: amount(quota.limit) ? quota.limit : null, unit: label };
    } catch { return null; }
    finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
  }
  const before = await read();
  return async usage => {
    if (!before || reportedCredits(usage) !== null) return usage;
    const after = await read();
    if (!after || before.unit !== after.unit || before.limit !== after.limit || after.remaining > before.remaining) return usage;
    const estimate = { amount: Number((before.remaining - after.remaining).toFixed(6)), balance_before: before.remaining, balance_after: after.remaining, unit: before.unit, measured_at: Date.now() };
    return { ...usage, klee_credit_estimate: estimate };
  };
}
